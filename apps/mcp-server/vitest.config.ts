import { defineConfig } from "vitest/config";

/**
 * Vitest config — pool 'forks' garante isolamento e evita conflitos
 * com tipos do Workers runtime quando rodando em Node puro.
 *
 * Os testes usam fakes simples (KV / Env) declarados em `test/_fakes.ts`,
 * portanto não precisamos do `@cloudflare/vitest-pool-workers` neste
 * scaffolding inicial. Quando passarmos a depender de bindings reais
 * (Vectorize, R2), migrar para o pool oficial.
 */
export default defineConfig({
  test: {
    pool: "forks",
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
