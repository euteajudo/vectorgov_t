/**
 * Tool MCP: `fs_listar_estrutura`
 *
 * Lê o `_sumario.json` de uma norma (path: `{norma_id}/_sumario.json`) e
 * devolve a árvore hierárquica (livros → títulos → capítulos → artigos).
 *
 * Esse "mapa" permite ao agente navegar a norma sem precisar listar todos
 * os artigos um a um.
 */

import type { Env } from "../../../env.js";
import {
  FsListarEstruturaInput,
  type FsListarEstruturaOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

/**
 * Estrutura "raw" esperada no R2 — recursiva por design (livros aninham
 * títulos, títulos aninham capítulos, etc.).
 */
interface NoSumario {
  tipo: string;
  numero: string | null;
  titulo: string | null;
  caminho: string;
  filhos: NoSumario[];
}

interface SumarioFile {
  estrutura: NoSumario[];
  total_dispositivos: number;
}

/**
 * Conta dispositivos folha (sem filhos) — fallback caso o `_sumario.json`
 * não traga `total_dispositivos`.
 */
function countLeaves(nodes: NoSumario[]): number {
  let n = 0;
  for (const node of nodes) {
    if (!node.filhos || node.filhos.length === 0) n += 1;
    else n += countLeaves(node.filhos);
  }
  return n;
}

async function handler(
  args: unknown,
  env: Env,
): Promise<FsListarEstruturaOutputT> {
  const parsed = FsListarEstruturaInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_listar_estrutura: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const key = `${input.norma_id}/_sumario.json`;
  const obj = await env.R2_LEIS.get(key);
  if (!obj) {
    throw new ToolValidationError(
      `fs_listar_estrutura: sumário não encontrado em R2 para norma '${input.norma_id}'`,
    );
  }
  let parsedJson: SumarioFile;
  try {
    parsedJson = (await obj.json()) as SumarioFile;
  } catch {
    throw new Error(
      `fs_listar_estrutura: ${key} no R2 não é JSON válido`,
    );
  }
  const estrutura = parsedJson.estrutura ?? [];
  return {
    norma_id: input.norma_id,
    estrutura,
    total_dispositivos:
      parsedJson.total_dispositivos ?? countLeaves(estrutura),
  };
}

export const fsListarEstruturaTool: ToolDescriptor = {
  name: "fs_listar_estrutura",
  description:
    "Devolve a árvore hierárquica de uma norma (livros, títulos, capítulos, " +
    "seções, artigos) lendo {norma_id}/_sumario.json do bucket R2.",
  inputSchema: zodToMcpSchema(FsListarEstruturaInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
