/**
 * Apuração automática de vantajosidade (preço de referência) durante a análise.
 *
 * Opção A do funil: ao analisar o reequilíbrio, o backend resolve
 * catálogo → preço público → documentos de suporte a partir do OBJETO do
 * contrato e anexa o `PrecoReferencia` à análise — sem o usuário pedir.
 *
 * É **best-effort**: qualquer falha (sem código aderente, sem amostras, erro de
 * API) retorna null e a análise segue normalmente. Vantajosidade é insumo
 * complementar ao cálculo tributário, não pré-requisito.
 *
 * Usa as tools já bindadas (catálogo/preço/docs) via a interface mínima
 * `ToolLike`, exatamente como o Pesquisador invoca tools no PEVS.
 */
import type {
  Peticao,
  PrecoReferencia,
  ItemCatalogo,
  DocumentoSuporte,
} from "@vectorgov-t/schemas";

/** Superfície mínima de uma tool do PEVS (ver agents/types.ts ToolMCP). */
interface ToolLike {
  nome: string;
  executar(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Resolve o objeto do contrato em preço de referência (mediana de preços
 * públicos aderentes + documentos de suporte). Retorna null em qualquer
 * insucesso. `hojeYmd` é a data de referência (fim da janela de preços).
 */
export async function apurarVantajosidade(
  peticao: Peticao,
  tools: ToolLike[],
  hojeYmd: string,
): Promise<PrecoReferencia | null> {
  try {
    const toolCat = tools.find((t) => t.nome === "buscar_catalogo_semantico");
    const toolPreco = tools.find((t) => t.nome === "consultar_precos_praticados");
    if (!toolCat || !toolPreco) return null;

    const objeto = peticao.contrato.objeto?.trim() ?? "";
    if (objeto.length < 3) return null;

    // 1) Resolve o objeto no código de catálogo (top-1).
    const cat = (await toolCat.executar({ descricao: objeto, top_k: 1 })) as {
      itens?: ItemCatalogo[];
    };
    const top = cat.itens?.[0];
    // Preço só suporta material (CATMAT) no MVP — serviço (CATSER) fica null.
    if (!top || top.tipo !== "material") return null;

    // 2) Preço de referência (janela: assinatura do contrato → hoje).
    const dataInicio = peticao.contrato.data_assinatura;
    const preco = (await toolPreco.executar({
      codigo_item: top.codigo,
      descricao_objeto: objeto,
      tipo: "material",
      data_inicio: dataInicio,
      data_fim: hojeYmd,
    })) as PrecoReferencia;
    if (!preco || preco.estatisticas?.mediana_centavos == null) return null;

    // 3) Documentos de suporte (best-effort) por órgão, se houver CNPJ.
    const cnpj = (peticao.contratante.cnpj ?? "").replace(/\D/g, "");
    const toolDocs = tools.find((t) => t.nome === "buscar_documentos_suporte");
    if (toolDocs && cnpj.length === 14) {
      try {
        const docs = (await toolDocs.executar({
          data_inicio: dataInicio,
          data_fim: hojeYmd,
          cnpj_orgao: cnpj,
          max: 5,
        })) as { documentos?: DocumentoSuporte[] };
        if (docs.documentos?.length) preco.documentos_suporte = docs.documentos;
      } catch {
        /* docs são complementares — falha não invalida o preço */
      }
    }

    return preco;
  } catch {
    return null;
  }
}
