/**
 * Next.js 15 config para Vectorgov_t Web UI.
 *
 * Decisões:
 *  - `transpilePackages`: garante que pacotes workspace (`@vectorgov-t/schemas`)
 *    sejam compilados pelo Next em vez de tratados como pré-compilados.
 *  - `images.unoptimized`: rodamos em Cloudflare Pages, onde o otimizador
 *    nativo do Next exige `@cloudflare/next-on-pages`. Desligado por padrão
 *    para simplificar o build inicial; ligar quando configurar o adapter.
 *  - `output: 'standalone'` NÃO usado aqui — o adapter `@cloudflare/next-on-pages`
 *    aplica sua própria transformação no build.
 *  - `reactStrictMode`: ativo, ajuda a detectar side-effects.
 *  - `env.NEXT_PUBLIC_MCP_BASE_URL`: URL do Worker MCP em produção. Default
 *    aponta para o subdomínio `souzat19`; sobrescrever via `.env.local`
 *    quando rodar contra deploy próprio.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@vectorgov-t/schemas"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_MCP_BASE_URL:
      process.env.NEXT_PUBLIC_MCP_BASE_URL ??
      "https://vectorgov-t-mcp.souzat19.workers.dev",
  },
  experimental: {
    // Necessário para que server components consigam ler arquivos do workspace
    // em modo dev sem precisar publicar dist/.
    externalDir: true,
  },
};

export default nextConfig;
