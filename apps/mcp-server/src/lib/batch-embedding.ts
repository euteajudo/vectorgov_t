/**
 * Wrapper de embedding em lotes — usa Workers AI `@cf/baai/bge-m3` (1024 dim).
 *
 * - Quebra qualquer input maior que `MAX_BATCH_SIZE` em sub-batches.
 * - Valida que cada vetor retornado tem exatamente `EXPECTED_DIM` dimensões.
 * - Retry com backoff exponencial (1s → 2s → 4s) por sub-batch.
 * - Loga tokens consumidos (estimativa por chars/4) via `console.log` para
 *   aparecer no Workers Logs/Observability — `env.AI` não expõe contador.
 *
 * Não tenta cache: o caller (orchestrator) é quem decide se vale cachear
 * (hoje não cacheia, porque cada dispositivo é único por norma+versão).
 */

import type { Env } from "../env.js";

/**
 * Dimensionalidade esperada do modelo bge-m3. Qualquer vetor com tamanho
 * diferente é tratado como erro fatal (cobre mudança silenciosa de modelo).
 */
const EXPECTED_DIM = 1024;

/**
 * Limite por chamada do Workers AI — confirmado empiricamente em 100.
 * Acima disso o runtime devolve erro de payload-too-large.
 */
const MAX_BATCH_SIZE = 100;

/**
 * Identificador do modelo no Workers AI. Mantemos como constante para
 * permitir swap em um único ponto (ex.: troca para um sucessor do bge-m3).
 */
const EMBEDDING_MODEL = "@cf/baai/bge-m3" as const;

/**
 * Tentativas totais (1 original + 2 retries). Backoff: 1s, 2s.
 * Não passamos de 3 porque o orchestrator tem timeout total agressivo.
 */
const MAX_ATTEMPTS = 3;

/**
 * Resposta esperada do Workers AI para o modelo bge-m3.
 *
 * O binding `AI.run` é tipado como `Promise<unknown>` no `workers-types`
 * para esse modelo, então fazemos type-guard manual antes de confiar.
 */
interface BgeM3Response {
  shape?: [number, number];
  data?: number[][];
}

/**
 * Type guard para a resposta do bge-m3 — verifica que `data` é
 * `number[][]` antes de assumir.
 */
function isBgeM3Response(value: unknown): value is BgeM3Response {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.data)) return false;
  return obj.data.every(
    (row) => Array.isArray(row) && row.every((n) => typeof n === "number"),
  );
}

/**
 * Estimativa de tokens consumidos — usa chars/4 como aproximação
 * conservadora (vale para PT-BR, ligeiramente menor para texto técnico).
 */
function estimateTokens(textos: readonly string[]): number {
  let chars = 0;
  for (const t of textos) {
    chars += t.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Espera por `ms` milissegundos — wrapper Promise para `setTimeout`.
 *
 * Em testes, `vi.useFakeTimers()` avança esse delay sem esperar de verdade.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chama Workers AI uma única vez com retry interno (exponential backoff).
 *
 * O backoff é por sub-batch: cada falha incrementa o delay (1s → 2s).
 * Se todas as tentativas falharem, propaga o último erro.
 */
async function callAIWithRetry(
  env: Env,
  textos: readonly string[],
): Promise<Float32Array[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // `AI.run` é tipado como Promise<unknown> para este modelo.
      const raw = (await env.AI.run(EMBEDDING_MODEL, {
        text: [...textos],
      })) as unknown;
      if (!isBgeM3Response(raw)) {
        throw new Error(
          `Resposta do modelo ${EMBEDDING_MODEL} não tem shape esperado`,
        );
      }
      // Após o type guard, `raw.data` é garantidamente `number[][]`.
      const data = raw.data as number[][];
      if (data.length !== textos.length) {
        throw new Error(
          `Embedding retornou ${data.length} vetores, esperado ${textos.length}`,
        );
      }
      const vetores: Float32Array[] = [];
      for (let i = 0; i < data.length; i++) {
        const vec = data[i];
        if (vec === undefined || vec.length !== EXPECTED_DIM) {
          throw new Error(
            `Embedding ${i} tem ${vec?.length ?? 0} dimensões, esperado ${EXPECTED_DIM}`,
          );
        }
        vetores.push(Float32Array.from(vec));
      }
      return vetores;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        // Backoff exponencial: 1s, 2s. (Não chegamos a 4s porque MAX_ATTEMPTS=3.)
        const delay = 1000 * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`embedBatch falhou após ${MAX_ATTEMPTS} tentativas: ${reason}`);
}

/**
 * Embed em batches de até 100 textos. Aceita qualquer N e quebra
 * internamente preservando a ordem original.
 *
 * @param textos - Lista de strings a serem vetorizadas.
 * @param env - Bindings do Worker (precisa de `AI`).
 * @returns Array de `Float32Array` com 1024 dimensões cada, mesma ordem dos inputs.
 * @throws Erro se algum sub-batch falhar após todas as tentativas, ou se
 *         a dimensionalidade vier diferente de 1024.
 */
export async function embedBatch(
  textos: readonly string[],
  env: Env,
): Promise<Float32Array[]> {
  if (textos.length === 0) {
    return [];
  }
  const totalTokens = estimateTokens(textos);
  // Log estruturado — facilita queries no Workers Logs.
  console.log(
    JSON.stringify({
      event: "embed_batch_start",
      total_textos: textos.length,
      tokens_aprox: totalTokens,
      model: EMBEDDING_MODEL,
    }),
  );

  const resultados: Float32Array[] = [];
  for (let i = 0; i < textos.length; i += MAX_BATCH_SIZE) {
    const subBatch = textos.slice(i, i + MAX_BATCH_SIZE);
    const vetores = await callAIWithRetry(env, subBatch);
    resultados.push(...vetores);
  }

  console.log(
    JSON.stringify({
      event: "embed_batch_done",
      total_vetores: resultados.length,
      tokens_aprox: totalTokens,
    }),
  );
  return resultados;
}
