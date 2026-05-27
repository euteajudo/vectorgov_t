/**
 * Boot do grupo de tools de Skills.
 *
 * Importar este módulo é suficiente para registrar as 4 tools no registry
 * compartilhado (`../registry.ts`). Mantemos as importações com side-effect
 * (não usamos os exports diretamente) — o registry funciona como singleton
 * do isolate.
 */

import "./skill-listar.js";
import "./skill-carregar.js";
import "./skill-identificar-relevantes.js";
import "./skill-publicar.js";

// Reexporta o registry para o handler MCP montado em `mcp/server.ts`.
export {
  listToolDescriptors,
  invokeTool,
  findTool,
  ToolInputError,
  ToolExecutionError,
} from "../registry.js";
