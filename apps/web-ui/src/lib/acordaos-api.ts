/**
 * Cliente HTTP do módulo de Acórdãos do TCU.
 *
 * Reconstruído a partir do bundle deployado (`vectorgov-a-mcp`) — o source
 * original foi feito em outra máquina e nunca chegou a este repo. Mesmo padrão
 * de ingestão das leis (`/ingestao/iniciar` + `/ingestao/status/:id`), porém:
 *  - aponta para o Worker dedicado de acórdãos (`vectorgov-a-mcp`);
 *  - sobe um arquivo **Markdown** (não PDF);
 *  - autentica com um segredo no header `Authorization: Bearer <segredo>`
 *    (guardado no browser, em `localStorage["vga_ingestion_secret"]`).
 */
"use client";

/**
 * Base do Worker de acórdãos. Hardcoded (como no bundle original) — não vem de
 * `NEXT_PUBLIC_*` para não depender do ambiente de build. Override por env, se
 * algum dia o Worker mudar de host.
 */
const BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ACORDAOS_BASE_URL) ||
  "https://vectorgov-a-mcp.souzat19.workers.dev";

/** Chave do segredo de ingestão no browser. */
export const SECRET_STORAGE_KEY = "vga_ingestion_secret";

/** Formato fixo enviado ao backend (arquivo é sempre Markdown). */
const FORMATO = "md";

/** Colegiados do TCU aceitos pelo backend. */
export const COLEGIADOS = [
  { value: "plenario", label: "Plenário" },
  { value: "primeira_camara", label: "Primeira Câmara" },
  { value: "segunda_camara", label: "Segunda Câmara" },
] as const;

/** Extensões aceitas para o arquivo de acórdão (todas tratadas como Markdown). */
export const EXTENSOES_ACEITAS = [".md", ".markdown", ".txt"];

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

/** Lê o segredo salvo no browser. */
export function getSegredo(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SECRET_STORAGE_KEY) ?? "";
}

/** Salva (ou limpa) o segredo no browser. */
export function setSegredo(segredo: string): void {
  if (typeof window === "undefined") return;
  const v = segredo.trim();
  if (v) window.localStorage.setItem(SECRET_STORAGE_KEY, v);
  else window.localStorage.removeItem(SECRET_STORAGE_KEY);
}

/**
 * Inicia a ingestão de um acórdão (upload do Markdown + metadata). Retorna o
 * `ingestaoId` para acompanhar o status. Lança erro com mensagem amigável.
 */
export async function iniciarIngestaoAcordao(
  arquivo: File,
  meta: AcordaoMeta,
  segredo: string,
): Promise<string> {
  const body = new FormData();
  body.append("arquivo", arquivo, arquivo.name);
  body.append("numero", meta.numero);
  body.append("ano", String(meta.ano));
  body.append("colegiado", meta.colegiado);
  body.append("formato", FORMATO);

  const res = await fetch(`${BASE}/ingestao/iniciar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${segredo.trim()}` },
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
