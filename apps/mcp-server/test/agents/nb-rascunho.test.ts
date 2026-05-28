import { describe, expect, it } from "vitest";
import { NotebookAgent } from "../../src/agents/notebook-agent.js";
import { createInMemoryState } from "./_in-memory-state.js";
import { createTestEnv } from "../_fakes.js";
import type { PeticaoRascunho } from "@vectorgov-t/schemas";

describe("NotebookAgent — rascunho round-trip", () => {
  it("salva e lê o rascunho de petição", async () => {
    const state = Object.assign(createInMemoryState(), {
      id: { name: "nb-test", toString: () => "nb-test" },
    });
    const nb = new NotebookAgent(state as never, createTestEnv());
    const rascunho = {
      requerente: "Construtora Beta",
      contratante_razao_social: "Prefeitura X",
      contratante_cnpj: null,
      contratante_ente_federativo: "municipio",
      contratado_razao_social: "Construtora Beta",
      contratado_cnpj: "12345678000190",
      contrato_numero: "010/2024",
      contrato_modalidade: "concorrencia",
      contrato_objeto: "obra",
      contrato_valor_centavos: 120000000,
      contrato_data_assinatura: null,
      contrato_data_inicio_vigencia: null,
      resumo_pedido: "Pedido de reequilíbrio por reforma tributária.",
      base_legal_invocada: [],
      campos_incertos: ["contrato_data_assinatura"],
    } as PeticaoRascunho;
    await nb.salvarRascunho(rascunho);
    const lido = await nb.lerRascunho();
    expect(lido?.contrato_valor_centavos).toBe(120000000);
    expect(lido?.contrato_numero).toBe("010/2024");
  });
});
