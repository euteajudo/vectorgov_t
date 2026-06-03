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
