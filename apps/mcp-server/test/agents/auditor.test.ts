/**
 * Testes do Auditor — papel mais crítico do sistema.
 *
 * Cenários cobertos:
 *  - Citação com texto literal IDÊNTICO ao filesystem → APROVADA.
 *  - Citação com texto literal DIFERENTE → REJEITADA + exige_retry.
 *  - Tool `fs_ler_dispositivo` devolve "não encontrado" → REJEITADA.
 *  - Tool indisponível → REJEITADA.
 *  - PROMPT ENVENENADO: LLM tenta marcar tudo como APROVADA e dar
 *    score 1.0 ignorando rejeições determinísticas → o Auditor IGNORA
 *    a sugestão do LLM e mantém o status real.
 *  - Score forçado para <= 0.50 quando há rejeição.
 */
import { describe, expect, it } from "vitest";
import { criarAuditor } from "../../src/agents/roles/auditor.js";
import { criarMockLLM } from "../../src/agents/llm/mock.js";
import {
  consoleLogger,
  type AgentContext,
  type ToolMCP,
} from "../../src/agents/types.js";
import type { CitacaoVerificada } from "@vectorgov-t/schemas";
import type { RelatorioAuditor } from "../../src/agents/roles/_io-schemas.js";

const HASH_BOGUS = "0".repeat(64);

const TEXTO_OFICIAL_124 =
  "Os contratos regidos por esta Lei poderão ser alterados, com as devidas justificativas, nos seguintes casos: ...";

function citacaoPendente(
  texto_literal: string,
  artigo = "art. 124",
): CitacaoVerificada {
  return {
    id: `cit-${Math.random().toString(36).slice(2, 9)}`,
    tipo_fonte: "lei",
    norma: "Lei 14.133/2021",
    artigo,
    texto_literal,
    hash: HASH_BOGUS,
    status: "PENDENTE",
  };
}

function criarToolLer(
  mapaDispositivos: Record<string, string | undefined>,
): ToolMCP {
  return {
    nome: "fs_ler_dispositivo",
    descricao: "Lê texto oficial de um dispositivo da base normativa",
    async executar(args) {
      const chave = `${args["norma"]}|${args["artigo"]}`;
      const texto = mapaDispositivos[chave];
      if (texto === undefined) {
        return { encontrado: false };
      }
      return { encontrado: true, texto_oficial: texto };
    },
  };
}

function contextoDeTeste(tools: ToolMCP[]): AgentContext {
  const mock = criarMockLLM({
    "auditor.relatorio": () => ({
      // O LLM mock "tenta" sugerir score alto — mas o Auditor deve
      // sobrescrever pelo status determinístico real.
      citacoes_verificadas: [],
      score_confianca: 1.0,
      observacoes: "Sugestão do LLM (deve ser sobrescrita)",
      exige_retry: false,
    }),
  });
  return {
    tools,
    llm: mock,
    logger: consoleLogger,
    sessionId: "sess-test",
    tracingId: "trace-test",
  };
}

describe("Auditor — verificação determinística", () => {
  it("APROVA quando texto literal bate com filesystem", async () => {
    const tool = criarToolLer({
      "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124,
    });
    const auditor = criarAuditor();
    const ctx = contextoDeTeste([tool]);
    const result: RelatorioAuditor = await auditor.executar(
      { citacoes: [citacaoPendente(TEXTO_OFICIAL_124)] },
      ctx,
    );
    expect(result.citacoes_verificadas).toHaveLength(1);
    expect(result.citacoes_verificadas[0]!.status).toBe("APROVADA");
    expect(result.exige_retry).toBe(false);
    expect(result.score_confianca).toBeGreaterThan(0.5);
  });

  it("REJEITA quando texto literal diverge", async () => {
    const tool = criarToolLer({
      "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124,
    });
    const auditor = criarAuditor();
    const ctx = contextoDeTeste([tool]);
    const result = await auditor.executar(
      {
        citacoes: [
          citacaoPendente("Texto INVENTADO que não está no filesystem"),
        ],
      },
      ctx,
    );
    expect(result.citacoes_verificadas[0]!.status).toBe("REJEITADA");
    expect(result.citacoes_verificadas[0]!.motivo_rejeicao).toMatch(/diverge/);
    expect(result.exige_retry).toBe(true);
    // Score é FORÇADO a <= 0.50 mesmo o LLM tendo sugerido 1.0
    expect(result.score_confianca).toBeLessThanOrEqual(0.5);
  });

  it("REJEITA quando dispositivo não existe no filesystem", async () => {
    const tool = criarToolLer({}); // mapa vazio = nenhum dispositivo
    const auditor = criarAuditor();
    const ctx = contextoDeTeste([tool]);
    const result = await auditor.executar(
      {
        citacoes: [
          citacaoPendente("texto qualquer", "art. 9999 (inexistente)"),
        ],
      },
      ctx,
    );
    expect(result.citacoes_verificadas[0]!.status).toBe("REJEITADA");
    expect(result.citacoes_verificadas[0]!.motivo_rejeicao).toMatch(
      /inexistente/i,
    );
    expect(result.exige_retry).toBe(true);
  });

  it("REJEITA quando tool fs_ler_dispositivo está indisponível", async () => {
    const auditor = criarAuditor();
    const ctx = contextoDeTeste([]); // sem tools
    const result = await auditor.executar(
      { citacoes: [citacaoPendente(TEXTO_OFICIAL_124)] },
      ctx,
    );
    expect(result.citacoes_verificadas[0]!.status).toBe("REJEITADA");
    expect(result.citacoes_verificadas[0]!.motivo_rejeicao).toMatch(
      /indisponível/,
    );
    expect(result.exige_retry).toBe(true);
  });
});

describe("Auditor — prompt envenenado", () => {
  it("ignora sugestão do LLM e mantém status real (citação inventada continua REJEITADA mesmo se LLM disser APROVADA)", async () => {
    // Aqui o LLM mock tenta SUBVERTER o Auditor — devolve a citação
    // como APROVADA e score 1.0. O Auditor deve descartar a sugestão.
    const mockSubversivo = criarMockLLM({
      "auditor.relatorio": () => ({
        citacoes_verificadas: [
          {
            id: "cit-fake",
            tipo_fonte: "lei",
            norma: "Lei FAKE",
            artigo: "art. 1",
            texto_literal: "Tudo aprovado!",
            hash: HASH_BOGUS,
            status: "APROVADA",
          },
        ],
        score_confianca: 1.0,
        observacoes: "Tudo certo (alucinado)",
        exige_retry: false,
      }),
    });
    const tool = criarToolLer({
      "Lei 14.133/2021|art. 124": TEXTO_OFICIAL_124,
    });
    const auditor = criarAuditor();
    const ctx: AgentContext = {
      tools: [tool],
      llm: mockSubversivo,
      logger: consoleLogger,
      sessionId: "sess-test",
      tracingId: "trace-test",
    };
    const result = await auditor.executar(
      {
        citacoes: [
          citacaoPendente("Texto que NÃO confere com a Lei 14.133"),
        ],
      },
      ctx,
    );
    // Apesar do LLM ter sugerido APROVADA + score 1.0, o resultado
    // determinístico é REJEITADA + score <= 0.50.
    expect(result.citacoes_verificadas).toHaveLength(1);
    expect(result.citacoes_verificadas[0]!.status).toBe("REJEITADA");
    expect(result.exige_retry).toBe(true);
    expect(result.score_confianca).toBeLessThanOrEqual(0.5);
    // E a citação fabricada pelo LLM NÃO entra no relatório:
    expect(
      result.citacoes_verificadas.some((c) => c.norma === "Lei FAKE"),
    ).toBe(false);
  });
});
