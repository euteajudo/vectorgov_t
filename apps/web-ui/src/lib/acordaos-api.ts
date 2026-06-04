/**
 * Cliente HTTP do módulo de Acórdãos do TCU.
 *
 * Reconstruído a partir do bundle deployado (`vectorgov-a-mcp`). Mesmo padrão
 * de ingestão das leis (`/ingestao/iniciar` + `/ingestao/status/:id`), e — por
 * decisão do produto — **igual à interface de leis**: upload de **PDF** e
 * **sem segredo** (sem header de autenticação no browser).
 *
 * NOTA: o Worker `vectorgov-a-mcp` é mantido fora deste repo. Para o upload de
 * PDF funcionar de ponta a ponta, o backend precisa aceitar PDF (o pipeline
 * original lia Markdown). O frontend já está no formato final; a compatibilidade
 * do backend deve ser validada com um upload real.
 */
"use client";

/**
 * Base do Worker de acórdãos. Hardcoded (como no bundle original) — não vem de
 * `NEXT_PUBLIC_*` para não depender do ambiente de build. Override por env.
 */
const BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ACORDAOS_BASE_URL) ||
  "https://vectorgov-a-mcp.souzat19.workers.dev";

/** Formato enviado ao backend (arquivo é PDF, como nas leis). */
const FORMATO = "pdf";

/** Colegiados do TCU aceitos pelo backend. */
export const COLEGIADOS = [
  { value: "plenario", label: "Plenário" },
  { value: "primeira_camara", label: "Primeira Câmara" },
  { value: "segunda_camara", label: "Segunda Câmara" },
] as const;

export interface AcordaoMeta {
  numero: string;
  ano: number;
  colegiado: string;
}

export interface AcordaoStatus {
  fase?: string;
  status?: string;
  progresso_pct?: number;
  tokens_consumidos?: number;
  acordao_id?: string;
  mensagem?: string;
}

/**
 * Inicia a ingestão de um acórdão (upload do PDF + metadata). Retorna o
 * `ingestaoId` para acompanhar o status. Sem segredo (igual às leis). Lança
 * erro com mensagem amigável.
 */
export async function iniciarIngestaoAcordao(
  arquivo: File,
  meta: AcordaoMeta,
): Promise<string> {
  const body = new FormData();
  body.append("arquivo", arquivo, arquivo.name);
  body.append("numero", meta.numero);
  body.append("ano", String(meta.ano));
  body.append("colegiado", meta.colegiado);
  body.append("formato", FORMATO);

  const res = await fetch(`${BASE}/ingestao/iniciar`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Falha ao iniciar ingestão (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as {
    ingestaoId?: string;
    ingestao_id?: string;
  };
  const id = data.ingestaoId ?? data.ingestao_id;
  if (!id) {
    throw new Error("Resposta sem ingestaoId — backend não retornou o ID.");
  }
  return id;
}

/**
 * Lê o status de uma ingestão em andamento. Devolve `null` no 404 (ID
 * desconhecido / TTL expirado) para o polling distinguir "sumiu" de "rodando".
 */
export async function getStatusAcordao(id: string): Promise<AcordaoStatus | null> {
  const res = await fetch(`${BASE}/ingestao/status/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Falha no status (${res.status}): ${res.statusText}`);
  }
  return (await res.json()) as AcordaoStatus;
}

/* ------------------------------------------------------------------ *
 * Listagem dos acórdãos carregados.
 *
 * ATENÇÃO: a LISTAGEM não fala com o `vectorgov-a-mcp` (upload) e sim com o
 * `vectorgov-t-mcp` — que tem o binding read-only `DB_ACORDAOS` e expõe a tool
 * MCP `listar_acordaos` no endpoint `/mcp/v1` (mesmo padrão do `fs_listar_normas`
 * das leis). Por isso a base aqui é a do MCP, não a de ingestão.
 * ------------------------------------------------------------------ */

/** Base do `vectorgov-t-mcp` (onde vive a tool `listar_acordaos`). */
function getMcpBaseUrl(): string {
  if (typeof process !== "undefined") {
    const url =
      process.env.NEXT_PUBLIC_MCP_WORKER_URL ??
      process.env.NEXT_PUBLIC_MCP_BASE_URL;
    if (url) return url;
  }
  return "https://vectorgov-t-mcp.souzat19.workers.dev";
}

/** Item da listagem de acórdãos carregados (saída de `listar_acordaos`). */
export interface AcordaoListItem {
  acordao_id: string;
  numero: string;
  ano: number;
  colegiado: string;
  relator: string | null;
  processo_tc: string | null;
  data_sessao: string | null;
  total_itens: number;
  total_indexados: number;
  criado_em: string | null;
}

/**
 * Lista os acórdãos já carregados — via tool MCP `listar_acordaos` (JSON-RPC)
 * no `vectorgov-t-mcp`. Espelha `listarNormas` das leis.
 */
export async function listarAcordaos(): Promise<AcordaoListItem[]> {
  const res = await fetch(`${getMcpBaseUrl()}/mcp/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "listar_acordaos", arguments: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao listar acórdãos (${res.status})`);
  }
  const rpc = (await res.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (rpc.error) {
    throw new Error(rpc.error.message ?? "erro do MCP ao listar acórdãos");
  }
  const texto = rpc.result?.content?.[0]?.text ?? "{}";
  const data = JSON.parse(texto) as { acordaos?: AcordaoListItem[] };
  return data.acordaos ?? [];
}
