/**
 * Vectorgov_t - Ingestion API Worker.
 *
 * Worker wrapper para o Container Cloudflare que executa o LegisParser
 * (Python + FastAPI). O Worker encaminha as requests para um Durable Object
 * singleton que gerencia o container.
 */

import { Container } from "@cloudflare/containers";

export interface Env {
  INGESTION: DurableObjectNamespace<IngestionContainer>;
  INGESTION_API_SECRET?: string;
}

/**
 * Durable Object que envolve o Container Python.
 */
export class IngestionContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      INGESTION_API_SECRET:
        env.INGESTION_API_SECRET ?? "dev-secret-change-me",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/worker-health") {
      return new Response(
        JSON.stringify({ status: "ok", role: "worker", version: "0.1.0" }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const id = env.INGESTION.idFromName("singleton");
    const stub = env.INGESTION.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
