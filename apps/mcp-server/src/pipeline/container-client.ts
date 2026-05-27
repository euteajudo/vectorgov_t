/**
 * Cliente HTTP do Container Python (ingestion-api).
 *
 * - Envia `multipart/form-data` para `POST /parse` com o PDF binário e
 *   metadata (lei_id, lei_tipo, numero, ano, data_publicacao).
 * - Autentica via header `X-Ingestion-Secret` (env.INGESTION_API_SECRET).
 * - Valida o ParseResult retornado contra o Zod schema.
 *
 * Mantemos a URL como constante para evitar dependência de variável de
 * ambiente extra — se mudar de host, basta bumpar `CONTAINER_BASE_URL`.
 * Caso futuro: passar a ler de `wrangler.toml` via `[vars]`.
 */

import { ParseResultSchema, type ParseResult } from "@vectorgov-t/schemas";
import type { Env } from "../env.js";

/**
 * URL do Worker do Container Python (legisparser).
 *
 * Hard-coded por ora porque é estável e o secret de autenticação é o que
 * realmente protege o acesso. Mudar para `env.CONTAINER_URL` quando
 * passarmos a ter ambientes (dev/staging/prod).
 */
const CONTAINER_BASE_URL = "https://vectorgov-t-ingestion.souzat19.workers.dev";

/**
 * Timeout do fetch — Containers podem demorar até 5min para parsear PDFs
 * grandes (LC 214 com 165 páginas). 6min de margem.
 */
const PARSE_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Parâmetros de entrada do parser.
 */
export interface ParseInput {
  pdf: Blob;
  pdfFilename: string;
  leiId: string;
  leiTipo: string;
  numero: string;
  ano: number;
  dataPublicacao: string;
}

/**
 * Erro lançado quando o Container retorna != 2xx.
 *
 * Inclui o status code e o body (truncado em 1KB) para diagnóstico.
 */
export class ContainerParseError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(status: number, body: string) {
    super(
      `Container /parse retornou ${status}: ${body.slice(0, 200)}`,
    );
    this.name = "ContainerParseError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Chama o Container Python para parsear o PDF e devolve o ParseResult validado.
 *
 * Lança `ContainerParseError` em qualquer status != 2xx. Lança erro genérico
 * se o JSON não passar pelo Zod schema (indica drift de contrato).
 *
 * O `AbortController` garante que o fetch não fique pendurado
 * indefinidamente — após `PARSE_TIMEOUT_MS` o orchestrator pode marcar
 * a ingestão como failed.
 */
export async function callContainerParse(
  env: Env,
  input: ParseInput,
): Promise<ParseResult> {
  const secret = env.INGESTION_API_SECRET;
  if (!secret) {
    throw new Error("INGESTION_API_SECRET não configurado no Worker");
  }

  const form = new FormData();
  form.append("pdf", input.pdf, input.pdfFilename);
  form.append("lei_id", input.leiId);
  form.append("lei_tipo", input.leiTipo);
  form.append("numero", input.numero);
  form.append("ano", String(input.ano));
  form.append("data_publicacao", input.dataPublicacao);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${CONTAINER_BASE_URL}/parse`, {
      method: "POST",
      headers: {
        "X-Ingestion-Secret": secret,
        // Não setamos Content-Type — fetch infere boundary do FormData.
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Timeout chamando Container /parse após ${PARSE_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "<sem body>");
    throw new ContainerParseError(response.status, body);
  }

  const json = (await response.json()) as unknown;
  const parsed = ParseResultSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Resposta do Container não bate com ParseResultSchema: ${issues}`,
    );
  }
  return parsed.data;
}
