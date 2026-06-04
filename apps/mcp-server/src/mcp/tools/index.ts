/**
 * Boot agregador de todas as tools MCP.
 *
 * Importar este módulo garante que TODOS os subgrupos sejam registrados:
 *   - Skills (4 tools)              — Track E, via boot do skills/index.js
 *   - Leis semânticas (4 tools)     — Track D, via array MCP_TOOLS
 *   - Leis filesystem (5 tools)     — Track D, via array MCP_TOOLS
 *   - Fiscal (2 tools)              — engine de cálculo + regra de mérito
 *   - Vantajosidade (3 tools)       — preços públicos + docs + pesquisa web
 *   - Catálogo (2 tools)            — CATMAT/CATSER semântico + grep
 *   - Jurisprudência (3 tools)      — acórdãos do TCU: semântica + lexical + listagem
 *
 * Total: 23 tools expostas em `tools/list` (19 Track D + 4 skills Track E).
 *
 * Convenção de adição de tool nova:
 *   1. Criar `src/mcp/tools/<grupo>/<slug>.ts`.
 *   2. Se for "lei", incluir em `MCP_TOOLS` abaixo.
 *      Se for "skill", `skills/index.js` cuida do registro via registry.
 *   3. Atualizar `MCP_TOOL_NAMES` em `packages/schemas/src/mcp-tools.ts` (leis).
 */

// Boot do registry de skills (Track E)
import "./skills/index.js";

import type { ToolDescriptor } from "./types.js";

// Leis semânticas (Track D)
import { buscarLegislacaoTool } from "./semantic/buscar-legislacao.js";
import { consultarArtigoTool } from "./semantic/consultar-artigo.js";
import { listarArtigosPorTemaTool } from "./semantic/listar-artigos-por-tema.js";
import { compararRedacoesTool } from "./semantic/comparar-redacoes.js";

// Leis filesystem (Track D)
import { fsListarNormasTool } from "./filesystem/fs-listar-normas.js";
import { fsListarEstruturaTool } from "./filesystem/fs-listar-estrutura.js";
import { fsLerDispositivoTool } from "./filesystem/fs-ler-dispositivo.js";
import { fsLerIntervaloTool } from "./filesystem/fs-ler-intervalo.js";
import { fsGrepTool } from "./filesystem/fs-grep.js";

// Fiscal — engine determinística pós-Reforma Tributária
import {
  calcularReequilibrioTool,
  classificarMeritoTool,
} from "./fiscal/index.js";

// Vantajosidade — preços públicos (Compras.gov) + pesquisa web (Tavily)
import { consultarPrecosPraticadosTool } from "./precos/consultar-precos-praticados.js";
import { buscarDocumentosSuporteTool } from "./precos/buscar-documentos-suporte.js";
import { pesquisarWebTool } from "./web/pesquisar-web.js";

// Catálogo CATMAT/CATSER — resolução de descrição -> código
import { buscarCatalogoSemanticoTool } from "./catalogo/buscar-catalogo-semantico.js";
import { grepCatalogoTool } from "./catalogo/grep-catalogo.js";

// Jurisprudência do TCU — busca semântica (Vectorize) + lexical (FTS5) + listagem
import { buscarAcordaosTcuTool } from "./semantic/buscar-acordaos-tcu.js";
import { buscarAcordaosLexicalTool } from "./semantic/buscar-acordaos-lexical.js";
import { listarAcordaosTool } from "./semantic/listar-acordaos.js";

/**
 * Array das 19 tools de leis/fiscais/catálogo/jurisprudência na ordem canônica.
 * As 4 tools de skills NÃO aparecem aqui — são registradas via `registry.ts`
 * pelo boot do `./skills/index.js`.
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
  calcularReequilibrioTool,
  classificarMeritoTool,
  consultarPrecosPraticadosTool,
  pesquisarWebTool,
  buscarCatalogoSemanticoTool,
  grepCatalogoTool,
  buscarDocumentosSuporteTool,
  buscarAcordaosTcuTool,
  buscarAcordaosLexicalTool,
  listarAcordaosTool,
];

const BY_NAME: Map<string, ToolDescriptor> = new Map(
  MCP_TOOLS.map((t) => [t.name, t] as const),
);

/**
 * Lookup tipado de uma tool de LEI pelo nome.
 *
 * Para tools de SKILLS, use `findTool()` do registry (`./registry.js`).
 * O handler MCP em `server.ts` consulta ambos.
 */
export function findTool(name: string): ToolDescriptor | undefined {
  return BY_NAME.get(name);
}

export type { ToolDescriptor } from "./types.js";
export { ToolValidationError } from "./types.js";

// Re-exports do registry de skills (acesso unificado)
export {
  listToolDescriptors,
  invokeTool,
  findTool as findSkillTool,
  ToolInputError,
  ToolExecutionError,
} from "./registry.js";
