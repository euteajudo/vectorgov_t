/**
 * Testes de `handleIngestaoHealth` — warm-up/health do Container de ingestão.
 */
import { describe, it, expect } from "vitest";
import { handleIngestaoHealth } from "../src/pipeline/handlers.js";
import type { Env } from "../src/env.js";

function envCom(fetchImpl: (req: Request) => Promise<Response>): Env {
  return { INGESTION: { fetch: fetchImpl } } as unknown as Env;
}

describe("handleIngestaoHealth", () => {
  it("ready:true quando o container responde 200", async () => {
    const res = await handleIngestaoHealth(
      envCom(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    const j = (await res.json()) as { ready: boolean };
    expect(j.ready).toBe(true);
  });

  it("ready:false + aquecendo quando o ping falha (container frio)", async () => {
    const res = await handleIngestaoHealth(
      envCom(async () => {
        throw new Error("aborted");
      }),
    );
    const j = (await res.json()) as { ready: boolean; aquecendo?: boolean };
    expect(j.ready).toBe(false);
    expect(j.aquecendo).toBe(true);
  });

  it("ready:false quando o container responde não-2xx", async () => {
    const res = await handleIngestaoHealth(
      envCom(async () => new Response("erro", { status: 503 })),
    );
    const j = (await res.json()) as { ready: boolean };
    expect(j.ready).toBe(false);
  });

  it("ready:false quando o binding INGESTION está ausente", async () => {
    const res = await handleIngestaoHealth({} as Env);
    const j = (await res.json()) as { ready: boolean };
    expect(j.ready).toBe(false);
  });
});
