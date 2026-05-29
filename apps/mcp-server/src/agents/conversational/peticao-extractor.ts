/**
 * Extrator de Petição a partir do texto de um documento (PDF do notebook).
 *
 * O LLM lê o documento + o pedido do usuário e devolve um RASCUNHO de
 * petição (campos opcionais). É a ponte que substitui o formulário manual:
 * em vez de digitar 12 campos, o usuário sobe o pedido de reequilíbrio e
 * o LLM extrai o que dá. O que não achar com confiança vai em
 * `campos_incertos` para o usuário confirmar — NUNCA inventa valores.
 */
import {
  PeticaoRascunhoSchema,
  type PeticaoRascunho,
} from "@vectorgov-t/schemas";
import type { LLMClient, ModeloLLM } from "../llm/index.js";

const SYSTEM = `Você é um EXTRATOR de dados de petições de reequilíbrio econômico-financeiro.
Recebe o texto de um documento (pedido de uma empresa a um órgão público) e
deve extrair os campos estruturados da petição.

Regras DURAS:
1. Extraia SOMENTE o que está no documento. Se não encontrar um campo com
   confiança, deixe-o null e liste o nome do campo em campos_incertos.
2. NUNCA invente valores — especialmente contrato_valor_centavos. Se o valor
   não estiver claro no texto, deixe null e marque em campos_incertos.
3. Valores monetários SEMPRE em centavos (R$ 1.234,56 → 123456).
4. Datas no formato YYYY-MM-DD.
5. resumo_pedido: escreva uma síntese fiel (3-6 frases) do que a empresa
   pede e por quê (fato superveniente alegado). Será a base da análise.
6. contratante = órgão público; contratado = empresa requerente.
7. valor_pretendido_centavos: o VALOR que a empresa PEDE de recomposição/
   reequilíbrio (NÃO confundir com o valor total do contrato). Em centavos.
   Se a petição NÃO quantifica o pedido, deixe null e inclua
   "valor_pretendido_centavos" em campos_incertos — NUNCA invente um valor.`;

/**
 * Extrai um rascunho de petição do texto do documento.
 *
 * @param textoDocumento texto completo do PDF (de lerDocumentoInteiro)
 * @param pedidoUsuario  mensagem em linguagem natural do usuário (contexto)
 */
export async function extrairPeticaoDeTexto(
  textoDocumento: string,
  pedidoUsuario: string,
  llm: LLMClient,
  modelo: ModeloLLM = "gemini-3.5-flash",
): Promise<PeticaoRascunho> {
  const result = await llm.generateObject({
    modelo,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `PEDIDO DO USUÁRIO:\n${pedidoUsuario || "(analisar o documento)"}\n\nDOCUMENTO:\n${textoDocumento}\n\nExtraia o rascunho da petição.`,
      },
    ],
    schema: PeticaoRascunhoSchema,
    tag: "notebook.extrair_peticao",
    temperatura: 0.0,
  });
  return result.object;
}
