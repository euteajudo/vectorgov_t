/**
 * Auditor — papel 7/8 (CRÍTICO).
 *
 * Responsabilidade:
 *  - Verificar TODA citação produzida pelos outros papéis contra o
 *    filesystem (tool `fs_ler_dispositivo`).
 *  - Decidir APROVADA / REJEITADA por citação.
 *  - Calcular score_confianca agregado.
 *  - Sinalizar `exige_retry` para o motor PEVS.
 *
 * Modelo: gemini-3-pro (NÃO Flash). Auditoria exige instruction
 * following mais robusto e janela maior para comparar texto literal.
 *
 * Estratégia de verificação (rodada DETERMINÍSTICA antes do LLM):
 *  1. Para cada citação candidata, o Auditor chama `fs_ler_dispositivo`
 *     com (norma, artigo). Tool devolve `{ texto_oficial, hash_oficial }`.
 *  2. Normaliza ambos os textos (whitespace, lowercase opcional, etc.).
 *  3. Compara hash. Se igual → APROVADA. Se diferente → REJEITADA com
 *     motivo "Texto literal diverge".
 *  4. Tool não encontra o dispositivo → REJEITADA "Dispositivo inexistente".
 *
 * O LLM entra DEPOIS, só para:
 *  - Calcular o score agregado considerando o conjunto.
 *  - Escrever observações textuais (não pode mudar status APROVADA/REJEITADA
 *    obtido deterministicamente).
 *
 * Esse design "verificação determinística + LLM só para score/obs" é
 * a defesa central contra prompt injection / citações inventadas: o
 * Auditor NÃO confia no LLM para validar — confia no filesystem.
 */
import type { AgentRole, AgentContext, SkillFull, ToolMCP } from "../types.js";
import { montarSystemPrompt } from "../types.js";
import {
  RelatorioAuditorSchema,
  type RelatorioAuditor,
} from "./_io-schemas.js";
import type { CitacaoVerificada } from "@vectorgov-t/schemas";
import {
  resolverNormaId,
  parseArtigoRef,
  type ArtigoRef,
} from "../../lib/norma-ref.js";

export interface AuditorInput {
  /** Citações a verificar — vêm com status PENDENTE ou já preenchido. */
  citacoes: CitacaoVerificada[];
}

const TOOL_LER = "fs_ler_dispositivo";
// fs_listar_normas é usada no fallback de resolução de norma_id.
const TOOLS_PERMITIDAS = [TOOL_LER, "fs_listar_normas"];

const SYSTEM_BASE = `Você é o AUDITOR JURÍDICO do sistema multi-agente.
Sua função é VERIFICAR citações contra o filesystem (texto oficial das normas).

Regras DURAS — você NÃO pode quebrar:
1. NUNCA aprove uma citação que não passe na verificação determinística.
2. NUNCA invente normas, artigos, súmulas ou acórdãos.
3. Se NÃO tiver acesso ao texto oficial via tool, marque PENDENTE/REJEITADA — nunca APROVADA.
4. score_confianca: 1.0 só se TODAS citações APROVADAS e cobertura plena. Reduza
   proporcionalmente. Se houver QUALQUER REJEITADA, score <= 0.50.
5. exige_retry=true se houver pelo menos 1 REJEITADA.`;

/**
 * Normaliza texto para comparação determinística:
 *  - Trim
 *  - Colapsa whitespace
 *  - Remove BOM e zero-width
 */
function normalizarTexto(s: string): string {
  return s
    .replace(/﻿/g, "")
    .replace(/[​-‍]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcula SHA-256 hex via Web Crypto API.
 * Disponível em Workers runtime e em Node 19+.
 */
async function sha256Hex(s: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(s);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve a referência estruturada (norma_id + artigo numérico) que a tool
 * `fs_ler_dispositivo` exige, a partir de uma citação.
 *
 * Prioriza a proveniência da citação (campos `norma_id`/`dispositivo`
 * preenchidos pelo Pesquisador a partir das tools). Só recorre à resolução
 * heurística quando esses campos estão ausentes (ex.: base legal digitada
 * pelo usuário). Retorna `null` quando não consegue resolver — o chamador
 * trata como REJEITADA segura.
 */
async function resolverRefDispositivo(
  citacao: CitacaoVerificada,
  tools: ToolMCP[],
): Promise<{ norma_id: string; ref: ArtigoRef } | null> {
  const norma_id =
    citacao.norma_id ?? (await resolverNormaId(citacao.norma, tools));
  if (!norma_id) return null;

  const ref: ArtigoRef | null = citacao.dispositivo
    ? {
        artigo: citacao.dispositivo.artigo,
        paragrafo: citacao.dispositivo.paragrafo,
        inciso: citacao.dispositivo.inciso,
        alinea: citacao.dispositivo.alinea,
      }
    : parseArtigoRef(citacao.artigo);
  if (!ref) return null;

  return { norma_id, ref };
}

/**
 * Verifica uma única citação contra a tool `fs_ler_dispositivo`.
 *
 * Retorna a citação com `status` e `motivo_rejeicao` atualizados.
 * NÃO usa o LLM — pura mecânica. `tools` é o catálogo completo (precisamos
 * de `fs_ler_dispositivo` e, no fallback, `fs_listar_normas`).
 */
async function verificarUmaCitacao(
  citacao: CitacaoVerificada,
  tools: ToolMCP[],
): Promise<CitacaoVerificada> {
  const toolLer = tools.find((t) => t.nome === "fs_ler_dispositivo");
  if (!toolLer) {
    return {
      ...citacao,
      status: "REJEITADA",
      motivo_rejeicao: "Tool fs_ler_dispositivo indisponível no contexto",
    };
  }

  const resolvido = await resolverRefDispositivo(citacao, tools);
  if (!resolvido) {
    return {
      ...citacao,
      status: "REJEITADA",
      motivo_rejeicao: `Não foi possível resolver norma/artigo: "${citacao.norma}" / "${citacao.artigo}"`,
    };
  }

  try {
    const args: Record<string, unknown> = {
      norma_id: resolvido.norma_id,
      artigo: resolvido.ref.artigo,
    };
    if (resolvido.ref.paragrafo !== undefined)
      args.paragrafo = resolvido.ref.paragrafo;
    if (resolvido.ref.inciso !== undefined) args.inciso = resolvido.ref.inciso;
    if (resolvido.ref.alinea !== undefined) args.alinea = resolvido.ref.alinea;

    const resp = (await toolLer.executar(args)) as
      | { texto?: string }
      | undefined;

    if (!resp || !resp.texto) {
      return {
        ...citacao,
        status: "REJEITADA",
        motivo_rejeicao: `Dispositivo inexistente: ${resolvido.norma_id} art. ${resolvido.ref.artigo}`,
      };
    }
    const textoOficial = normalizarTexto(resp.texto);
    const textoCitado = normalizarTexto(citacao.texto_literal);
    const hashOficial = await sha256Hex(textoOficial);
    if (textoOficial === textoCitado) {
      return {
        ...citacao,
        status: "APROVADA",
        hash: hashOficial,
        motivo_rejeicao: null,
      };
    }
    return {
      ...citacao,
      status: "REJEITADA",
      hash: hashOficial,
      motivo_rejeicao:
        "Texto literal da citação diverge do filesystem (verificação determinística)",
    };
  } catch (err) {
    return {
      ...citacao,
      status: "REJEITADA",
      motivo_rejeicao: `Erro ao verificar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function criarAuditor(): AgentRole<AuditorInput, RelatorioAuditor> {
  return {
    nome: "auditor",
    papel: "Verifica citações contra filesystem (determinístico + LLM para score)",
    systemPromptBase: SYSTEM_BASE,
    toolsPermitidas: TOOLS_PERMITIDAS,
    modelo: "gemini-3-pro",
    schemaOutput: RelatorioAuditorSchema,
    async executar(
      input: AuditorInput,
      contexto: AgentContext,
      skills?: SkillFull[],
    ): Promise<RelatorioAuditor> {
      // FASE A: verificação determinística (NUNCA delega a LLM)
      const verificadas: CitacaoVerificada[] = [];
      for (const cit of input.citacoes) {
        verificadas.push(await verificarUmaCitacao(cit, contexto.tools));
      }
      const rejeitadas = verificadas.filter((c) => c.status === "REJEITADA");
      const aprovadas = verificadas.filter((c) => c.status === "APROVADA");
      const exigeRetry = rejeitadas.length > 0;

      // FASE B: LLM apenas para score + observações (não pode mudar status)
      const system = montarSystemPrompt(
        `${SYSTEM_BASE}\n\nVerificações determinísticas já realizadas — você NÃO pode mudar status APROVADA/REJEITADA. Apenas calcule score e descreva observações.`,
        skills,
      );
      const resumo = verificadas
        .map(
          (c, i) =>
            `${i + 1}. ${c.norma} ${c.artigo} → ${c.status}${c.motivo_rejeicao ? ` (${c.motivo_rejeicao})` : ""}`,
        )
        .join("\n");

      const llmResult = await contexto.llm.generateObject({
        modelo: contexto.modelos?.pevs_auditor ?? "gemini-3-pro",
        system,
        messages: [
          {
            role: "user",
            content: `Verificações já realizadas:\n${resumo || "(sem citações)"}\n\nTotal: ${verificadas.length}. Aprovadas: ${aprovadas.length}. Rejeitadas: ${rejeitadas.length}.\n\nProduza relatório (score + observações). Não inclua citações na resposta — vou preenchê-las eu mesmo a partir das verificações determinísticas.`,
          },
        ],
        schema: RelatorioAuditorSchema,
        tag: "auditor.relatorio",
        temperatura: 0.0,
      });

      // CRÍTICO: substituímos as citações vindas do LLM pelas
      // determinísticas, evitando que ele "mude" o status.
      // Também forçamos exige_retry pela verificação real.
      const relatorioFinal: RelatorioAuditor = {
        ...llmResult.object,
        citacoes_verificadas: verificadas,
        exige_retry: exigeRetry,
        // Clamp do score em [0, 1] e força <=0.50 se houver REJEITADA
        score_confianca: exigeRetry
          ? Math.min(0.5, llmResult.object.score_confianca)
          : Math.max(0, Math.min(1, llmResult.object.score_confianca)),
      };

      contexto.logger.info("auditor.executar concluído", {
        total: verificadas.length,
        aprovadas: aprovadas.length,
        rejeitadas: rejeitadas.length,
        exige_retry: exigeRetry,
        score: relatorioFinal.score_confianca,
        tracingId: contexto.tracingId,
      });

      return relatorioFinal;
    },
  };
}

/* Exportado para teste — permite invocar a verificação determinística direto. */
export const __test = { verificarUmaCitacao, normalizarTexto, sha256Hex };
