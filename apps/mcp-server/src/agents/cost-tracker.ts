/**
 * Cost tracker para o motor PEVS (F5.1 — problema 2: telemetria de custo).
 *
 * Motivação:
 *   Antes desta sprint não tínhamos visibilidade de quanto cada análise
 *   custa em tokens / USD. Sem isso é impossível:
 *     - Estimar budget de produção.
 *     - Detectar regressões de prompt (mais tokens = mais caro).
 *     - Optimizar qual papel está dominando o gasto.
 *
 * Estratégia:
 *   1. `TrackedLLMClient` envolve um `LLMClient` real (Vercel AI SDK no
 *      futuro, MockLLMClient nos testes) e acumula em memória os tokens
 *      retornados em `result.usage` por chamada.
 *   2. O `PEVSEngine` instancia o tracker no início de `executarFeature1`
 *      / `executarFeature2`, passa o wrapper como `contexto.llm` para os
 *      roles, e ao final lê `tracker.snapshot()` para logar o agregado.
 *   3. `estimateCostUsd(usage, modelo)` aplica as tabelas de preço de
 *      input/output token de cada Gemini (constants documentados).
 *
 * Por que wrapper em vez de instrumentar cada role:
 *   - Mantém os roles ignorantes de preço/telemetria (responsabilidade
 *     única — eles apenas executam).
 *   - Acrescentar um novo role no futuro NÃO exige lembrar de instrumentar
 *     tokens — o tracker captura automaticamente via proxy.
 *   - Mocking permanece trivial (os roles continuam recebendo um LLMClient
 *     comum).
 *
 * Limitações conscientes:
 *   - O Vercel AI SDK retorna `result.usage = {promptTokens, completionTokens, totalTokens}`
 *     (Gemini billing tem nuance de "thinking tokens" no Pro, mas isso vem
 *     somado em completionTokens). Quando esse SDK estiver plugado, o
 *     tracker pega o número direto da API.
 *   - O MockLLMClient estima por chars/4. Útil para testes mas o custo
 *     calculado em produção via mock NÃO deve ser usado para budget.
 */
import type {
  LLMClient,
  ModeloLLM,
  OpcoesGeracaoEstruturada,
  ResultadoGeracaoEstruturada,
} from "./llm/index.js";

/**
 * Tabela de preços (USD por 1M tokens) — atualizada em 2026-05.
 *
 * Fonte: Google AI pricing (Gemini 3.x). Mantemos como constantes locais
 * em vez de env vars porque o ciclo de mudança de preço é raro o suficiente
 * para justificar um deploy quando ocorrer (e errar para baixo é pior que
 * errar para cima — overestimar custo é mais seguro).
 *
 * Workers AI (bge-m3 para embeddings) está no plano free atual; tratamos
 * como custo $0. Quando migrar para tier pago, adicionar entrada similar.
 */
export const PRECOS_POR_MILHAO_USD: Record<
  ModeloLLM,
  { input: number; output: number }
> = {
  "gemini-3.5-flash": {
    input: 0.075,
    output: 0.3,
  },
  "gemini-3-pro": {
    input: 1.25,
    output: 5.0,
  },
};

/**
 * Agregado de uso por modelo — snapshot retornado por `tracker.snapshot()`.
 */
export interface UsoPorModelo {
  modelo: ModeloLLM;
  chamadas: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  custo_usd: number;
}

/**
 * Snapshot total acumulado pelo tracker.
 */
export interface SnapshotUso {
  /** Tokens totais (todos os modelos) — soma direta para o log de auditoria. */
  total_tokens: number;
  /** Custo agregado em USD (todos os modelos). */
  custo_estimado_usd: number;
  /** Total de chamadas LLM (todos os modelos). */
  total_chamadas: number;
  /** Breakdown por modelo (útil para análise de regressão por papel). */
  por_modelo: UsoPorModelo[];
}

/**
 * Calcula o custo (USD) de uma chamada LLM dada a usage e o modelo.
 *
 * Fórmula: `(prompt/1M * input_price) + (completion/1M * output_price)`.
 *
 * Modelos desconhecidos retornam custo 0 (não bloqueia a execução mas
 * loga warning — útil para detectar quando esquecemos de atualizar a
 * tabela em um upgrade de modelo).
 */
export function estimateCostUsd(
  usage: { promptTokens: number; completionTokens: number },
  modelo: ModeloLLM,
): number {
  const tabela = PRECOS_POR_MILHAO_USD[modelo];
  if (!tabela) {
    console.warn(
      JSON.stringify({
        event: "cost_tracker_modelo_desconhecido",
        modelo,
      }),
    );
    return 0;
  }
  const inputUsd = (usage.promptTokens / 1_000_000) * tabela.input;
  const outputUsd = (usage.completionTokens / 1_000_000) * tabela.output;
  // Arredondar para 6 casas — micropagamento por chamada exige precisão
  // mas evita ruído de ponto flutuante no snapshot agregado.
  return Math.round((inputUsd + outputUsd) * 1_000_000) / 1_000_000;
}

/**
 * Wrapper de `LLMClient` que acumula tokens consumidos por chamada.
 *
 * Implementa `LLMClient` (composição transparente — pode substituir o
 * client real em qualquer ponto do código sem mudança de assinatura).
 *
 * Thread-safe? Não — o acumulador interno (`Map`) não é concorrente. No
 * Workers runtime cada análise roda num único isolate sequencialmente,
 * então não há corrida. Se algum dia paralelizarmos múltiplas análises
 * compartilhando tracker, migrar para `BigInt`/`AtomicLong` (ainda não é
 * necessário).
 */
export class TrackedLLMClient implements LLMClient {
  private readonly inner: LLMClient;
  private readonly acumulado: Map<
    ModeloLLM,
    { chamadas: number; prompt: number; completion: number; total: number; custo: number }
  > = new Map();

  constructor(inner: LLMClient) {
    this.inner = inner;
  }

  async generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>> {
    const result = await this.inner.generateObject(opts);
    this.registrar(result.modelo, result.usage);
    return result;
  }

  /**
   * Acumula a usage da chamada no agregado por modelo.
   *
   * Tolera `usage` parcialmente preenchida (ex.: completionTokens=0 quando
   * o modelo só validou schema sem gerar conteúdo novo).
   */
  private registrar(
    modelo: ModeloLLM,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): void {
    const atual =
      this.acumulado.get(modelo) ??
      { chamadas: 0, prompt: 0, completion: 0, total: 0, custo: 0 };
    atual.chamadas += 1;
    atual.prompt += usage.promptTokens;
    atual.completion += usage.completionTokens;
    atual.total += usage.totalTokens;
    atual.custo += estimateCostUsd(usage, modelo);
    this.acumulado.set(modelo, atual);
  }

  /**
   * Devolve um snapshot imutável do acumulado até o momento.
   *
   * NÃO zera o contador — caller pode chamar várias vezes sem efeito
   * colateral. Para reset explícito use `reset()`.
   */
  snapshot(): SnapshotUso {
    const por_modelo: UsoPorModelo[] = [];
    let total_tokens = 0;
    let custo = 0;
    let chamadas = 0;
    for (const [modelo, agg] of this.acumulado) {
      por_modelo.push({
        modelo,
        chamadas: agg.chamadas,
        prompt_tokens: agg.prompt,
        completion_tokens: agg.completion,
        total_tokens: agg.total,
        custo_usd: Math.round(agg.custo * 1_000_000) / 1_000_000,
      });
      total_tokens += agg.total;
      custo += agg.custo;
      chamadas += agg.chamadas;
    }
    return {
      total_tokens,
      custo_estimado_usd: Math.round(custo * 1_000_000) / 1_000_000,
      total_chamadas: chamadas,
      por_modelo,
    };
  }

  /**
   * Zera o acumulado — útil entre análises distintas no mesmo isolate.
   *
   * O PEVS engine cria um tracker novo a cada execução, então este método
   * é principalmente para testes que reutilizam a instância.
   */
  reset(): void {
    this.acumulado.clear();
  }
}
