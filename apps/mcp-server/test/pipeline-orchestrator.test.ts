/**
 * Testes de integração do orquestrador (`src/pipeline/orchestrator.ts`).
 *
 * Cobre o fluxo completo com mocks de:
 *   - Container Python via `vi.spyOn(globalThis, 'fetch')`.
 *   - AI / R2 / D1 / Vectorize via fakes em memória.
 *
 * Cenários:
 *   - Pipeline feliz (1 norma, 3 dispositivos) → fase=done, status 100%.
 *   - Idempotência: segunda chamada não duplica linhas em D1 / chaves R2.
 *   - Container 500 → fase=failed com mensagem.
 *   - Endpoint POST /ingestao/iniciar devolve 202 + id.
 *   - Endpoint GET /ingestao/status/:id devolve o registro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import {
  newIngestaoId,
  runIngestionPipeline,
} from "../src/pipeline/orchestrator.js";
import { readStatus } from "../src/pipeline/status-store.js";
import { createExecutionContext, createPipelineEnv } from "./_fakes.js";
import type { ParseResult } from "@vectorgov-t/schemas";

/**
 * Gera um ParseResult sintético para os testes — 3 dispositivos numa
 * hierarquia comum, hashes hex válidos.
 */
function fakeParseResult(): ParseResult {
  return {
    norma: {
      id: "lc-test-2025",
      tipo: "lei_complementar",
      numero: "999",
      ano: 2025,
      data_publicacao: "2025-01-01",
      ementa: "Lei de teste",
      orgao_emissor: "Teste",
      status: "vigente",
    },
    dispositivos: [
      {
        id: "lc-test-2025-art-001",
        norma_id: "lc-test-2025",
        tipo_dispositivo: "artigo",
        artigo: 1,
        paragrafo: null,
        inciso: null,
        alinea: null,
        hierarquia_path: "Livro I -> Art. 1º",
        texto: "Art. 1º Texto do artigo 1.",
        canonical_start: 0,
        canonical_end: 30,
        page_number: 1,
        citations: [],
      },
      {
        id: "lc-test-2025-art-002",
        norma_id: "lc-test-2025",
        tipo_dispositivo: "artigo",
        artigo: 2,
        paragrafo: null,
        inciso: null,
        alinea: null,
        hierarquia_path: "Livro I -> Art. 2º",
        texto: "Art. 2º Texto do artigo 2.",
        canonical_start: 31,
        canonical_end: 60,
        page_number: 1,
        citations: ["LEI-14133-2021 ART-009"],
      },
      {
        id: "lc-test-2025-art-002-p-1",
        norma_id: "lc-test-2025",
        tipo_dispositivo: "paragrafo",
        artigo: 2,
        paragrafo: "1",
        inciso: null,
        alinea: null,
        hierarquia_path: "Livro I -> Art. 2º § 1º",
        texto: "§ 1º Parágrafo do artigo 2.",
        canonical_start: 61,
        canonical_end: 90,
        page_number: 1,
        citations: [],
      },
    ],
    canonical_text: "Art. 1º Texto do artigo 1.\n\nArt. 2º Texto do artigo 2.",
    canonical_hash:
      "a".repeat(64),
    sumario: { livro_i: ["art-001", "art-002"] },
    total_dispositivos: 3,
    tokens_aproximados: 50,
    pdf_hash: "b".repeat(64),
  };
}

/**
 * Mock global do fetch — devolve `parseResult` ou um erro 500.
 *
 * `vi.spyOn(globalThis, 'fetch')` esbarra na união de sobrecargas que o
 * `@cloudflare/workers-types` adiciona a `fetch`; usamos uma reatribuição
 * direta + `unknown as` para evitar variância de tipo.
 */
function mockContainerFetch(
  parseResult: ParseResult | null,
  status = 200,
): { restore: () => void } {
  const original = globalThis.fetch;
  const impl = async (input: unknown): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as { url?: string }).url ?? String(input);
    if (url.includes("/parse")) {
      if (parseResult === null || status !== 200) {
        return new Response("container error simulado", { status });
      }
      return new Response(JSON.stringify(parseResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`fetch não esperado: ${url}`);
  };
  (globalThis as { fetch: unknown }).fetch = impl as unknown as typeof fetch;
  return {
    restore(): void {
      (globalThis as { fetch: unknown }).fetch = original;
    },
  };
}

function readR2Text(env: ReturnType<typeof createPipelineEnv>, key: string): string {
  const obj = env.R2_LEIS.store.get(key);
  expect(obj).toBeTruthy();
  return new TextDecoder().decode(obj!.body);
}

describe("runIngestionPipeline — fluxo feliz", () => {
  let fetchSpy: { restore: () => void } | null = null;
  afterEach(() => {
    fetchSpy?.restore();
    fetchSpy = null;
    vi.restoreAllMocks();
  });

  it("processa parse com sucesso e marca done com 100%", async () => {
    const env = createPipelineEnv();
    fetchSpy = mockContainerFetch(fakeParseResult());

    const id = newIngestaoId();
    // status precisa existir antes do pipeline rodar (createStatus é chamado
    // pelo handler HTTP; aqui simulamos manualmente).
    const { createStatus } = await import("../src/pipeline/status-store.js");
    await createStatus(env, { id, leiId: "lc-test-2025" });

    // Semeia o cache KV de fs_listar_normas com um valor STALE. O pipeline
    // deve invalidá-lo ao atualizar o _index.json (regressão: sem isso a
    // norma recém-ingerida não apareceria na listagem por até 6h).
    const { cacheGet, cacheSet } = await import("../src/lib/cache.js");
    const { INDEX_CACHE_KEY } = await import(
      "../src/mcp/tools/filesystem/fs-listar-normas.js"
    );
    await cacheSet(env, INDEX_CACHE_KEY, { normas: [] }, 3600);

    const pdfBlob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });

    await runIngestionPipeline(env, {
      ingestaoId: id,
      pdf: pdfBlob,
      pdfFilename: "test.pdf",
      leiId: "lc-test-2025",
      leiTipo: "lei_complementar",
      numero: "999",
      ano: 2025,
      dataPublicacao: "2025-01-01",
    });

    const status = await readStatus(env, id);
    expect(status?.fase).toBe("done");
    expect(status?.progresso_pct).toBe(100);
    expect(status?.total_dispositivos).toBe(3);
    expect(status?.finalizado_em).toBeTruthy();

    // Cache de listagem foi invalidado (não serve mais o valor stale).
    expect(await cacheGet(env, INDEX_CACHE_KEY)).toBeNull();

    // D1 populado
    expect(env.DB.state.normas.size).toBe(1);
    expect(env.DB.state.dispositivos.size).toBe(3);
    expect(env.DB.state.versoes).toHaveLength(3);
    expect(env.DB.state.fts).toHaveLength(3);
    expect(env.DB.state.fts[0]).toMatchObject({
      dispositivo_id: "lc-test-2025-art-001",
      norma_id: "lc-test-2025",
      artigo: 1,
    });

    // R2: 3 .md + meta + sumario + canonical + index global
    const keys = Array.from(env.R2_LEIS.store.keys());
    expect(keys).toContain("lc-test-2025/dispositivos/livro-i/art-001.md");
    expect(keys).toContain("lc-test-2025/dispositivos/livro-i/art-002.md");
    expect(keys).toContain("lc-test-2025/dispositivos/livro-i/art-002-p-1.md");
    expect(keys).toContain("lc-test-2025/_meta.json");
    expect(keys).toContain("lc-test-2025/_sumario.json");
    expect(keys).toContain("lc-test-2025/_canonical.txt");
    expect(keys).toContain("_index.json");

    const sumario = JSON.parse(readR2Text(env, "lc-test-2025/_sumario.json")) as {
      estrutura: unknown[];
      total_dispositivos: number;
    };
    expect(Array.isArray(sumario.estrutura)).toBe(true);
    expect(sumario.total_dispositivos).toBe(3);

    const indice = JSON.parse(readR2Text(env, "_index.json")) as {
      normas: Array<Record<string, unknown>>;
    };
    expect(indice.normas[0]).toMatchObject({
      norma_id: "lc-test-2025",
      tipo: "lei_complementar",
    });

    // Vectorize: 3 vetores
    expect(env.VECTORIZE.vectors.size).toBe(3);
    expect(env.VECTORIZE.upsertCount).toBeGreaterThanOrEqual(1);
    expect(env.VECTORIZE.vectors.get("lc-test-2025-art-001")?.metadata).toMatchObject({
      norma_id: "lc-test-2025",
      lei: "lc-test-2025",
      hierarquia_path: expect.stringContaining("Art. 1"),
      texto: expect.stringContaining("Texto do artigo 1"),
    });

    // AI: 1 chamada (3 textos cabem num batch)
    expect(env.AI.callCount).toBe(1);
  });

  it("é idempotente: re-ingestão não duplica linhas em D1 nem chaves R2", async () => {
    const env = createPipelineEnv();
    fetchSpy = mockContainerFetch(fakeParseResult());

    const id1 = newIngestaoId();
    const { createStatus } = await import("../src/pipeline/status-store.js");
    await createStatus(env, { id: id1, leiId: "lc-test-2025" });
    const pdfBlob = new Blob([new Uint8Array([0x25])], { type: "application/pdf" });

    await runIngestionPipeline(env, {
      ingestaoId: id1,
      pdf: pdfBlob,
      pdfFilename: "test.pdf",
      leiId: "lc-test-2025",
      leiTipo: "lei_complementar",
      numero: "999",
      ano: 2025,
      dataPublicacao: "2025-01-01",
    });

    const dispBefore = env.DB.state.dispositivos.size;
    const r2Before = env.R2_LEIS.store.size;
    const vecBefore = env.VECTORIZE.vectors.size;

    // Re-ingestão com novo ID (mesma lei)
    const id2 = newIngestaoId();
    await createStatus(env, { id: id2, leiId: "lc-test-2025" });
    await runIngestionPipeline(env, {
      ingestaoId: id2,
      pdf: pdfBlob,
      pdfFilename: "test.pdf",
      leiId: "lc-test-2025",
      leiTipo: "lei_complementar",
      numero: "999",
      ano: 2025,
      dataPublicacao: "2025-01-01",
    });

    expect(env.DB.state.dispositivos.size).toBe(dispBefore);
    expect(env.DB.state.normas.size).toBe(1);
    expect(env.DB.state.versoes).toHaveLength(3);
    expect(env.R2_LEIS.store.size).toBe(r2Before);
    expect(env.VECTORIZE.vectors.size).toBe(vecBefore);

    const status2 = await readStatus(env, id2);
    expect(status2?.fase).toBe("done");
  });
});

describe("runIngestionPipeline — caminhos de erro", () => {
  let fetchSpy: { restore: () => void } | null = null;
  afterEach(() => {
    fetchSpy?.restore();
    fetchSpy = null;
    vi.restoreAllMocks();
  });

  it("marca failed com mensagem quando Container retorna 500", async () => {
    const env = createPipelineEnv();
    fetchSpy = mockContainerFetch(null, 500);

    const id = newIngestaoId();
    const { createStatus } = await import("../src/pipeline/status-store.js");
    await createStatus(env, { id, leiId: "lc-test-2025" });

    await runIngestionPipeline(env, {
      ingestaoId: id,
      pdf: new Blob([new Uint8Array([0x25])], { type: "application/pdf" }),
      pdfFilename: "test.pdf",
      leiId: "lc-test-2025",
      leiTipo: "lei_complementar",
      numero: "999",
      ano: 2025,
      dataPublicacao: "2025-01-01",
    });

    const status = await readStatus(env, id);
    expect(status?.fase).toBe("failed");
    expect(status?.erros.length).toBeGreaterThan(0);
    expect(status?.erros[status.erros.length - 1]?.mensagem).toContain("500");
  });
});

describe("endpoints HTTP do orquestrador", () => {
  let fetchSpy: { restore: () => void } | null = null;
  afterEach(() => {
    fetchSpy?.restore();
    fetchSpy = null;
    vi.restoreAllMocks();
  });

  function buildMultipart(): { body: FormData } {
    const fd = new FormData();
    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });
    fd.append("pdf", pdf, "test.pdf");
    fd.append("lei_id", "lc-test-2025");
    fd.append("lei_tipo", "lei_complementar");
    fd.append("numero", "999");
    fd.append("ano", "2025");
    fd.append("data_publicacao", "2025-01-01");
    return { body: fd };
  }

  it("POST /ingestao/iniciar responde 202 com ingestao_id", async () => {
    const env = createPipelineEnv();
    fetchSpy = mockContainerFetch(fakeParseResult());

    const ctx = createExecutionContext();
    const { body } = buildMultipart();
    const res = await worker.fetch(
      new Request("https://example.com/ingestao/iniciar", {
        method: "POST",
        body,
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(202);
    const json = (await res.json()) as Record<string, unknown>;
    expect(typeof json.ingestao_id).toBe("string");
    expect(json.lei_id).toBe("lc-test-2025");
    expect((json.status_url as string).startsWith("/ingestao/status/")).toBe(true);
  });

  it("POST /ingestao/iniciar rejeita 400 se metadata inválida", async () => {
    const env = createPipelineEnv();
    const fd = new FormData();
    fd.append("pdf", new Blob([new Uint8Array([0x25])], { type: "application/pdf" }), "test.pdf");
    fd.append("lei_id", "LC 214/2025"); // contém espaços/maiúsculas
    fd.append("lei_tipo", "lei_complementar");
    fd.append("numero", "214");
    fd.append("ano", "2025");
    fd.append("data_publicacao", "2025-01-16");

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/ingestao/iniciar", {
        method: "POST",
        body: fd,
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("POST /ingestao/iniciar rejeita 415 se Content-Type errado", async () => {
    const env = createPipelineEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/ingestao/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(415);
  });

  it("GET /ingestao/status/:id devolve registro", async () => {
    const env = createPipelineEnv();
    const { createStatus } = await import("../src/pipeline/status-store.js");
    const created = await createStatus(env, { id: "id-fixo", leiId: "lc-test-2025" });

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/ingestao/status/id-fixo"),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.id).toBe(created.id);
    expect(json.lei_id).toBe("lc-test-2025");
    expect(json.fase).toBe("pending");
  });

  it("GET /ingestao/status/:id devolve 404 para id inexistente", async () => {
    const env = createPipelineEnv();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/ingestao/status/nao-existe"),
      env,
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
