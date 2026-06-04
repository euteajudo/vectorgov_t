/**
 * Handlers HTTP do orquestrador de ingestão.
 *
 * - `POST /ingestao/iniciar` (multipart): recebe PDF + metadata, cria
 *   registro de status, dispara o pipeline em background via
 *   `ctx.waitUntil()` e responde 202 com `{ ingestao_id }`.
 * - `GET /ingestao/status/:id`: lê do KV e devolve o `IngestaoStatus`.
 *
 * Esses handlers ficam isolados em arquivo próprio para manter
 * `src/index.ts` enxuto e legível.
 */

import { IngestaoIniciarInputSchema } from "@vectorgov-t/schemas";
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import {
  createStatus,
  newIngestaoId,
  readStatus,
  runIngestionPipeline,
} from "./orchestrator.js";

/**
 * Tamanho máximo de PDF aceito (em bytes). Workers tem limite de body
 * em 100MB no plano pago — fixamos em 50MB para deixar margem.
 */
const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Tenta extrair as 5 campos de metadata + o PDF do FormData.
 *
 * Devolve `{ ok: true, data }` ou `{ ok: false, error }` para o caller
 * traduzir em 400.
 */
function extractFormData(form: FormData):
  | {
      ok: true;
      data: {
        pdf: File;
        leiId: string;
        leiTipo: string;
        numero: string;
        ano: number;
        dataPublicacao: string;
        reingestao: boolean;
        ingestaoId?: string;
      };
    }
  | { ok: false; error: string } {
  const pdfRaw = form.get("pdf");
  if (!(pdfRaw instanceof File)) {
    return { ok: false, error: "Campo 'pdf' ausente ou não é arquivo" };
  }
  if (pdfRaw.size === 0) {
    return { ok: false, error: "Arquivo 'pdf' está vazio" };
  }
  if (pdfRaw.size > MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `Arquivo 'pdf' excede ${MAX_PDF_BYTES} bytes`,
    };
  }
  // Validação básica de tipo — não rejeitamos mime inválido (alguns
  // browsers mandam application/octet-stream), mas exigimos extensão .pdf.
  if (!pdfRaw.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Arquivo deve ter extensão .pdf" };
  }

  const leiId = form.get("lei_id");
  const leiTipo = form.get("lei_tipo");
  const numero = form.get("numero");
  const anoRaw = form.get("ano");
  const dataPublicacao = form.get("data_publicacao");
  const reingestaoRaw = form.get("reingestao");

  if (typeof leiId !== "string" || typeof leiTipo !== "string" ||
      typeof numero !== "string" || typeof dataPublicacao !== "string" ||
      typeof anoRaw !== "string") {
    return {
      ok: false,
      error: "Campos obrigatórios: lei_id, lei_tipo, numero, ano, data_publicacao (todos strings/numeros)",
    };
  }

  const ano = Number.parseInt(anoRaw, 10);
  if (!Number.isFinite(ano) || ano <= 0) {
    return { ok: false, error: "'ano' deve ser inteiro positivo" };
  }

  // Aceita "true"/"1" → true, qualquer outro → false. Default true.
  let reingestao = true;
  if (typeof reingestaoRaw === "string") {
    reingestao = reingestaoRaw === "true" || reingestaoRaw === "1";
  }

  // ID opcional do cliente — permite o front navegar para a tela de status
  // (polling) ANTES do pipeline terminar, mostrando progresso desde o início.
  // Sem ele, o orquestrador gera o próprio UUID.
  const ingestaoIdRaw = form.get("ingestao_id");
  let ingestaoId: string | undefined;
  if (typeof ingestaoIdRaw === "string" && ingestaoIdRaw.length > 0) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        ingestaoIdRaw,
      )
    ) {
      return { ok: false, error: "ingestao_id, se enviado, deve ser UUID" };
    }
    ingestaoId = ingestaoIdRaw;
  }

  // Validação Zod aplicada na metadata (mas não no File).
  const parsed = IngestaoIniciarInputSchema.safeParse({
    lei_id: leiId,
    lei_tipo: leiTipo,
    numero,
    ano,
    data_publicacao: dataPublicacao,
    reingestao,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Metadata inválida: ${detail}` };
  }

  return {
    ok: true,
    data: {
      pdf: pdfRaw,
      leiId: parsed.data.lei_id,
      leiTipo: parsed.data.lei_tipo,
      numero: parsed.data.numero,
      ano: parsed.data.ano,
      dataPublicacao: parsed.data.data_publicacao,
      reingestao: parsed.data.reingestao,
      ingestaoId,
    },
  };
}

/**
 * `POST /ingestao/iniciar` — começa o pipeline.
 *
 * Retorna 202 Accepted com `{ ingestao_id, status }`. O processamento
 * roda em background via `ctx.waitUntil()`.
 */
export async function handleIngestaoIniciar(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse(
      "Content-Type deve ser multipart/form-data",
      415,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "FormData inválido";
    return errorResponse(`Falha ao ler multipart: ${msg}`, 400);
  }

  const extracted = extractFormData(form);
  if (!extracted.ok) {
    return errorResponse(extracted.error, 400);
  }
  const data = extracted.data;

  // Cria status pending no KV. Usa o id do cliente se enviado (permite o front
  // fazer polling imediato na tela de status), senão gera um.
  const id = data.ingestaoId ?? newIngestaoId();
  const initial = await createStatus(env, { id, leiId: data.leiId });

  // Snapshot do PDF em memória — `File` lê só uma vez; precisamos do Blob
  // estável para passar ao Container fora do request scope.
  const arrayBuffer = await data.pdf.arrayBuffer();
  const pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });

  // Modo SYNC vs ASYNC.
  //
  // ASYNC (?sync=false ou omitido): dispara via `ctx.waitUntil` e retorna 202.
  // Bom para clientes que querem polling do /status. Limitação: o waitUntil
  // tem timeout (~30s no Standard) e pode ser CANCELADO antes do pipeline
  // terminar para PDFs grandes (LC 214 leva ~3 min). Workaround: usar `?sync=true`.
  //
  // SYNC (?sync=true): aguarda o pipeline inteiro antes de retornar 200.
  // Bom para CLI/integrações que toleram requests longos (até ~15 min wall
  // clock no Standard, pois CPU time é limitado mas I/O não). Trade-off:
  // cliente precisa de timeout HTTP adequado.
  const url = new URL(request.url);
  const isSync = url.searchParams.get("sync") === "true";

  const pipelineInput = {
    ingestaoId: id,
    pdf: pdfBlob,
    pdfFilename: data.pdf.name,
    leiId: data.leiId,
    leiTipo: data.leiTipo,
    numero: data.numero,
    ano: data.ano,
    dataPublicacao: data.dataPublicacao,
  };

  if (isSync) {
    try {
      await runIngestionPipeline(env, pipelineInput);
      const finalStatus = await readStatus(env, id);
      return jsonResponse(
        { ingestao_id: id, lei_id: data.leiId, status: finalStatus, status_url: `/ingestao/status/${id}` },
        200,
      );
    } catch (err) {
      return errorResponse(
        `Falha no pipeline: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        500,
      );
    }
  }

  // Modo ASYNC (default) — background via waitUntil.
  ctx.waitUntil(runIngestionPipeline(env, pipelineInput));

  return jsonResponse(
    {
      ingestao_id: id,
      lei_id: data.leiId,
      status: initial,
      status_url: `/ingestao/status/${id}`,
    },
    202,
  );
}

/**
 * `GET /ingestao/status/:id` — devolve o registro atual.
 *
 * 404 se não encontrar (KV pode ter expirado após 24h ou ID inválido).
 */
export async function handleIngestaoStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  // Esperado: ['ingestao', 'status', '<id>']
  const id = segments[2];
  if (!id || segments.length !== 3) {
    return errorResponse("Caminho inválido: use /ingestao/status/:id", 400);
  }

  const status = await readStatus(env, id);
  if (status === null) {
    return errorResponse(`Ingestão ${id} não encontrada`, 404);
  }
  return jsonResponse(status);
}

/** Timeout do ping de health do Container (cold-start excede isto de propósito). */
const HEALTH_PING_TIMEOUT_MS = 4500;

/**
 * GET /ingestao/health — pinga o `/health` do Container Python (via service
 * binding `INGESTION`). O ping ESQUENTA o container: se estiver frio, dispara o
 * cold-start. Timeout curto — se não responder a tempo, devolve `ready:false`
 * + `aquecendo:true` (o warm-up já começou; o cliente re-checa em segundos).
 * NÃO lança: a UI só precisa do booleano `ready`.
 *
 * Como leis (vectorgov-t-mcp) e acórdãos (vectorgov-a-mcp) usam o MESMO
 * Container (`vectorgov-t-ingestion`), este único endpoint aquece os dois fluxos.
 */
export async function handleIngestaoHealth(env: Env): Promise<Response> {
  const t0 = Date.now();
  if (!env.INGESTION) {
    return jsonResponse({ ready: false, motivo: "binding INGESTION ausente" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_PING_TIMEOUT_MS);
  try {
    const res = await env.INGESTION.fetch(
      new Request("https://ingestion.local/health", {
        signal: controller.signal,
      }),
    );
    return jsonResponse({ ready: res.ok, status: res.status, ms: Date.now() - t0 });
  } catch (err) {
    return jsonResponse({
      ready: false,
      aquecendo: true,
      ms: Date.now() - t0,
      erro: err instanceof Error ? err.name : "erro",
    });
  } finally {
    clearTimeout(timer);
  }
}
