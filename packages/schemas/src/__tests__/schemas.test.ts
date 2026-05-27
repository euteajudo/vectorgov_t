/**
 * Testes unitários dos schemas Zod centrais.
 *
 * Foco principal nos `.refine` (validações cruzadas), que são o ponto
 * mais frágil — Zod testa tipos básicos sozinho, mas as regras de
 * domínio precisam de cobertura explícita.
 */
import { describe, expect, it } from "vitest";
import {
  PeticaoSchema,
  AnaliseReequilibrioSchema,
  ParecerSchema,
  CitacaoVerificadaSchema,
  CalculoTributarioSchema,
} from "../index.js";

/**
 * Helper — UUID v4 válido para testes (variantes diferentes).
 */
const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "550e8400-e29b-41d4-a716-446655440001";
const UUID_C = "550e8400-e29b-41d4-a716-446655440002";
const HASH64 = "a".repeat(64);

describe("CitacaoVerificadaSchema", () => {
  const base = {
    id: "cit-1",
    tipo_fonte: "lei" as const,
    norma: "Lei nº 14.133/2021",
    artigo: "art. 124, § 1º, II",
    texto_literal: "Os contratos regidos por esta Lei poderão ser alterados...",
    hash: HASH64,
  };

  it("aceita citação APROVADA sem motivo_rejeicao", () => {
    expect(() =>
      CitacaoVerificadaSchema.parse({ ...base, status: "APROVADA" }),
    ).not.toThrow();
  });

  it("rejeita citação APROVADA com motivo_rejeicao", () => {
    expect(() =>
      CitacaoVerificadaSchema.parse({
        ...base,
        status: "APROVADA",
        motivo_rejeicao: "ops",
      }),
    ).toThrow(/motivo_rejeicao/);
  });

  it("aceita citação REJEITADA com motivo_rejeicao", () => {
    expect(() =>
      CitacaoVerificadaSchema.parse({
        ...base,
        status: "REJEITADA",
        motivo_rejeicao: "Dispositivo inexistente",
      }),
    ).not.toThrow();
  });

  it("rejeita citação REJEITADA sem motivo_rejeicao", () => {
    expect(() =>
      CitacaoVerificadaSchema.parse({ ...base, status: "REJEITADA" }),
    ).toThrow(/motivo_rejeicao/);
  });

  it("rejeita hash que não seja SHA-256 hex de 64 chars", () => {
    expect(() =>
      CitacaoVerificadaSchema.parse({
        ...base,
        status: "APROVADA",
        hash: "abc123",
      }),
    ).toThrow(/SHA-256/);
  });
});

describe("CalculoTributarioSchema", () => {
  const baseSucesso = {
    id: "calc-1",
    tipo: "reequilibrio_economico" as const,
    descricao: "Cálculo de variação INCC",
    inputs: { valor_base: 1234.56, indice: 1.0875 },
    memoria: [
      {
        descricao: "Valor base × índice",
        valor: 1342.57,
        unidade: "BRL",
        formula: "valor_base * indice",
      },
    ],
    valor_final: 1342.57,
    unidade_final: "BRL",
    sucesso: true,
    placeholder: true,
  };

  it("aceita cálculo bem-sucedido completo", () => {
    expect(() => CalculoTributarioSchema.parse(baseSucesso)).not.toThrow();
  });

  it("rejeita cálculo com sucesso=true e valor_final null", () => {
    expect(() =>
      CalculoTributarioSchema.parse({ ...baseSucesso, valor_final: null }),
    ).toThrow(/valor_final/);
  });

  it("rejeita cálculo com sucesso=true e memória vazia", () => {
    expect(() =>
      CalculoTributarioSchema.parse({ ...baseSucesso, memoria: [] }),
    ).toThrow(/memória/);
  });

  it("aceita cálculo com falha + mensagem de erro", () => {
    expect(() =>
      CalculoTributarioSchema.parse({
        ...baseSucesso,
        sucesso: false,
        valor_final: null,
        memoria: [],
        erro: "Índice não encontrado",
      }),
    ).not.toThrow();
  });

  it("rejeita cálculo com sucesso=false sem mensagem de erro", () => {
    expect(() =>
      CalculoTributarioSchema.parse({
        ...baseSucesso,
        sucesso: false,
        valor_final: null,
      }),
    ).toThrow(/erro/);
  });
});

describe("PeticaoSchema", () => {
  const peticaoValida = {
    requerente: "Dr. João Silva (OAB/SP 123.456)",
    contratante: {
      razao_social: "Prefeitura de Exemplo",
      cnpj: "12.345.678/0001-90",
      ente_federativo: "municipio" as const,
    },
    contratado: {
      razao_social: "Construtora ABC Ltda",
      cnpj: "98.765.432/0001-12",
      ente_federativo: "privada" as const,
    },
    contrato: {
      numero: "001/2024",
      modalidade: "pregao_eletronico" as const,
      data_assinatura: "2024-03-15",
      data_inicio_vigencia: "2024-04-01",
      valor_centavos: 5_000_000_00,
      objeto: "Construção de escola municipal",
    },
    fato_alegado:
      "A elevação dos preços do aço carbono entre março/2024 e janeiro/2025 ultrapassou 35%, configurando álea econômica extraordinária prevista no art. 124 da Lei 14.133/2021. Documentos anexos comprovam variação acumulada do INCC e cotações de fornecedores.",
    base_legal_invocada: ["Art. 124 da Lei 14.133/2021", "Súmula 222 TCU"],
  };

  it("aceita petição completa válida", () => {
    expect(() => PeticaoSchema.parse(peticaoValida)).not.toThrow();
  });

  it("rejeita contratante e contratado idênticos", () => {
    expect(() =>
      PeticaoSchema.parse({
        ...peticaoValida,
        contratado: { ...peticaoValida.contratante },
      }),
    ).toThrow(/mesma pessoa jurídica/);
  });

  it("rejeita data_inicio_vigencia anterior à data_assinatura", () => {
    expect(() =>
      PeticaoSchema.parse({
        ...peticaoValida,
        contrato: {
          ...peticaoValida.contrato,
          data_inicio_vigencia: "2024-03-01",
        },
      }),
    ).toThrow(/data_inicio_vigencia/);
  });

  it("rejeita fato_alegado com menos de 50 caracteres", () => {
    expect(() =>
      PeticaoSchema.parse({ ...peticaoValida, fato_alegado: "muito curto" }),
    ).toThrow(/fato_alegado/);
  });

  it("rejeita valor_centavos não-inteiro", () => {
    expect(() =>
      PeticaoSchema.parse({
        ...peticaoValida,
        contrato: { ...peticaoValida.contrato, valor_centavos: 100.5 },
      }),
    ).toThrow();
  });
});

describe("AnaliseReequilibrioSchema", () => {
  const fundamentacaoOk = "x".repeat(250);
  const baseAnalise = {
    id: UUID_A,
    peticao_id: UUID_B,
    veredito: "procedente" as const,
    fundamentacao: fundamentacaoOk,
    citacoes: [
      {
        id: "cit-1",
        tipo_fonte: "lei" as const,
        norma: "Lei nº 14.133/2021",
        artigo: "art. 124",
        texto_literal: "Os contratos regidos por esta Lei poderão ser alterados...",
        hash: HASH64,
        status: "APROVADA" as const,
      },
    ],
    calculos: [
      {
        id: "calc-1",
        tipo: "reequilibrio_economico" as const,
        descricao: "Cálculo INCC",
        inputs: { v: 100 },
        memoria: [{ descricao: "passo", valor: 110, unidade: "BRL" }],
        valor_final: 110,
        unidade_final: "BRL",
        sucesso: true,
        placeholder: true,
      },
    ],
    score_confianca: 0.92,
    pontos_a_complementar: [],
    gerado_em: "2026-05-26T10:00:00.000Z",
    modelo_auditor: "gemini-3-pro",
  };

  it("aceita análise procedente completa", () => {
    expect(() => AnaliseReequilibrioSchema.parse(baseAnalise)).not.toThrow();
  });

  it("rejeita análise procedente sem cálculo bem-sucedido", () => {
    expect(() =>
      AnaliseReequilibrioSchema.parse({ ...baseAnalise, calculos: [] }),
    ).toThrow(/cálculo bem-sucedido/);
  });

  it("rejeita score>0.50 quando há citação REJEITADA", () => {
    expect(() =>
      AnaliseReequilibrioSchema.parse({
        ...baseAnalise,
        score_confianca: 0.9,
        citacoes: [
          {
            id: "cit-bad",
            tipo_fonte: "lei" as const,
            norma: "Lei fictícia",
            artigo: "art. 999",
            texto_literal: "Texto inventado",
            hash: HASH64,
            status: "REJEITADA" as const,
            motivo_rejeicao: "Norma inexistente",
          },
        ],
      }),
    ).toThrow(/REJEITADA/);
  });

  it("exige ponto bloqueante para veredito inconclusiva", () => {
    expect(() =>
      AnaliseReequilibrioSchema.parse({
        ...baseAnalise,
        veredito: "inconclusiva",
        calculos: [],
        pontos_a_complementar: [],
      }),
    ).toThrow(/bloqueante/);
  });

  it("rejeita fundamentação muito curta", () => {
    expect(() =>
      AnaliseReequilibrioSchema.parse({
        ...baseAnalise,
        fundamentacao: "curto",
      }),
    ).toThrow(/fundamentação/);
  });
});

describe("ParecerSchema", () => {
  const conteudoOk = "y".repeat(60);
  const baseParecer = {
    id: UUID_A,
    analise_id: UUID_B,
    cabecalho: {
      numero: "PAR-2026-001",
      parecerista: "Agente IA Auditor + Redator",
      orgao: "Procuradoria Geral do Município",
      assunto: "Reequilíbrio Contrato 001/2024",
      data: "2026-05-26",
    },
    secoes: [
      { numero: "I" as const, titulo: "Relatório", conteudo: conteudoOk },
      { numero: "II" as const, titulo: "Fundamentação", conteudo: conteudoOk },
      { numero: "III" as const, titulo: "Conclusão", conteudo: conteudoOk },
      { numero: "IV" as const, titulo: "Cálculos", conteudo: conteudoOk },
      { numero: "V" as const, titulo: "Recomendações", conteudo: conteudoOk },
    ],
    conclusao_objetiva:
      "Pelo deferimento parcial do pleito, no valor de R$ 12.450,00.",
    citacoes: [],
    calculos: [],
    gerado_em: "2026-05-26T11:00:00.000Z",
  };

  it("aceita parecer formal com 5 seções na ordem certa", () => {
    expect(() => ParecerSchema.parse(baseParecer)).not.toThrow();
  });

  it("rejeita seções fora da ordem I-V", () => {
    const sec = [...baseParecer.secoes];
    [sec[0], sec[1]] = [sec[1]!, sec[0]!];
    expect(() =>
      ParecerSchema.parse({ ...baseParecer, secoes: sec }),
    ).toThrow(/ordem/);
  });

  it("rejeita citação REJEITADA dentro do parecer", () => {
    expect(() =>
      ParecerSchema.parse({
        ...baseParecer,
        citacoes: [
          {
            id: "cit-r",
            tipo_fonte: "lei" as const,
            norma: "Lei X",
            artigo: "art. 1",
            texto_literal: "...",
            hash: HASH64,
            status: "REJEITADA" as const,
            motivo_rejeicao: "ops",
          },
        ],
      }),
    ).toThrow(/REJEITADA/);
  });

  it("rejeita parecer com menos de 5 seções", () => {
    expect(() =>
      ParecerSchema.parse({
        ...baseParecer,
        secoes: baseParecer.secoes.slice(0, 4),
      }),
    ).toThrow();
  });

  it("usa analise_id corretamente como UUID", () => {
    expect(() =>
      ParecerSchema.parse({ ...baseParecer, analise_id: UUID_C }),
    ).not.toThrow();
  });
});
