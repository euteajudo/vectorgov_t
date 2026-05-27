/**
 * Endpoints REST de configuração — modelos por função + teste de API key.
 *
 *   GET    /api/config/models         → ModelConfig atual (defaults + KV)
 *   PUT    /api/config/models         → atualiza parcial; persiste em KV
 *   POST   /api/config/test-key       → header X-Google-API-Key; faz call mínima
 *
 * A API key NÃO é persistida — só atravessa o servidor pra validação ou
 * uso na hora.
 */
import { z } from "zod";
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import {
  getModelConfig,
  setModelConfig,
  FUNCAO_MODELO,
  MODELO_LLM,
} from "../lib/model-config.js";
import { extractApiKey } from "../lib/api-key.js";
import { testarChaveGoogle } from "../agents/llm/google.js";

const ModeloEnum = z.enum(MODELO_LLM);

/**
 * Body do PUT /api/config/models — todas as chaves são opcionais.
 */
const PutModelosBodySchema = z.object({
  modelos: z
    .object(
      Object.fromEntries(
        FUNCAO_MODELO.map((f) => [f, ModeloEnum.optional()]),
      ) as never,
    )
    .partial(),
});

export async function handleGetModelos(
  _request: Request,
  env: Env,
): Promise<Response> {
  const cfg = await getModelConfig(env);
  return jsonResponse(cfg);
}

export async function handlePutModelos(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("body inválido (JSON esperado)", 400);
  }
  const parsed = PutModelosBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      `payload inválido: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      400,
    );
  }
  const atualizado = await setModelConfig(env, {
    modelos: parsed.data.modelos as never,
  });
  return jsonResponse(atualizado);
}

export async function handleTestKey(
  request: Request,
  _env: Env,
): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return jsonResponse(
      { ok: false, message: "Header X-Google-API-Key ausente" },
      400,
    );
  }
  const result = await testarChaveGoogle(apiKey);
  return jsonResponse(result, result.ok ? 200 : 400);
}
