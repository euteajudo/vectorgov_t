import { defineConfig } from "vitest/config";

/**
 * Vitest config — testes dos schemas Zod.
 *
 * Pool 'forks' garante isolamento em ambiente Node puro (não precisa de
 * runtime Cloudflare). Inclui arquivos em `src/__tests__/*.test.ts`.
 */
export default defineConfig({
  test: {
    pool: "forks",
    globals: false,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
