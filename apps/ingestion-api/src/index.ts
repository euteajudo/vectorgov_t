/**
 * Vectorgov_t — Ingestion API Worker
 *
 * Worker wrapper para o Container Cloudflare que executa o LegisParser
 * (Python + FastAPI) que parsa PDFs de legislação tributária brasileira.
 *
 * Arquitetura:
 *   Cliente → Worker (este) → Durable Object → Container (Python FastAPI)
 *
 * O Container fica dormindo (sleepAfter: 5m) quando ocioso, economizando custo.
 * Acorda automaticamente na primeira request e fica acessível pelo tempo
 * configurado.
 */

import { Container } from "@cloudflare/containers";

export interface Env {
  INGESTION: DurableObjectNamespace<IngestionContainer>;
}

/**
 * Durable Object que wrappa o Container Python.
 *
 * - defaultPort: 8080 (mesma porta do uvicorn/FastAPI)
 * - sleepAfter: 5 minutos — economiza custo entre ingestões
 * - envVars: passa secrets para o container Python
 */
export class IngestionContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  envVars = {
    // O secret real deve ser configurado via `wrangler secret put INGESTION_API_SECRET`
    // e injetado em runtime. Aqui só documentamos a presença.
    INGESTION_API_SECRET: "dev-secret-change-me",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Endpoints health/version respondidos diretamente pelo Worker (sem acordar o container)
    if (url.pathname === "/worker-health") {
      return new Response(
        JSON.stringify({ status: "ok", role: "worker", version: "0.1.0" }),
        { headers: { "content-type": "application/json" } }
      );
    }

    // Roteia toda outra request para o Container singleton.
    // Usamos um ID fixo "singleton" porque o LegisParser é stateless —
    // qualquer instância serve, e o Cloudflare cuida do scaling/sleeping.
    const id = env.INGESTION.idFromName("singleton");
    const stub = env.INGESTION.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
