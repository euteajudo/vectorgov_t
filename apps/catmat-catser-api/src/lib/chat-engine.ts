/**
 * Engine conversacional do assistente de catálogo (Gemini via Vercel AI SDK).
 *
 * Mesmos princípios do chat do notebook do vectorgov-t: o backend conduz o
 * Gemini, que conduz o usuário. **Grounding determinístico** — o modelo só
 * apresenta código que veio de uma tool call (o system prompt, vindo da skill
 * `assistente-catalogo`, proíbe inventar). As 2 tools são as buscas do catálogo.
 */
import type { Env } from "../env.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import {
  TipoCatalogoSchema,
  type CatalogoBuscaResultado,
} from "@vectorgov-t/schemas";
import {
  buscarCatalogoHibrido,
  buscarCatalogoLexical,
} from "./catalogo-search.js";
import skillMd from "../../skills/assistente-catalogo.md";

/** Flash conduz a conversa (mesmo do chat do notebook). */
const MODELO = "gemini-3.5-flash";

/** Corpo da skill (sem o front-matter YAML) — vira o system prompt. */
function systemPrompt(): string {
  return skillMd.replace(/^﻿?---[\s\S]*?\n---\s*/, "").trim();
}

export interface ChatMensagem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResultado {
  texto: string;
  /** Resultados das buscas chamadas nesta volta — pro frontend renderizar chips. */
  tool_results: Array<{ tool: string; resultado: CatalogoBuscaResultado }>;
}

export async function conversarCatalogo(
  env: Env,
  apiKey: string,
  messages: ChatMensagem[],
): Promise<ChatResultado> {
  const provider = createGoogleGenerativeAI({ apiKey });
  const coletados: ChatResultado["tool_results"] = [];

  const result = await generateText({
    model: provider(MODELO),
    system: systemPrompt(),
    messages,
    temperature: 0.4,
    stopWhen: stepCountIs(6),
    tools: {
      buscar_catalogo_semantico: tool({
        description:
          "Busca o código CATMAT/CATSER por descrição em linguagem natural " +
          "(semântico). Use para DESCOBRIR candidatos a partir do que o usuário diz.",
        inputSchema: z.object({
          descricao: z
            .string()
            .min(3)
            .describe("Descrição do objeto em linguagem natural"),
          tipo: TipoCatalogoSchema.optional().describe(
            "material (CATMAT) ou servico (CATSER), se souber",
          ),
          top_k: z.number().int().min(1).max(15).default(8),
        }),
        execute: async ({ descricao, tipo, top_k }) => {
          const r = await buscarCatalogoHibrido(env, { descricao, tipo, top_k });
          coletados.push({ tool: "buscar_catalogo_semantico", resultado: r });
          return r;
        },
      }),
      buscar_catalogo_lexical: tool({
        description:
          "Busca o código por termo EXATO ou PARCIAL (FTS5 unicode61 + trigram). " +
          "Use para refinar/confirmar um termo técnico ou parcial.",
        inputSchema: z.object({
          termo: z.string().min(2).describe("Termo exato ou parcial"),
          tipo: TipoCatalogoSchema.optional(),
          max: z.number().int().min(1).max(20).default(10),
        }),
        execute: async ({ termo, tipo, max }) => {
          const r = await buscarCatalogoLexical(env, { padrao: termo, tipo, max });
          coletados.push({ tool: "buscar_catalogo_lexical", resultado: r });
          return r;
        },
      }),
    },
  });

  return { texto: result.text, tool_results: coletados };
}
