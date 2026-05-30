/**
 * Tool MCP `pesquisar_web` (Track D) — pesquisa na internet via Tavily.
 *
 * Fonte SUPLEMENTAR (tier 2): complementa os preços públicos quando faltam
 * amostras aderentes. Todo resultado carrega `url` (proveniência obrigatória) e
 * o conjunto é rotulado como suplementar, para o Redator citar com ressalva.
 *
 * Secret `TAVILY_API_KEY` no Worker (free tier no MVP).
 */
import type { Env } from "../../../env.js";
import {
  PesquisarWebInputSchema,
  type PesquisaWebResultado,
  type ResultadoWeb,
} from "@vectorgov-t/schemas";
import { ToolValidationError, type ToolDescriptor } from "../types.js";
import { zodToMcpSchema } from "../json-schema.js";

const TAVILY_URL = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 20_000;

interface TavilyResult {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  score?: number | null;
  published_date?: string | null;
}
interface TavilyResponse {
  answer?: string | null;
  results?: TavilyResult[];
}

async function handler(args: unknown, env: Env): Promise<PesquisaWebResultado> {
  const parsed = PesquisarWebInputSchema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(
      "pesquisar_web: argumentos inválidos",
      parsed.error.flatten(),
    );
  }
  const input = parsed.data;

  // .trim(): o `wrangler secret put` via pipe pode incluir \n no fim da key,
  // o que torna o header `Bearer <key>` inválido (Tavily 401).
  const key = env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new ToolValidationError(
      "pesquisar_web: TAVILY_API_KEY não configurado no Worker.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data: TavilyResponse;
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: input.query,
        search_depth: "basic",
        topic: input.topico === "noticias" ? "news" : "general",
        max_results: input.max_resultados,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new ToolValidationError(`pesquisar_web: Tavily ${res.status}: ${body}`);
    }
    data = (await res.json()) as TavilyResponse;
  } catch (err) {
    if (err instanceof ToolValidationError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ToolValidationError("pesquisar_web: timeout na Tavily");
    }
    const msg = err instanceof Error ? err.message : "falha na requisição";
    throw new ToolValidationError(`pesquisar_web: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  const resultados: ResultadoWeb[] = (data.results ?? [])
    .filter((r): r is TavilyResult & { url: string } => typeof r.url === "string")
    .map((r) => ({
      titulo: (r.title?.trim() || r.url).slice(0, 300),
      url: r.url,
      conteudo: r.content ?? "",
      score:
        typeof r.score === "number" ? Math.max(0, Math.min(1, r.score)) : null,
      publicado_em: r.published_date ?? null,
    }));

  return {
    query: input.query,
    resultados,
    resposta_curta: data.answer ?? null,
    tier: "suplementar",
    consultado_em: new Date().toISOString(),
  };
}

export const pesquisarWebTool: ToolDescriptor = {
  name: "pesquisar_web",
  description:
    "Pesquisa na internet (Tavily) — fonte SUPLEMENTAR (tier 2) com proveniência " +
    "(URL) obrigatória. Use só para complementar os preços públicos quando faltam " +
    "amostras aderentes; cite sempre com ressalva.",
  inputSchema: zodToMcpSchema(PesquisarWebInputSchema),
  handler: handler as (a: unknown, e: Env) => Promise<unknown>,
};
