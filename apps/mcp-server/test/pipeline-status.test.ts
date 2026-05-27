/**
 * Testes do status store (`src/pipeline/status-store.ts`).
 */

import { describe, expect, it } from "vitest";
import {
  appendWarning,
  createStatus,
  markFailed,
  readStatus,
  updateStatus,
} from "../src/pipeline/status-store.js";
import { createPipelineEnv } from "./_fakes.js";

describe("status-store", () => {
  it("createStatus persiste registro pending com 0% progresso", async () => {
    const env = createPipelineEnv();
    const s = await createStatus(env, { id: "abc-123", leiId: "lc-214-2025" });
    expect(s.fase).toBe("pending");
    expect(s.progresso_pct).toBe(0);
    expect(s.processados).toBe(0);
    expect(s.erros).toEqual([]);
    expect(s.iniciado_em).toBe(s.atualizado_em);

    const reloaded = await readStatus(env, "abc-123");
    expect(reloaded?.id).toBe("abc-123");
    expect(reloaded?.lei_id).toBe("lc-214-2025");
  });

  it("updateStatus aplica patch e atualiza atualizado_em", async () => {
    const env = createPipelineEnv();
    await createStatus(env, { id: "x", leiId: "lc-214-2025" });
    const updated = await updateStatus(env, "x", {
      fase: "embedding",
      progresso_pct: 40,
    });
    expect(updated?.fase).toBe("embedding");
    expect(updated?.progresso_pct).toBe(40);
  });

  it("appendWarning acumula em erros[] sem mudar fase", async () => {
    const env = createPipelineEnv();
    await createStatus(env, { id: "x", leiId: "lc-214-2025" });
    await updateStatus(env, "x", { fase: "parsing", progresso_pct: 5 });
    await appendWarning(env, "x", "parsing", "PDF tem páginas em branco");
    const s = await readStatus(env, "x");
    expect(s?.fase).toBe("parsing");
    expect(s?.erros).toHaveLength(1);
    expect(s?.erros[0]?.mensagem).toBe("PDF tem páginas em branco");
    expect(s?.erros[0]?.fase).toBe("parsing");
  });

  it("markFailed seta fase=failed e finalizado_em", async () => {
    const env = createPipelineEnv();
    await createStatus(env, { id: "x", leiId: "lc-214-2025" });
    await markFailed(env, "x", "vectorize", "timeout");
    const s = await readStatus(env, "x");
    expect(s?.fase).toBe("failed");
    expect(s?.erros[0]?.mensagem).toBe("timeout");
    expect(s?.finalizado_em).toBeTruthy();
  });

  it("readStatus retorna null para ID inexistente", async () => {
    const env = createPipelineEnv();
    const s = await readStatus(env, "nao-existe");
    expect(s).toBeNull();
  });
});
