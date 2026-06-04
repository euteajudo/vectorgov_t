/**
 * Cliente do warm-up/health do Container Python de ingestão.
 *
 * O Container (`vectorgov-t-ingestion`) hiberna após ~5 min ocioso. O primeiro
 * upload "frio" pode falhar/demorar — ruim numa demo. Aqui pingamos o
 * `/ingestao/health` do `vectorgov-t-mcp`, que (a) reporta se está pronto e
 * (b) ESQUENTA o container ao pingar. Leis e acórdãos compartilham o mesmo
 * container, então este único ping serve as duas telas de ingestão.
 */

const MCP_BASE =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_MCP_WORKER_URL ??
      process.env.NEXT_PUBLIC_MCP_BASE_URL)) ||
  "https://vectorgov-t-mcp.souzat19.workers.dev";

export interface ContainerHealth {
  ready: boolean;
  /** true quando o ping não respondeu a tempo (container subindo). */
  aquecendo?: boolean;
}

/**
 * Pinga o health do container. Nunca lança — devolve `{ready:false}` em
 * qualquer erro (a UI só precisa do booleano). O ato de pingar já dispara o
 * cold-start, então chamadas repetidas convergem para `ready:true`.
 */
export async function pingContainerHealth(): Promise<ContainerHealth> {
  try {
    const res = await fetch(`${MCP_BASE}/ingestao/health`, { method: "GET" });
    if (!res.ok) return { ready: false, aquecendo: true };
    const d = (await res.json()) as ContainerHealth;
    return { ready: !!d.ready, aquecendo: d.aquecendo };
  } catch {
    return { ready: false, aquecendo: true };
  }
}

/** Status HTTP tratados como "container frio / indisponível temporário". */
const COLD_HTTP = new Set([429, 500, 502, 503, 504]);

/**
 * POST de upload com RETRY transparente em cold-start. Se a tentativa falhar
 * com 5xx/429 ou erro de rede (container hibernando), aquece o container
 * (`pingContainerHealth`) e reenvia — o cliente nunca vê o erro de container
 * frio. `criarBody` é uma FACTORY: reconstrói o FormData a cada tentativa (o
 * body é consumido em cada `fetch`). Erros NÃO-frios (4xx, validação) e a
 * última tentativa são devolvidos/relançados normalmente ao caller.
 */
export async function uploadComWarmup(
  url: string,
  criarBody: () => BodyInit,
  opts: { headers?: Record<string, string>; maxTentativas?: number } = {},
): Promise<Response> {
  const max = Math.max(1, opts.maxTentativas ?? 3);
  let erroRede: unknown = null;
  for (let i = 0; i < max; i++) {
    const ultima = i === max - 1;
    try {
      const res = await fetch(url, {
        method: "POST",
        ...(opts.headers ? { headers: opts.headers } : {}),
        body: criarBody(),
      });
      // Sucesso, erro não-frio, ou última tentativa → devolve ao caller.
      if (res.ok || !COLD_HTTP.has(res.status) || ultima) return res;
    } catch (e) {
      erroRede = e;
      if (ultima) throw e;
    }
    // Cold: aquece o container e espera (backoff) antes de tentar de novo.
    await pingContainerHealth().catch(() => {});
    await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
  }
  if (erroRede) throw erroRede;
  throw new Error("uploadComWarmup: falha inesperada"); // inalcançável
}
