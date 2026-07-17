/**
 * Defesa em query-time contra vetores órfãos (review do PR #56, P1):
 * a recarga do Vectorize é por upsert e não remove IDs excluídos da fonte —
 * um hit que só a lane semântica trouxe precisa de linha real no D1 para
 * entrar no resultado. De quebra, o item confirmado usa os campos FRESCOS
 * da linha (ativo/pdm/ncm), não a metadata congelada na época do embed.
 */
import { describe, expect, it } from "vitest";
import { buscarCatalogoHibrido } from "../src/lib/catalogo-search.js";
import {
  createFakeAi,
  createFakeD1,
  createFakeVectorize,
  createTestEnv,
} from "./_fakes.js";

const LINHA_VIVA = {
  catalogo_id: "cat-servico-3",
  codigo: 3,
  tipo: "servico",
  descricao: "LIMPEZA PREDIAL",
  grupo: "SERVICOS DE LIMPEZA",
  classe: "LIMPEZA",
  pdm: null,
  ncm: null,
  // No D1 o item foi INATIVADO; a metadata do vetor (velha) ainda diz ativo=1.
  ativo: 0,
};

function envComVetores() {
  return createTestEnv({
    AI: createFakeAi(),
    VECTORIZE_CATMAT: createFakeVectorize({
      matches: [
        {
          id: "cat-servico-3",
          score: 0.9,
          metadata: { codigo: 3, tipo: "servico", descricao: "LIMPEZA PREDIAL", ativo: 1 },
        },
        {
          // Órfão: item excluído da fonte — não existe mais no D1.
          id: "cat-material-999",
          score: 0.8,
          metadata: { codigo: 999, tipo: "material", descricao: "ITEM EXCLUIDO", ativo: 1 },
        },
      ],
    }),
    DB: createFakeD1({
      regras: [
        { match: "catalogo_fts", rows: [] },
        { match: "catalogo_trgm", rows: [] },
        // Confirmação dos hits vector-only: só o cat-servico-3 existe.
        { match: "FROM catalogo_itens WHERE id IN", rows: [LINHA_VIVA] },
      ],
    }),
    // Sem COHERE_API_KEY → modo RRF (o rerank não interfere no teste).
  });
}

describe("buscarCatalogoHibrido — vetores órfãos", () => {
  it("descarta hit vector-only sem linha no D1 e mantém o confirmado", async () => {
    const r = await buscarCatalogoHibrido(envComVetores(), {
      descricao: "limpeza predial",
      top_k: 10,
    });
    const codigos = r.itens.map((i) => i.codigo);
    expect(codigos).toContain(3);
    expect(codigos).not.toContain(999);
  });

  it("item confirmado usa os campos frescos do D1, não a metadata do embed", async () => {
    const r = await buscarCatalogoHibrido(envComVetores(), {
      descricao: "limpeza predial",
      top_k: 10,
    });
    const item = r.itens.find((i) => i.codigo === 3)!;
    // Metadata velha dizia ativo=1; a linha do D1 (fonte de verdade) diz 0.
    expect(item.ativo).toBe(false);
  });
});
