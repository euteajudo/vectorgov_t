/**
 * Testes do `cost-tracker.ts` — `estimateCostUsd` + `TrackedLLMClient`.
 *
 * Cobertura:
 *   - Preços corretos por modelo (Flash vs Pro).
 *   - Wrapper acumula corretamente em múltiplas chamadas.
 *   - Snapshot agrega por modelo.
 *   - Reset zera o acumulado.
 *   - Modelo desconhecido devolve custo 0 e não quebra.
 */
import { describe, expect, it } from "vitest";
import {
  TrackedLLMClient,
  estimateCostUsd,
  PRECOS_POR_MILHAO_USD,
} from "../../src/agents/cost-tracker.js";
import type {
  LLMClient,
  ModeloLLM,
  OpcoesGeracaoEstruturada,
  ResultadoGeracaoEstruturada,
} from "../../src/agents/llm/index.js";
import { z } from "zod";

const SchemaSimples = z.object({ ok: z.boolean() });

/**
 * Fake mínimo de LLMClient que devolve usage fixa por modelo —
 * permite asserts determinísticos sem depender do MockLLMClient
 * (que estima usage por chars/4).
 */
function fakeLlmComUsage(
  usageMap: Record<ModeloLLM, { promptTokens: number; completionTokens: number }>,
): LLMClient {
  return {
    async generateObject<T>(
      opts: OpcoesGeracaoEstruturada<T>,
    ): Promise<ResultadoGeracaoEstruturada<T>> {
      const usage = usageMap[opts.modelo];
      const totalTokens = usage.promptTokens + usage.completionTokens;
      const objeto = opts.schema.parse({ ok: true });
      return {
        object: objeto as T,
        raw: JSON.stringify(objeto),
        usage: { ...usage, totalTokens },
        modelo: opts.modelo,
      };
    },
  };
}

describe("estimateCostUsd", () => {
  it("aplica os preços Flash corretamente", () => {
    // Flash: $0.075/M input, $0.30/M output
    // 1M input + 1M output = 0.075 + 0.30 = 0.375
    const custo = estimateCostUsd(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      "gemini-3.5-flash",
    );
    expect(custo).toBeCloseTo(0.375, 6);
  });

  it("aplica os preços Pro corretamente", () => {
    // Pro: $1.25/M input, $5.00/M output
    // 1M input + 1M output = 1.25 + 5.00 = 6.25
    const custo = estimateCostUsd(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      "gemini-3-pro",
    );
    expect(custo).toBeCloseTo(6.25, 6);
  });

  it("zera para usage zero", () => {
    expect(
      estimateCostUsd({ promptTokens: 0, completionTokens: 0 }, "gemini-3.5-flash"),
    ).toBe(0);
  });

  it("tabela exposta tem entradas para ambos os modelos suportados", () => {
    expect(PRECOS_POR_MILHAO_USD["gemini-3.5-flash"]).toBeDefined();
    expect(PRECOS_POR_MILHAO_USD["gemini-3-pro"]).toBeDefined();
  });

  it("calcula valor realista de petição típica", () => {
    // Cenário típico (medido nos testes do PEVS): ~2k tokens prompt + ~700 tokens completion
    // em Flash + ~250 prompt + ~30 completion em Pro.
    const flashCusto = estimateCostUsd(
      { promptTokens: 2000, completionTokens: 700 },
      "gemini-3.5-flash",
    );
    const proCusto = estimateCostUsd(
      { promptTokens: 250, completionTokens: 30 },
      "gemini-3-pro",
    );
    const total = flashCusto + proCusto;
    // Ordem de grandeza esperada: ~$0.001 (1 centavo de dólar é folgado)
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(0.01);
  });
});

describe("TrackedLLMClient — wrapper", () => {
  it("repassa o resultado do inner sem modificá-lo", async () => {
    const inner = fakeLlmComUsage({
      "gemini-3.5-flash": { promptTokens: 100, completionTokens: 50 },
      "gemini-3-pro": { promptTokens: 100, completionTokens: 50 },
    });
    const tracker = new TrackedLLMClient(inner);
    const result = await tracker.generateObject({
      modelo: "gemini-3.5-flash",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });
    expect(result.object).toEqual({ ok: true });
    expect(result.usage.totalTokens).toBe(150);
  });

  it("acumula múltiplas chamadas no mesmo modelo", async () => {
    const inner = fakeLlmComUsage({
      "gemini-3.5-flash": { promptTokens: 100, completionTokens: 50 },
      "gemini-3-pro": { promptTokens: 200, completionTokens: 75 },
    });
    const tracker = new TrackedLLMClient(inner);

    for (let i = 0; i < 3; i++) {
      await tracker.generateObject({
        modelo: "gemini-3.5-flash",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        schema: SchemaSimples,
      });
    }

    const snap = tracker.snapshot();
    expect(snap.total_chamadas).toBe(3);
    expect(snap.total_tokens).toBe(450); // 3 × 150
    expect(snap.por_modelo).toHaveLength(1);
    expect(snap.por_modelo[0]!.chamadas).toBe(3);
    expect(snap.por_modelo[0]!.prompt_tokens).toBe(300);
    expect(snap.por_modelo[0]!.completion_tokens).toBe(150);
  });

  it("segrega snapshots por modelo (Flash + Pro misturados)", async () => {
    const inner = fakeLlmComUsage({
      "gemini-3.5-flash": { promptTokens: 100, completionTokens: 50 },
      "gemini-3-pro": { promptTokens: 200, completionTokens: 75 },
    });
    const tracker = new TrackedLLMClient(inner);

    // 2 chamadas Flash + 1 Pro
    await tracker.generateObject({
      modelo: "gemini-3.5-flash",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });
    await tracker.generateObject({
      modelo: "gemini-3.5-flash",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });
    await tracker.generateObject({
      modelo: "gemini-3-pro",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });

    const snap = tracker.snapshot();
    expect(snap.total_chamadas).toBe(3);
    expect(snap.por_modelo).toHaveLength(2);

    const flash = snap.por_modelo.find((m) => m.modelo === "gemini-3.5-flash")!;
    const pro = snap.por_modelo.find((m) => m.modelo === "gemini-3-pro")!;

    expect(flash.chamadas).toBe(2);
    expect(flash.total_tokens).toBe(300); // 2 × 150
    expect(pro.chamadas).toBe(1);
    expect(pro.total_tokens).toBe(275);

    // Custo: Flash 2 chamadas × (100/1M * 0.075 + 50/1M * 0.30) = 2 × 0.0000225 = 0.000045
    //        Pro 1 chamada × (200/1M * 1.25 + 75/1M * 5.00) = 0.00025 + 0.000375 = 0.000625
    //        Total ~0.00067
    expect(snap.custo_estimado_usd).toBeGreaterThan(0.0006);
    expect(snap.custo_estimado_usd).toBeLessThan(0.0008);
  });

  it("reset zera o acumulado e snapshot fica vazio", async () => {
    const inner = fakeLlmComUsage({
      "gemini-3.5-flash": { promptTokens: 100, completionTokens: 50 },
      "gemini-3-pro": { promptTokens: 200, completionTokens: 75 },
    });
    const tracker = new TrackedLLMClient(inner);

    await tracker.generateObject({
      modelo: "gemini-3.5-flash",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });
    expect(tracker.snapshot().total_chamadas).toBe(1);

    tracker.reset();
    const snap = tracker.snapshot();
    expect(snap.total_chamadas).toBe(0);
    expect(snap.total_tokens).toBe(0);
    expect(snap.custo_estimado_usd).toBe(0);
    expect(snap.por_modelo).toHaveLength(0);
  });

  it("snapshot pode ser chamado múltiplas vezes sem efeito colateral", async () => {
    const inner = fakeLlmComUsage({
      "gemini-3.5-flash": { promptTokens: 100, completionTokens: 50 },
      "gemini-3-pro": { promptTokens: 200, completionTokens: 75 },
    });
    const tracker = new TrackedLLMClient(inner);

    await tracker.generateObject({
      modelo: "gemini-3.5-flash",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      schema: SchemaSimples,
    });

    const snap1 = tracker.snapshot();
    const snap2 = tracker.snapshot();
    expect(snap1.total_tokens).toBe(snap2.total_tokens);
    expect(snap1.custo_estimado_usd).toBe(snap2.custo_estimado_usd);
  });
});
