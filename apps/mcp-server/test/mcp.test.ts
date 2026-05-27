/**
 * Testes do handler MCP (`src/mcp/server.ts`) integrado via Worker.
 *
 * Cobre:
 *   - tools/list devolve `{ tools: [] }`.
 *   - método inválido → erro JSON-RPC -32601.
 *   - tools/call (sem tool registrada) → erro JSON-RPC -32601.
 *   - body não-JSON → -32700.
 *   - envelope inválido → -32600.
 *   - preservação do `id` da requisição na resposta.
 */

import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { createExecutionContext, createTestEnv } from "./_fakes.js";

/**
 * Envia uma requisição JSON-RPC ao endpoint `/mcp/v1` e devolve o JSON parseado.
 */
async function rpcCall(
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const env = createTestEnv();
  const ctx = createExecutionContext();
  const request = new Request("https://example.com/mcp/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await worker.fetch(request, env, ctx);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /mcp/v1 — tools/list", () => {
  it("retorna catálogo com 13 tools (9 leis Track D + 4 skills Track E)", async () => {
    const { status, json } = await rpcCall({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(status).toBe(200);
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(1);
    const result = json.result as {
      tools: Array<{ name: string; description: string; inputSchema: unknown }>;
    };
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools).toHaveLength(13);
    const names = result.tools.map((t) => t.name);
    // Leis primeiro (ordem do array MCP_TOOLS — Track D)
    expect(names.slice(0, 9)).toEqual([
      "buscar_legislacao",
      "consultar_artigo",
      "listar_artigos_por_tema",
      "comparar_redacoes",
      "fs_listar_normas",
      "fs_listar_estrutura",
      "fs_ler_dispositivo",
      "fs_ler_intervalo",
      "fs_grep",
    ]);
    // Skills depois (ordem do registry — Track E)
    expect(names.slice(9).sort()).toEqual([
      "skill_carregar",
      "skill_identificar_relevantes",
      "skill_listar",
      "skill_publicar",
    ]);
    // Cada tool deve ter description e inputSchema válidos.
    for (const t of result.tools) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(10);
      const schema = t.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
    }
  });

  it("preserva ID string da requisição", async () => {
    const { json } = await rpcCall({
      jsonrpc: "2.0",
      id: "req-abc",
      method: "tools/list",
    });
    expect(json.id).toBe("req-abc");
  });
});

describe("POST /mcp/v1 — método inválido", () => {
  it("retorna erro JSON-RPC -32601 method not found", async () => {
    const { status, json } = await rpcCall({
      jsonrpc: "2.0",
      id: 2,
      method: "metodo/inexistente",
    });
    expect(status).toBe(200);
    expect(json.error).toBeDefined();
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32601);
    expect(err.message).toContain("Method not found");
  });
});

describe("POST /mcp/v1 — tools/call", () => {
  it("retorna -32601 quando tool não existe", async () => {
    const { json } = await rpcCall({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "tool_inexistente", arguments: {} },
    });
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32601);
    expect(err.message).toContain("Tool not found");
  });

  it("retorna -32602 quando params não tem 'name'", async () => {
    const { json } = await rpcCall({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {},
    });
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32602);
  });
});

describe("POST /mcp/v1 — payload inválido", () => {
  it("retorna -32700 quando body não é JSON", async () => {
    const { json } = await rpcCall("isto-nao-eh-json{");
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32700);
  });

  it("retorna -32600 quando jsonrpc != '2.0'", async () => {
    const { json } = await rpcCall({
      jsonrpc: "1.0",
      id: 5,
      method: "tools/list",
    });
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32600);
  });

  it("retorna -32600 quando 'method' ausente", async () => {
    const { json } = await rpcCall({ jsonrpc: "2.0", id: 6 });
    const err = json.error as { code: number; message: string };
    expect(err.code).toBe(-32600);
  });
});
