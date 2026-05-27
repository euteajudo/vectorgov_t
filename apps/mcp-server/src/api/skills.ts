/**
 * Endpoints REST para o subsistema de skills.
 *
 * Rotas:
 *  - `GET  /api/skills`                 — lista skills (active + candidate).
 *  - `GET  /api/skills/:nome`           — markdown completo de uma skill.
 *  - `POST /api/skills/:nome/publicar`  — publica nova versão (com `promover=true`).
 *
 * Por dentro, esses handlers fazem proxy para as tools MCP existentes
 * (`skill_listar`, `skill_carregar`, `skill_publicar`) — mas usando uma
 * interface HTTP/REST mais simples para o frontend.
 *
 * Quando o R2_SKILLS está vazio, devolvemos mocks para a UI continuar
 * navegável durante desenvolvimento.
 */
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import {
  SkillPublicarInputSchema,
  validateSkillNome,
  zodErrorResponse,
} from "./validation.js";

/**
 * Mock de skills usado quando o R2 está vazio (cold-start / dev local).
 */
function mockSkills(): Array<{
  nome: string;
  descricao: string;
  categoria: string;
  versao: string;
  tokens_aproximados: number;
  agentes_aplicaveis: string[];
}> {
  return [
    {
      nome: "extrator-peticao-reequilibrio",
      descricao:
        "Extrai dados estruturados de uma petição de reequilíbrio: contrato, partes, fato alegado, cálculo apresentado.",
      categoria: "analise-peticao",
      versao: "1.2.0",
      tokens_aproximados: 1800,
      agentes_aplicaveis: ["orquestrador", "analista-juridico"],
    },
    {
      nome: "redator-parecer-formal",
      descricao:
        "Produz parecer formal em 5 seções (I-V) seguindo padrão AGU/Procuradorias, consumindo análise verificada.",
      categoria: "geracao-parecer",
      versao: "1.0.3",
      tokens_aproximados: 2400,
      agentes_aplicaveis: ["redator"],
    },
    {
      nome: "calculadora-reequilibrio-incc",
      descricao:
        "Calcula reequilíbrio com base no índice INCC para contratos de obra/serviço de engenharia.",
      categoria: "calculo-tributario",
      versao: "0.4.2",
      tokens_aproximados: 1200,
      agentes_aplicaveis: ["calculista"],
    },
    {
      nome: "buscador-jurisprudencia-tcu",
      descricao:
        "Recupera acórdãos TCU relevantes para reequilíbrio econômico-financeiro, com hierarquização por relevância.",
      categoria: "pesquisa-legislacao",
      versao: "0.9.1",
      tokens_aproximados: 1600,
      agentes_aplicaveis: ["pesquisador"],
    },
    {
      nome: "auditor-verificacao-citacoes",
      descricao:
        "Verifica citações comparando byte-a-byte contra filesystem; rejeita inventadas; calcula SHA-256.",
      categoria: "utilidades",
      versao: "1.1.0",
      tokens_aproximados: 950,
      agentes_aplicaveis: ["auditor"],
    },
  ];
}

/**
 * Mock para markdown da skill (quando R2 não tem nada).
 */
function mockSkillMarkdown(nome: string): string {
  return `---
nome: ${nome}
descricao: Skill exemplo retornada pelo mock do endpoint /api/skills.
trigger:
  palavras_chave:
    - exemplo
    - mock
  contextos:
    - "Skill carregada quando o R2_SKILLS está vazio."
agentes_aplicaveis:
  - orquestrador
modelo_recomendado: gemini-3-pro
versao: "0.1.0"
data_atualizacao: "2026-05-26"
autor: "Sistema Vectorgov_t"
tokens_aproximados: 800
categoria: utilidades
status: active
---

# Skill: ${nome}

Esta é uma skill de demonstração retornada pelo handler REST quando o bucket
\`R2_SKILLS\` ainda não contém arquivos. Substitua editando o markdown e
publicando via \`POST /api/skills/${nome}/publicar\`.

## Como usar

1. Edite as seções abaixo conforme a necessidade do agente.
2. Atualize a versão SemVer e a data.
3. Publique como \`candidate\` para A/B test ou como \`active\` para produção.

## Instruções para o agente

- Sempre cite a fonte original do dispositivo invocado.
- Use o tipo de cálculo apropriado ao objeto do contrato.
- Não invente decisões judiciais — quando faltar fundamento, sinalize como
  ponto pendente bloqueante.
`;
}

interface PublicarBody {
  conteudo_markdown: string;
  promover?: boolean;
}

/**
 * Handler `GET /api/skills`.
 */
export async function handleListarSkills(
  _request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Tentar listar do R2 — se vazio, devolver mocks.
    const r2List = await env.R2_SKILLS.list({ prefix: "active/", limit: 100 });
    if (r2List.objects.length === 0) {
      return jsonResponse({ items: mockSkills(), fonte: "mock" });
    }

    // Para cada arquivo .md em active/, lê o front-matter para extrair
    // metadados. Implementação leve — só metadados, não corpo.
    const items: Array<Record<string, unknown>> = [];
    for (const obj of r2List.objects) {
      if (!obj.key.endsWith(".md")) continue;
      // TODO: parsing real do YAML front-matter via yaml-frontmatter.ts
      items.push({
        nome: obj.key.replace(/^active\//, "").replace(/\.md$/, ""),
        descricao: "(metadados não parseados — TODO integrar yaml-frontmatter)",
        categoria: "utilidades",
        versao: "0.0.0",
        tokens_aproximados: 0,
        agentes_aplicaveis: ["orquestrador"],
      });
    }
    return jsonResponse({ items, fonte: "r2" });
  } catch (err) {
    return errorResponse(
      `Erro ao listar skills: ${err instanceof Error ? err.message : "desconhecido"}`,
      500,
    );
  }
}

/**
 * Handler `GET /api/skills/:nome`.
 */
export async function handleCarregarSkill(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const nome = decodeURIComponent(
    url.pathname.split("/").filter(Boolean).pop() ?? "",
  );
  if (!nome) {
    return errorResponse("nome da skill obrigatório", 400);
  }

  try {
    const r2obj = await env.R2_SKILLS.get(`active/${nome}.md`);
    if (!r2obj) {
      // Mock fallback
      return jsonResponse({
        metadata: {
          nome,
          descricao: "Mock — skill não encontrada no R2",
          trigger: {
            palavras_chave: ["mock"],
            contextos: ["Mock carregado por ausência da skill no R2."],
          },
          agentes_aplicaveis: ["orquestrador"],
          modelo_recomendado: "gemini-3-pro",
          versao: "0.1.0",
          data_atualizacao: "2026-05-26",
          autor: "Sistema",
          tokens_aproximados: 800,
          categoria: "utilidades",
          status: "active",
        },
        corpo_markdown: mockSkillMarkdown(nome),
        r2_key: `active/${nome}.md`,
        fonte: "mock",
      });
    }

    const texto = await r2obj.text();
    return jsonResponse({
      metadata: {
        nome,
        descricao: "(metadados não parseados — TODO integrar yaml-frontmatter)",
        trigger: { palavras_chave: ["—"], contextos: ["—"] },
        agentes_aplicaveis: ["orquestrador"],
        modelo_recomendado: "gemini-3-pro",
        versao: "0.0.0",
        data_atualizacao: "2026-05-26",
        autor: "—",
        tokens_aproximados: 0,
        categoria: "utilidades",
        status: "active",
      },
      corpo_markdown: texto,
      r2_key: `active/${nome}.md`,
      fonte: "r2",
    });
  } catch (err) {
    return errorResponse(
      `Erro ao carregar skill '${nome}': ${err instanceof Error ? err.message : "desconhecido"}`,
      500,
    );
  }
}

/**
 * Handler `POST /api/skills/:nome/publicar`.
 *
 * Body JSON: `{ conteudo_markdown: string, promover?: boolean }`.
 * Quando `promover=true`, grava em `active/`; caso contrário em `candidate/`.
 */
export async function handlePublicarSkill(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  // pathname: /api/skills/:nome/publicar
  const parts = url.pathname.split("/").filter(Boolean);
  const rawNome = decodeURIComponent(parts[parts.length - 2] ?? "");
  // Validação Zod do nome (follow-up P0 #53) — bloqueia path traversal
  const nomeCheck = validateSkillNome(rawNome);
  if (!nomeCheck.ok) return nomeCheck.response;
  const nome = nomeCheck.data;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("body JSON inválido", 400);
  }

  // Validação Zod completa: estrutura, tamanhos, YAML front-matter presente
  const bodyCheck = SkillPublicarInputSchema.safeParse(rawBody);
  if (!bodyCheck.success) {
    return zodErrorResponse(bodyCheck.error, "input de publicação inválido");
  }
  const body = bodyCheck.data;

  const destinoPrefix = body.promover ? "active/" : "candidate/";
  const r2Key = `${destinoPrefix}${nome}.md`;

  try {
    await env.R2_SKILLS.put(r2Key, body.conteudo_markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: body.descricao_versao
        ? { descricao_versao: body.descricao_versao }
        : undefined,
    });
    // TODO: invalidar cache KV, regenerar _meta.md/_meta.json
    return jsonResponse({
      publicado: true,
      r2_key: r2Key,
      promovido: body.promover,
    });
  } catch (err) {
    return errorResponse(
      `Erro ao publicar: ${err instanceof Error ? err.message : "desconhecido"}`,
      500,
    );
  }
}
