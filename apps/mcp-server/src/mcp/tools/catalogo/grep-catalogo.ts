/**
 * Tool MCP `grep_catalogo` (Track D).
 *
 * Varredura textual exata no catálogo CATMAT/CATSER via D1 FTS5/BM25 (sem
 * embedding). Complementa a busca semântica quando se quer precisão por termo
 * ou código. Mesmo motor do `fs_grep` das leis, sobre `catalogo_fts`.
 */
import type { Env } from "../../../env.js";
import {
  GrepCatalogoInputSchema,
  type CatalogoBuscaResultado,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { grepCatalogo } from "../../../lib/catalogo-search.js";

async function handler(args: unknown, env: Env): Promise<CatalogoBuscaResultado> {
  const parsed = GrepCatalogoInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "grep_catalogo: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  return grepCatalogo(env, parsed.data);
}

export const grepCatalogoTool: ToolDescriptor = {
  name: "grep_catalogo",
  description:
    "Busca textual exata (FTS5/BM25) no catálogo CATMAT/CATSER. Use para varredura " +
    "por termo específico ou conferência; complementa buscar_catalogo_semantico.",
  inputSchema: zodToMcpSchema(GrepCatalogoInputSchema),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
