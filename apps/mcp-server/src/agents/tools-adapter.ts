/**
 * Adapter entre as tools MCP (formato `ToolDescriptor`/`ToolDefinition`)
 * e o formato `ToolMCP` que o `PEVSEngine` espera no `AgentContext.tools`.
 *
 * O sistema tem duas fontes de tools:
 *   1. `MCP_TOOLS` array — tools de leis (semantic + filesystem).
 *      Definidas em `mcp/tools/index.ts`. Cada item é um `ToolDescriptor`
 *      com `handler(args, env)`.
 *   2. Registry mutável — tools de skills + extensões.
 *      Definidas via `registerTool()` em `mcp/tools/registry.ts`. Cada
 *      item é um `ToolDefinition` com `zodSchema` + `handler(env, input)`.
 *
 * Esta função consolida ambos em uma lista única de `ToolMCP` que o
 * `PEVSEngine` propaga aos roles via `contexto.tools`.
 */
import type { Env } from "../env.js";
import type { ToolMCP } from "./types.js";
import { MCP_TOOLS } from "../mcp/tools/index.js";
import {
  listToolDescriptors as listRegistryDescriptors,
  invokeTool as invokeRegistryTool,
} from "../mcp/tools/registry.js";

/**
 * Constrói o array de `ToolMCP` consolidado pra o `PEVSEngine`.
 *
 * Dedup: se o mesmo nome aparecer em ambas fontes (improvável mas
 * possível), o ToolDescriptor (MCP_TOOLS) vence — é o caminho mais
 * direto sem validação dupla.
 */
export function buildToolsForPEVS(env: Env): ToolMCP[] {
  const out: ToolMCP[] = [];
  const seen = new Set<string>();

  for (const t of MCP_TOOLS) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push({
      nome: t.name,
      descricao: t.description,
      executar: async (args) => await t.handler(args, env),
    });
  }

  for (const d of listRegistryDescriptors()) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    out.push({
      nome: d.name,
      descricao: d.description,
      executar: async (args) => await invokeRegistryTool(env, d.name, args),
    });
  }

  return out;
}
