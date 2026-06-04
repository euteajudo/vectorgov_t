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
