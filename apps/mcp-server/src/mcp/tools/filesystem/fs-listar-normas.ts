/**
 * Tool MCP: `fs_listar_normas`
 *
 * Lê o `_index.json` (top-level do bucket `R2_LEIS`) e devolve o catálogo
 * de normas. Cache KV de 6h para evitar hot-path no R2.
 *
 * Estrutura esperada do `_index.json`:
 * ```json
 * {
 *   "normas": [
 *     { "norma_id": "lei-14133-2021", "tipo": "lei", "numero": "14133",
 *       "ano": 2021, "ementa": "...", "r2_path": "lei-14133-2021/" }
 *   ]
 * }
 * ```
 */

import type { Env } from "../../../env.js";
import {
  FsListarNormasInput,
  type FsListarNormasOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { cacheGet, cacheSet } from "../../../lib/cache.js";

/** TTL do cache do índice em segundos (6h). */
const INDEX_CACHE_TTL = 6 * 60 * 60;
const INDEX_CACHE_KEY = "fs:listar_normas:_index_v1";
const INDEX_R2_KEY = "_index.json";

interface NormaEntry {
  norma_id: string;
  id?: string;
  tipo: string;
  numero: string;
  ano: number;
  ementa: string | null;
  r2_path: string;
}

interface IndexFile {
  normas: NormaEntry[];
}

/**
 * Carrega o `_index.json` do R2 — `null` se o objeto não existir.
 */
async function loadFromR2(env: Env): Promise<IndexFile | null> {
  const obj = await env.R2_LEIS.get(INDEX_R2_KEY);
  if (!obj) return null;
  try {
    return (await obj.json()) as IndexFile;
  } catch {
    throw new Error(`fs_listar_normas: _index.json do R2 não é JSON válido`);
  }
}

async function handler(args: unknown, env: Env): Promise<FsListarNormasOutputT> {
  const parsed = FsListarNormasInput.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_listar_normas: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  // 1) Tenta cache
  let fonte: "cache" | "r2" = "cache";
  let idx = await cacheGet<IndexFile>(env, INDEX_CACHE_KEY);
  if (!idx) {
    fonte = "r2";
    const fromR2 = await loadFromR2(env);
    if (!fromR2) {
      // Bucket vazio na fase de bootstrap — devolve lista vazia, não erro.
      return { normas: [], total: 0, fonte: "r2" };
    }
    idx = fromR2;
    await cacheSet(env, INDEX_CACHE_KEY, idx, INDEX_CACHE_TTL);
  }

  const normalizadas = idx.normas.map((n) => ({
    ...n,
    norma_id: n.norma_id ?? n.id ?? "",
  }));
  const normas = input.tipo
    ? normalizadas.filter((n) => n.tipo === input.tipo)
    : normalizadas;

  return {
    normas,
    total: normas.length,
    fonte,
  };
}

export const fsListarNormasTool: ToolDescriptor = {
  name: "fs_listar_normas",
  description:
    "Lista o catálogo de normas (lê _index.json do bucket R2 com cache KV de 6h). " +
    "Filtro opcional por tipo (lei, decreto, instrucao_normativa, etc.).",
  inputSchema: zodToMcpSchema(FsListarNormasInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
