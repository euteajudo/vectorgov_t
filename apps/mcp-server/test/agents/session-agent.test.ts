/**
 * Testes do SessionAgent (DurableObject persistente).
 *
 * Usamos um shim SQL em memória (`_in-memory-state.ts`) para evitar
 * dependência do runtime do Workers. Cobre:
 *
 *  - `analisarPeticao` persiste petição + análise e idempotência via
 *    INSERT OR REPLACE.
 *  - `gerarParecer` falha se a análise não existir; sucesso quando existe.
 *  - `listarHistorico` retorna ordenado por criado_em DESC e marca
 *    corretamente `tem_parecer`.
 *  - `carregarAnalise` / `carregarParecer` round-trip.
 *  - Conversas: registrar + listar (ordem cronológica).
 *  - Validação Zod ocorre na borda (entrada inválida arremessa).
 */
import { describe, expect, it } from "vitest";
import { SessionAgent } from "../../src/agents/session-agent.js";
import { createInMemoryState } from "./_in-memory-state.js";
import {
  PeticaoSchema,
  AnaliseReequilibrioSchema,
  ParecerSchema,
  type Peticao,
  type AnaliseReequilibrio,
  type Parecer,
} from "@vectorgov-t/schemas";
import { createTestEnv } from "../_fakes.js";

const UUID_PET = "550e8400-e29b-41d4-a716-446655440100";
const UUID_ANA = "550e8400-e29b-41d4-a716-446655440101";
const UUID_PAR = "550e8400-e29b-41d4-a716-446655440102";
const HASH64 = "b".repeat(64);

function novaPeticao(): Peticao {
  return PeticaoSchema.parse({
    id: UUID_PET,
    requerente: "Dr. Joaquim",
    contratante: {
      razao_social: "Prefeitura X",
      cnpj: "11.111.111/0001-11",
      ente_federativo: "municipio",
    },
    contratado: {
      razao_social: "Empresa Y",
      cnpj: "22.222.222/0001-22",
      ente_federativo: "privada",
    },
    contrato: {
      numero: "010/2024",
      modalidade: "concorrencia",
      data_assinatura: "2024-01-10",
      data_inicio_vigencia: "2024-02-01",
      valor_centavos: 100_000_00,
      objeto: "Obra de manutenção viária",
    },
    fato_alegado:
      "Aumento extraordinário de preços de asfalto em mais de 40% entre dezembro/2024 e março/2025, comprovado por notas fiscais anexas.",
    base_legal_invocada: ["Art. 124 da Lei 14.133/2021"],
  });
}

function novaAnalise(): AnaliseReequilibrio {
  return AnaliseReequilibrioSchema.parse({
    id: UUID_ANA,
    peticao_id: UUID_PET,
    veredito: "procedente",
    fundamentacao: "Fundamentação completa baseada em jurisprudência do TCU e na doutrina majoritária. ".repeat(5),
    citacoes: [
      {
        id: "cit-1",
        tipo_fonte: "lei",
        norma: "Lei 14.133/2021",
        artigo: "art. 124",
        texto_literal: "Os contratos regidos por esta Lei poderão ser alterados...",
        hash: HASH64,
        status: "APROVADA",
      },
    ],
    calculos: [
      {
        id: "calc-1",
        tipo: "reequilibrio_economico",
        descricao: "Variação INCC",
        inputs: { v: 100 },
        memoria: [{ descricao: "passo único", valor: 110, unidade: "BRL" }],
        valor_final: 110,
        unidade_final: "BRL",
        sucesso: true,
        placeholder: true,
      },
    ],
    score_confianca: 0.9,
    pontos_a_complementar: [],
    gerado_em: "2026-05-26T10:00:00.000Z",
    modelo_auditor: "gemini-3-pro",
  });
}

function novoParecer(): Parecer {
  const conteudo = "z".repeat(80);
  return ParecerSchema.parse({
    id: UUID_PAR,
    analise_id: UUID_ANA,
    cabecalho: {
      numero: "PAR-2026-XYZ",
      parecerista: "Agente Auditor + Redator",
      orgao: "PGM Exemplo",
      assunto: "Reequilíbrio Contrato 010/2024",
      data: "2026-05-26",
    },
    secoes: [
      { numero: "I", titulo: "Relatório", conteudo },
      { numero: "II", titulo: "Fundamentação", conteudo },
      { numero: "III", titulo: "Conclusão", conteudo },
      { numero: "IV", titulo: "Cálculos", conteudo },
      { numero: "V", titulo: "Recomendações", conteudo },
    ],
    conclusao_objetiva:
      "Pelo deferimento parcial do pleito de reequilíbrio econômico.",
    citacoes: [],
    calculos: [],
    gerado_em: "2026-05-26T11:00:00.000Z",
  });
}

describe("SessionAgent — analisarPeticao + listarHistorico", () => {
  it("persiste petição+análise e devolve no histórico", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    const hist = await agent.listarHistorico();
    expect(hist).toHaveLength(1);
    expect(hist[0]!.analise_id).toBe(UUID_ANA);
    expect(hist[0]!.peticao_id).toBe(UUID_PET);
    expect(hist[0]!.veredito).toBe("procedente");
    expect(hist[0]!.tem_parecer).toBe(false);
    expect(hist[0]!.parecer_id).toBeNull();
  });

  it("idempotente: chamar duas vezes substitui (INSERT OR REPLACE)", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    const hist = await agent.listarHistorico();
    expect(hist).toHaveLength(1);
  });

  it("rejeita análise com peticao_id divergente do peticao.id", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    const a = novaAnalise();
    a.peticao_id = "550e8400-e29b-41d4-a716-446655440999";
    await expect(agent.analisarPeticao(novaPeticao(), a)).rejects.toThrow(
      /não bate/,
    );
  });
});

describe("SessionAgent — gerarParecer", () => {
  it("aceita parecer cuja análise existe", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    await expect(agent.gerarParecer(novoParecer())).resolves.toBeUndefined();
    const hist = await agent.listarHistorico();
    expect(hist[0]!.tem_parecer).toBe(true);
    expect(hist[0]!.parecer_id).toBe(UUID_PAR);
  });

  it("rejeita parecer cuja análise não existe", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await expect(agent.gerarParecer(novoParecer())).rejects.toThrow(
      /não encontrada/,
    );
  });
});

describe("SessionAgent — round-trip", () => {
  it("carregarAnalise devolve petição+análise íntegras", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    const got = await agent.carregarAnalise(UUID_ANA);
    expect(got).not.toBeNull();
    expect(got!.peticao.id).toBe(UUID_PET);
    expect(got!.analise.veredito).toBe("procedente");
  });

  it("carregarParecer devolve parecer íntegro", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.analisarPeticao(novaPeticao(), novaAnalise());
    await agent.gerarParecer(novoParecer());
    const got = await agent.carregarParecer(UUID_PAR);
    expect(got).not.toBeNull();
    expect(got!.cabecalho.numero).toBe("PAR-2026-XYZ");
  });

  it("carregarAnalise devolve null se id inexistente", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    const got = await agent.carregarAnalise(
      "550e8400-e29b-41d4-a716-446655440aaa",
    );
    expect(got).toBeNull();
  });
});

describe("SessionAgent — conversas", () => {
  it("registra e devolve em ordem cronológica ascendente", async () => {
    const state = createInMemoryState();
    const agent = new SessionAgent(state, createTestEnv());
    await agent.registrarConversa("m1", "user", "olá");
    // Pequeno delay para garantir criado_em diferente:
    await new Promise((r) => setTimeout(r, 5));
    await agent.registrarConversa("m2", "assistant", "oi");
    const lista = await agent.ultimasConversas();
    expect(lista.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
