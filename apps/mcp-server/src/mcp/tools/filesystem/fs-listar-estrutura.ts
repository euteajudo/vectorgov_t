/**
 * Tool MCP: `fs_listar_estrutura`.
 *
 * Le o `_sumario.json` de uma norma e devolve a arvore hierarquica em um
 * shape estavel para os agentes. Aceita tanto o formato novo
 * `{ estrutura, total_dispositivos }` quanto o formato bruto do parser
 * `{ artigos: ... }`, para manter compatibilidade com artefatos ja gerados.
 */

import type { Env } from "../../../env.js";
import {
  FsListarEstruturaInput,
  type FsListarEstruturaOutputT,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { sumarioToEstruturaFile } from "../../../pipeline/sumario.js";

async function handler(
  args: unknown,
  env: Env,
): Promise<FsListarEstruturaOutputT> {
  const parsed = FsListarEstruturaInput.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "fs_listar_estrutura: argumentos invalidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  const key = `${input.norma_id}/_sumario.json`;
  const obj = await env.R2_LEIS.get(key);
  if (!obj) {
    throw new ToolValidationError(
      `fs_listar_estrutura: sumario nao encontrado em R2 para norma '${input.norma_id}'`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = await obj.json();
  } catch {
    throw new Error(`fs_listar_estrutura: ${key} no R2 nao e JSON valido`);
  }

  const { estrutura, total_dispositivos } = sumarioToEstruturaFile(parsedJson);
  return {
    norma_id: input.norma_id,
    estrutura,
    total_dispositivos,
  };
}

export const fsListarEstruturaTool: ToolDescriptor = {
  name: "fs_listar_estrutura",
  description:
    "Devolve a arvore hierarquica de uma norma lendo {norma_id}/_sumario.json do bucket R2.",
  inputSchema: zodToMcpSchema(FsListarEstruturaInput),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
