/**
 * Testes do roteador HTTP do Worker (`src/index.ts`).
 *
 * Cobre as três rotas "infra":
 *   - GET /health
 *   - GET /robots.txt
 *   - GET /version
 *
 * Mais um teste de sanidade do middleware de segurança (CORS + headers).
 */

import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { createExecutionContext, createTestEnv } from "./_fakes.js";

/**
 * Helper para chamar o handler com uma Request sintética.
 */
async function callWorker(request: Request): Promise<Response> {
  const env = createTestEnv();
  const ctx = createExecutionContext();
  return worker.fetch(request, env, ctx);
}

describe("GET /health", () => {
  it("retorna 200 + JSON com status 'ok' e version", async () => {
    const res = await callWorker(new Request("https://example.com/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime_seconds).toBe("number");
  });

  it("expõe security headers padrão", async () => {
    const res = await callWorker(new Request("https://example.com/health"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("GET /robots.txt", () => {
  it("retorna 200 + texto Disallow", async () => {
    const res = await callWorker(new Request("https://example.com/robots.txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /");
  });
});

describe("GET /version", () => {
  it("retorna name, version, mcp_protocol e build_date", async () => {
    const res = await callWorker(new Request("https://example.com/version"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.name).toBe("string");
    expect(typeof body.version).toBe("string");
    expect(typeof body.mcp_protocol).toBe("string");
    expect(typeof body.build_date).toBe("string");
  });
});

describe("OPTIONS *", () => {
  it("responde preflight CORS com 204", async () => {
    const res = await callWorker(
      new Request("https://example.com/mcp/v1", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("rotas desconhecidas", () => {
  it("retornam 404 JSON", async () => {
    const res = await callWorker(new Request("https://example.com/inexistente"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Not Found");
  });
});
