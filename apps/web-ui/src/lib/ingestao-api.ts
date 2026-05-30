/**
 * Cliente HTTP isolado da Track I — fala com o Worker MCP em
 * `/ingestao/iniciar` e `/ingestao/status/:id`.
 *
 * Arquivo separado de `lib/api.ts` (que pertence à Track H) para evitar
 * conflito de merge. Se a Track H consolidar um cliente genérico depois,
 * estes wrappers podem migrar — mantemos a interface estável aqui.
 *
 * TODO(merge Track H): trocar `fetch` direto por wrapper compartilhado se a
 * Track H expor `lib/api.ts` com headers/retry centralizados.
 */
"use client";

import type {
  IngestaoIniciarInput,
  IngestaoStatus,
} from "@vectorgov-t/schemas";

/**
 * URL base do Worker MCP. Lida de `NEXT_PUBLIC_MCP_WORKER_URL` em runtime
 * (precisa estar disponível no client). Fallback para localhost durante dev.
 *
 * Não usamos `process.env` direto em tempo de build porque o usuário pode
 * trocar de ambiente sem rebuild — em Cloudflare Pages, env vars públicas
 * são injetadas no bundle como `NEXT_PUBLIC_*`.
 */
function getBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_MCP_WORKER_URL) {
    return process.env.NEXT_PUBLIC_MCP_WORKER_URL;
  }
  return "http://localhost:8787";
}

/**
 * Metadata mínima do form de upload (subset do `IngestaoIniciarInput`).
 *
 * `reingestao` é forçado `true` para o orquestrador limpar antes do upsert
 * — comportamento idempotente que combina com o uso administrativo.
 */
export type NormaInput = Omit<IngestaoIniciarInput, "reingestao">;

/**
 * Resposta do `POST /ingestao/iniciar` — devolve 202 com o ID e a URL de
 * status para polling.
 */
export interface IngestaoResponse {
  ingestao_id: string;
  lei_id: string;
  status: IngestaoStatus;
  status_url: string;
}

/**
 * Item da listagem de normas — espelha um `NormaEntry` do `_index.json`,
 * acrescido de dois campos derivados que a UI mostra como colunas (data de
 * ingestão e contagem total de dispositivos). Como a fonte ainda não expõe
 * esses dois campos, eles podem chegar `undefined` da API real.
 */
export interface NormaListItem {
  norma_id: string;
  tipo: string;
  numero: string;
  ano: number;
  ementa: string | null;
  r2_path: string;
  data_ingestao?: string;
  total_dispositivos?: number;
  status?: string;
}

/**
 * Sobe um PDF + metadata para o orquestrador.
 *
 * Lança erro com mensagem amigável se a API recusar (400/415/500). O caller
 * deve envolver em try/catch e mostrar o `message` ao usuário.
 */
export async function uploadNorma(
  pdf: File,
  meta: NormaInput,
  ingestaoId?: string,
): Promise<IngestaoResponse> {
  const form = new FormData();
  form.append("pdf", pdf, pdf.name);
  form.append("lei_id", meta.lei_id);
  form.append("lei_tipo", meta.lei_tipo);
  form.append("numero", meta.numero);
  form.append("ano", String(meta.ano));
  form.append("data_publicacao", meta.data_publicacao);
  form.append("reingestao", "true");
  // Id gerado no cliente: o front navega para a tela de status (polling) ANTES
  // do pipeline terminar, então a barra aparece desde o início.
  if (ingestaoId) form.append("ingestao_id", ingestaoId);

  // ?sync=true mantém a conexão aberta durante todo o pipeline (sem o
  // cancelamento do ctx.waitUntil() em PDFs grandes). O progresso continua
  // visível porque o orquestrador grava o status no KV a cada fase e a tela de
  // status faz polling em paralelo com este request.
  const res = await fetch(`${getBaseUrl()}/ingestao/iniciar?sync=true`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Falha no upload (${res.status}): ${txt}`);
  }
  return (await res.json()) as IngestaoResponse;
}

/**
 * Lê o status de uma ingestão em andamento (ou finalizada — fica 24h no KV).
 *
 * Devolve `null` no 404 (ID desconhecido ou TTL expirado) para o polling
 * conseguir distinguir "ainda processando" de "sumiu".
 */
export async function getStatus(id: string): Promise<IngestaoStatus | null> {
  const res = await fetch(`${getBaseUrl()}/ingestao/status/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Falha no status (${res.status}): ${res.statusText}`);
  }
  return (await res.json()) as IngestaoStatus;
}

/**
 * Lista as normas realmente ingeridas — lê o catálogo (`_index.json` do R2) via
 * a tool MCP `fs_listar_normas` (JSON-RPC). É o que faz o botão "Atualizar"
 * refletir normas recém-ingeridas (antes era um mock fixo).
 */
export async function listarNormas(): Promise<NormaListItem[]> {
  const res = await fetch(`${getBaseUrl()}/mcp/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fs_listar_normas", arguments: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao listar normas (${res.status})`);
  }
  const rpc = (await res.json()) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (rpc.error) {
    throw new Error(rpc.error.message ?? "erro do MCP ao listar normas");
  }
  const texto = rpc.result?.content?.[0]?.text ?? "{}";
  const data = JSON.parse(texto) as {
    normas?: Array<{
      norma_id: string;
      tipo: string;
      numero: string;
      ano: number;
      ementa: string | null;
      r2_path: string;
    }>;
  };
  return (data.normas ?? []).map((n) => ({
    norma_id: n.norma_id,
    tipo: n.tipo,
    numero: n.numero,
    ano: n.ano,
    ementa: n.ementa,
    r2_path: n.r2_path,
  }));
}

/**
 * Dispara re-ingestão de uma norma já existente. Placeholder — quando o
 * backend expuser, deverá reaproveitar o último PDF do R2.
 */
export async function reingerirNorma(normaId: string): Promise<void> {
  console.warn(`[mock] reingerirNorma(${normaId}) — endpoint ainda não existe`);
  return Promise.resolve();
}

/**
 * Remove uma norma e todos os seus dispositivos. Placeholder.
 */
export async function removerNorma(normaId: string): Promise<void> {
  console.warn(`[mock] removerNorma(${normaId}) — endpoint ainda não existe`);
  return Promise.resolve();
}
