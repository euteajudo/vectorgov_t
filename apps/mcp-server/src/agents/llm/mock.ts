/**
 * Mock do `LLMClient` — usado em testes e enquanto não há acesso à API Google.
 *
 * Estratégia: o mock recebe um mapa `respostas` onde a chave é uma
 * substring do system prompt (case-insensitive) e o valor é uma função
 * que retorna o objeto estruturado a ser devolvido. Isso permite que
 * cada teste / setup do PEVS configure respostas específicas por papel
 * sem precisar parsear prompts complexos.
 *
 * Se nenhuma chave casar, o mock cai num `fallback` — ou arremessa
 * (modo estrito, padrão dos testes) ou retorna `respostaPadrao` se
 * configurada.
 *
 * Importante: o mock SEMPRE valida o resultado contra o `schema`
 * (Zod `.parse`). Isso garante que mesmo respostas fabricadas pelo
 * teste passem pela mesma porta do código real — schemas inválidos
 * arremessam exatamente onde arremessariam em produção.
 */
import type {
  LLMClient,
  OpcoesGeracaoEstruturada,
  ResultadoGeracaoEstruturada,
} from "./types.js";

/**
 * Função handler associada a uma chave de matching.
 *
 * Recebe as opções completas da chamada para que o teste possa inspecionar
 * messages / temperatura / tag se quiser.
 */
export type MockHandler = (
  opts: OpcoesGeracaoEstruturada<unknown>,
) => unknown | Promise<unknown>;

/**
 * Configuração de um `MockLLMClient`.
 */
export interface MockLLMConfig {
  /**
   * Mapa de respostas. Chave = substring a casar no `system` (case-insensitive)
   * OU na `tag` se a tag estiver presente. Valor = handler que produz o
   * objeto retornado.
   *
   * A primeira chave que casar (na ordem do Map) é usada.
   */
  respostas: Map<string, MockHandler>;

  /**
   * Resposta padrão caso nenhuma chave case. Quando `undefined`, o mock
   * arremessa (comportamento estrito útil em testes).
   */
  respostaPadrao?: MockHandler;

  /**
   * Se true, registra cada chamada em `chamadas` (para asserts em testes).
   */
  registrarChamadas?: boolean;
}

/**
 * Registro de uma chamada feita ao mock — útil para asserts:
 *
 *   expect(mock.chamadas).toHaveLength(2);
 *   expect(mock.chamadas[0].tag).toBe('orquestrador.plan');
 */
export interface RegistroChamada {
  tag: string | undefined;
  modelo: string;
  systemSnippet: string;
  mensagens: number;
  timestamp: number;
}

/**
 * Implementação mock do LLMClient — DETERMINÍSTICA.
 */
export class MockLLMClient implements LLMClient {
  public chamadas: RegistroChamada[] = [];
  private readonly cfg: MockLLMConfig;

  constructor(cfg: MockLLMConfig) {
    this.cfg = cfg;
  }

  async generateObject<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): Promise<ResultadoGeracaoEstruturada<T>> {
    if (this.cfg.registrarChamadas !== false) {
      this.chamadas.push({
        tag: opts.tag,
        modelo: opts.modelo,
        systemSnippet: opts.system.slice(0, 200),
        mensagens: opts.messages.length,
        timestamp: Date.now(),
      });
    }

    const handler = this.encontrarHandler(opts);
    if (!handler) {
      throw new Error(
        `MockLLMClient: nenhuma resposta configurada (tag='${opts.tag ?? "?"}'). ` +
          `Adicione uma chave em respostas que case com o system prompt ou a tag.`,
      );
    }

    const cru = await handler(opts as OpcoesGeracaoEstruturada<unknown>);
    // Sempre valida contra o schema — mesmo caminho do código real.
    const validado = opts.schema.parse(cru) as T;
    const rawJson = JSON.stringify(validado);
    const promptLen =
      opts.system.length +
      opts.messages.reduce((s, m) => s + m.content.length, 0);

    return {
      object: validado,
      raw: rawJson,
      // Estimativa simples: ~4 chars por token (regra de bolso).
      usage: {
        promptTokens: Math.ceil(promptLen / 4),
        completionTokens: Math.ceil(rawJson.length / 4),
        totalTokens: Math.ceil((promptLen + rawJson.length) / 4),
      },
      modelo: opts.modelo,
    };
  }

  /**
   * Resolve qual handler usar para a chamada — match em duas etapas:
   *  1. Tag exata.
   *  2. Substring no system prompt (case-insensitive).
   *  3. Fallback `respostaPadrao`.
   */
  private encontrarHandler<T>(
    opts: OpcoesGeracaoEstruturada<T>,
  ): MockHandler | undefined {
    if (opts.tag) {
      const direto = this.cfg.respostas.get(opts.tag);
      if (direto) return direto;
    }
    const sys = opts.system.toLowerCase();
    for (const [chave, handler] of this.cfg.respostas) {
      if (sys.includes(chave.toLowerCase())) return handler;
    }
    return this.cfg.respostaPadrao;
  }
}

/**
 * Helper para criar um MockLLMClient a partir de um objeto literal —
 * mais ergonômico em testes que `new MockLLMClient({ respostas: new Map(...) })`.
 *
 *   const mock = criarMockLLM({
 *     'orquestrador': () => ({ subtarefas: [...] }),
 *     'auditor':      () => ({ status: 'APROVADA', ... }),
 *   });
 */
export function criarMockLLM(
  respostas: Record<string, MockHandler>,
  respostaPadrao?: MockHandler,
): MockLLMClient {
  const mapa = new Map<string, MockHandler>();
  for (const [k, v] of Object.entries(respostas)) {
    mapa.set(k, v);
  }
  return new MockLLMClient({ respostas: mapa, respostaPadrao });
}
