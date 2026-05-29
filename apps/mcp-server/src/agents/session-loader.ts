/**
 * Loader e cliente proxy do `SessionAgent` Durable Object.
 *
 * O `PEVSEngine` exige uma instância de `SessionAgent` no `cfg.sessionAgent`.
 * Como o engine roda no Worker (não dentro do DO), passamos um proxy
 * (`SessionAgentClient`) que implementa a mesma interface da classe
 * `SessionAgent` mas delega cada chamada via `stub.fetch(internalUrl)`.
 *
 * Há 1 DO global ("default") — todos os histórico de petições/pareceres
 * vivem no mesmo SQL storage. Quando autenticação multi-usuário for
 * adicionada, mudar `idFromName(userId)`.
 */
import type { Env } from "../env.js";
import type { SessionAgent, EntradaHistorico } from "./session-agent.js";
import type {
  Peticao,
  AnaliseReequilibrio,
  Parecer,
} from "@vectorgov-t/schemas";

const DEFAULT_SESSION_ID = "default";

/**
 * Implementa a mesma API pública do `SessionAgent` chamando o DO via fetch.
 *
 * `protected getEnv()` não é parte da interface pública usada pelo PEVS
 * engine, então não precisamos implementá-lo aqui.
 */
export class SessionAgentClient
  implements
    Pick<
      SessionAgent,
      | "analisarPeticao"
      | "gerarParecer"
      | "listarHistorico"
      | "carregarAnalise"
      | "carregarParecer"
      | "carregarParecerPorAnalise"
      | "registrarConversa"
      | "ultimasConversas"
    >
{
  constructor(private readonly stub: DurableObjectStub) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const r = await this.stub.fetch(
      new Request(`https://do.local${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`SessionAgentClient ${path} retornou ${r.status}: ${detail}`);
    }
    return r.json();
  }

  private async get(path: string): Promise<unknown> {
    const r = await this.stub.fetch(new Request(`https://do.local${path}`));
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(`SessionAgentClient ${path} retornou ${r.status}: ${detail}`);
    }
    return r.json();
  }

  async analisarPeticao(
    peticao: Peticao,
    analise: AnaliseReequilibrio,
  ): Promise<void> {
    await this.post("/analisar-peticao", { peticao, analise });
  }

  /**
   * Enfileira um job de análise PEVS no DO (rodado em background via alarm).
   * Retorna assim que o job é persistido — não espera o pipeline.
   */
  async agendarAnalise(
    recordId: string,
    peticao: Peticao,
    apiKey: string,
  ): Promise<void> {
    await this.post("/agendar-analise", {
      record_id: recordId,
      peticao,
      api_key: apiKey,
    });
  }

  async gerarParecer(parecer: Parecer): Promise<void> {
    await this.post("/gerar-parecer", { parecer });
  }

  async listarHistorico(limit = 20): Promise<EntradaHistorico[]> {
    const data = (await this.get(
      `/historico?limit=${encodeURIComponent(String(limit))}`,
    )) as { historico: EntradaHistorico[] };
    return data.historico;
  }

  async carregarAnalise(
    analiseId: string,
  ): Promise<{ peticao: Peticao; analise: AnaliseReequilibrio } | null> {
    const data = (await this.get(
      `/analise?id=${encodeURIComponent(analiseId)}`,
    )) as { peticao: Peticao; analise: AnaliseReequilibrio } | null;
    return data;
  }

  async carregarParecer(parecerId: string): Promise<Parecer | null> {
    const data = (await this.get(
      `/parecer?id=${encodeURIComponent(parecerId)}`,
    )) as Parecer | null;
    return data;
  }

  async carregarParecerPorAnalise(analiseId: string): Promise<Parecer | null> {
    const data = (await this.get(
      `/parecer-por-analise?analise_id=${encodeURIComponent(analiseId)}`,
    )) as Parecer | null;
    return data;
  }

  async registrarConversa(
    id: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    await this.post("/registrar-conversa", { id, role, content });
  }

  async ultimasConversas(
    n = 10,
  ): Promise<
    Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      criado_em: number;
    }>
  > {
    const data = (await this.get(
      `/conversas?n=${encodeURIComponent(String(n))}`,
    )) as {
      conversas: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        criado_em: number;
      }>;
    };
    return data.conversas;
  }
}

/**
 * Devolve um cliente SessionAgent ligado ao DO global.
 *
 * Aceita `sessionId` opcional pra suporte futuro a multi-tenant; default
 * é o DO global "default".
 */
export function getSessionAgentClient(
  env: Env,
  sessionId: string = DEFAULT_SESSION_ID,
): SessionAgentClient {
  const id = env.SESSION_AGENT.idFromName(sessionId);
  const stub = env.SESSION_AGENT.get(id);
  return new SessionAgentClient(stub);
}
