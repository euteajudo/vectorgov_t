/**
 * Tool MCP: `listar_acordaos`
 *
 * Lista os acórdãos do TCU já carregados (D1 `vectorgov-a-db` via
 * `DB_ACORDAOS`). Espelha `fs_listar_normas` das leis — alimenta a interface
 * administrativa "Acórdãos carregados" no web-ui.
 */
import { z } from "zod";
import type { Env } from "../../../env.js";
import { listarAcordaos } from "../../../lib/acordaos-list.js";
import { type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const ListarAcordaosInput = z.object({});

async function handler(_args: unknown, env: Env): Promise<unknown> {
  const acordaos = await listarAcordaos(env);
  return { acordaos, total: acordaos.length };
}

export const listarAcordaosTool: ToolDescriptor = {
  name: "listar_acordaos",
  description:
    "Lista os acórdãos do TCU já carregados no sistema (número, ano, colegiado, " +
    "relator, processo TC e contagem de chunks: total + os indexados no índice " +
    "semântico). Use para a interface administrativa de acórdãos carregados — " +
    "análogo a fs_listar_normas das leis.",
  inputSchema: zodToMcpSchema(ListarAcordaosInput),
  handler,
};
