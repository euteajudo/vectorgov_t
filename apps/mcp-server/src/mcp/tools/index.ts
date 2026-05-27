/**
 * Registry central das tools MCP.
 *
 * Exporta o array `MCP_TOOLS` na ordem canônica (4 semânticas + 5 filesystem)
 * e um helper `findTool(name)` para o dispatch em `tools/call`.
 *
 * Adicionar uma nova tool:
 *   1. Criar `src/mcp/tools/<grupo>/<slug>.ts` com `export const fooTool: ToolDescriptor`.
 *   2. Importar e incluir aqui em `MCP_TOOLS`.
 *   3. Atualizar `MCP_TOOL_NAMES` em `packages/schemas/src/mcp-tools.ts`.
 */

import type { ToolDescriptor } from "./types.js";

// Semânticas
import { buscarLegislacaoTool } from "./semantic/buscar-legislacao.js";
import { consultarArtigoTool } from "./semantic/consultar-artigo.js";
import { listarArtigosPorTemaTool } from "./semantic/listar-artigos-por-tema.js";
import { compararRedacoesTool } from "./semantic/comparar-redacoes.js";

// Filesystem
import { fsListarNormasTool } from "./filesystem/fs-listar-normas.js";
import { fsListarEstruturaTool } from "./filesystem/fs-listar-estrutura.js";
import { fsLerDispositivoTool } from "./filesystem/fs-ler-dispositivo.js";
import { fsLerIntervaloTool } from "./filesystem/fs-ler-intervalo.js";
import { fsGrepTool } from "./filesystem/fs-grep.js";

/**
 * Ordem importa: aparece exatamente assim em `tools/list`.
 * Mantemos primeiro o grupo semântico (mais usado por agentes), depois
 * o grupo filesystem (mais "infra").
 */
export const MCP_TOOLS: ToolDescriptor[] = [
  buscarLegislacaoTool,
  consultarArtigoTool,
  listarArtigosPorTemaTool,
  compararRedacoesTool,
  fsListarNormasTool,
  fsListarEstruturaTool,
  fsLerDispositivoTool,
  fsLerIntervaloTool,
  fsGrepTool,
];

const BY_NAME: Map<string, ToolDescriptor> = new Map(
  MCP_TOOLS.map((t) => [t.name, t] as const),
);

/**
 * Lookup tipado de uma tool pelo nome.
 *
 * Devolve `undefined` quando o nome não existe — o handler MCP traduz para
 * erro JSON-RPC `-32601`.
 */
export function findTool(name: string): ToolDescriptor | undefined {
  return BY_NAME.get(name);
}

export type { ToolDescriptor } from "./types.js";
export { ToolValidationError } from "./types.js";
