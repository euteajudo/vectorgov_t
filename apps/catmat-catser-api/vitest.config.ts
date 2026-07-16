import { defineConfig } from "vitest/config";

/**
 * Vitest config — mesmo padrão do mcp-server: pool 'forks' isola em Node puro
 * (sem runtime Cloudflare). Fakes de D1/AI/Vectorize em `test/_fakes.ts`;
 * a chamada Cohere usa `fetch` global, stubado via `vi.stubGlobal` nos testes.
 */
export default defineConfig({
  test: {
    pool: "forks",
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
