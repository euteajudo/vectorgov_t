/**
 * Tool MCP `consultar_precos_praticados` (Track D).
 *
 * Preço de referência de um item por CATMAT a partir dos Preços Praticados
 * públicos (Compras.gov.br). Aplica o portão de aderência (descarta amostras
 * cujo objeto não bate) e a normalização de unidade de fornecimento, devolvendo
 * mediana/percentis auditáveis com proveniência. Insumo de vantajosidade.
 *
 * Determinístico: a busca e a estatística não passam por LLM.
 */
import type { Env } from "../../../env.js";
import {
  ConsultarPrecosInputSchema,
  type AmostraPreco,
  type PrecoReferencia,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";
import { consultarPrecosMaterial } from "../../../lib/compras-gov.js";
import { agregarEstatisticas, avaliarAderencia } from "../../../lib/preco-stats.js";

/** Teto de amostras retornadas (proveniência); a estatística usa todas. */
const MAX_AMOSTRAS_OUT = 50;

async function handler(args: unknown, env: Env): Promise<PrecoReferencia> {
  const parsed = ConsultarPrecosInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "consultar_precos_praticados: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  if (input.tipo === "servico") {
    throw new ToolValidationError(
      "consultar_precos_praticados: tipo 'servico' (CATSER) ainda não habilitado " +
        "neste MVP — use 'material' (CATMAT).",
    );
  }

  const bases = await consultarPrecosMaterial(env, {
    codigo_item: input.codigo_item,
    uf: input.uf,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
  });

  // Portão de aderência: marca cada amostra contra o objeto pesquisado.
  const amostras: AmostraPreco[] = bases.map((b) => ({
    ...b,
    ...avaliarAderencia(input.descricao_objeto, b),
  }));

  const estatisticas = agregarEstatisticas(amostras);

  return {
    codigo_item: input.codigo_item,
    descricao_objeto: input.descricao_objeto,
    tipo: input.tipo,
    fonte: "compras_gov_precos_praticados",
    estatisticas,
    amostras: amostras.slice(0, MAX_AMOSTRAS_OUT),
    documentos_suporte: [],
    consultado_em: new Date().toISOString(),
  };
}

export const consultarPrecosPraticadosTool: ToolDescriptor = {
  name: "consultar_precos_praticados",
  description:
    "Preço de referência (mediana + percentis) de um item por CATMAT a partir " +
    "dos preços praticados públicos (Compras.gov.br), com portão de aderência ao " +
    "objeto e normalização de unidade de fornecimento. Insumo determinístico de vantajosidade.",
  inputSchema: zodToMcpSchema(ConsultarPrecosInputSchema),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
