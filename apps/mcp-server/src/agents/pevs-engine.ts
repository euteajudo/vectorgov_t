/**
 * PEVS Engine — orquestra os 8 papéis em 5 fases:
 *
 *   PLAN     → Orquestrador decompõe pergunta em subtarefas
 *   EXECUTE  → Pesquisador + Calculista + Esp.Licitações em paralelo
 *   ANALYZE  → Esp.Reequilíbrio integra descobertas
 *   VERIFY   → Auditor checa cada citação contra fs_ler_dispositivo
 *   SYNTHESIZE → Redator produz output final (Feature 2)
 *
 * Decisões de design:
 *
 * 1. Retry automático: se Auditor reprovar (`exige_retry=true`), o
 *    motor RE-EXECUTA o Pesquisador com feedback do Auditor anexado
 *    ao contexto. Limite: `maxRetries` (default 3). Após esgotar,
 *    retorna análise com `veredito = "inconclusiva"` e ponto pendente
 *    bloqueante.
 *
 * 2. Logs estruturados por fase: cada transição emite `{phase, ...}`
 *    no logger — permite reconstrução do trace em produção.
 *
 * 3. Persistência: chamamos `sessionAgent.analisarPeticao(...)` ao final
 *    do Feature 1 e `gerarParecer(...)` ao final do Feature 2. O
 *    SessionAgent valida via Zod e mantém histórico SQL.
 *
 * 4. Determinismo onde possível: IDs gerados via `gerarUuid` (override
 *    para testes), `Date.now()` igualmente injetável (`now`). Sem essas
 *    injeções os testes não conseguem asserts estáveis.
 */
import type { AgentContext, AgentLogger, SkillFull } from "./types.js";
import { consoleLogger } from "./types.js";
import type { LLMClient } from "./llm/index.js";
import { TrackedLLMClient, type SnapshotUso } from "./cost-tracker.js";
import type { SessionAgent } from "./session-agent.js";
import { criarOrquestrador } from "./roles/orchestrator.js";
import { criarPesquisador } from "./roles/pesquisador.js";
import { criarAnalistaJuridico } from "./roles/analista.js";
import { criarEspLicitacoes } from "./roles/esp-licitacoes.js";
import { criarEspReequilibrio } from "./roles/esp-reequilibrio.js";
import { criarCalculista } from "./roles/calculista.js";
import { criarAuditor } from "./roles/auditor.js";
import { criarRedator } from "./roles/redator.js";
import type {
  ResultadoPesquisa,
  RelatorioAuditor,
  TipoDocumentoRedator,
  AnaliseJuridica,
} from "./roles/index.js";
import { classificarMerito } from "../mcp/tools/fiscal/index.js";
import { apurarVantajosidade } from "../lib/vantajosidade.js";
import {
  AnaliseReequilibrioSchema,
  type AnaliseReequilibrio,
  type Peticao,
  type Parecer,
  type PrecoReferencia,
} from "@vectorgov-t/schemas";

/**
 * Decisão do usuário no Feature 2 — qual documento gerar.
 */
export interface DecisaoFeature2 {
  tipo_documento: TipoDocumentoRedator;
  cabecalho_meta: {
    numero: string;
    parecerista: string;
    orgao: string;
    assunto: string;
    data: string;
  };
}

/**
 * Configuração injetável do motor PEVS.
 */
export interface PEVSConfig {
  llm: LLMClient;
  sessionAgent: SessionAgent;
  /** Tools MCP disponíveis (catálogo do Track D). */
  tools: AgentContext["tools"];
  /** Logger estruturado. Default: console. */
  logger?: AgentLogger;
  /** Limite de retries do ciclo PESQUISA→AUDITOR. Default: 3. */
  maxRetries?: number;
  /** Gerador de UUID — injetável para testes determinísticos. */
  gerarUuid?: () => string;
  /** Provider de tempo — injetável para testes. */
  now?: () => Date;
  /**
   * Override de modelo por função (lido do KV via `getModelConfig`).
   * Propagado pro `AgentContext.modelos` em todas as fases.
   */
  modelos?: AgentContext["modelos"];
  /**
   * Skills ATIVAS indexadas por `role.nome` (carregadas do R2 pelo caller via
   * `carregarSkillsPorPapel`). O motor injeta as do papel no system prompt de
   * cada agente — é o que faz editar uma skill mudar a análise/parecer.
   */
  skillsPorPapel?: Record<string, SkillFull[]>;
  /**
   * Callback opcional chamado em cada transição de fase macro
   * (PLAN / EXECUTE / ANALYZE / VERIFY / SYNTHESIZE / done / failed).
   * Caller usa pra atualizar status visível (KV `peticao:<id>`).
   * `pct` é 0-100. Erros do callback são silenciados pra não derrubar
   * o pipeline.
   */
  onFase?: (
    fase:
      | "PLAN"
      | "EXECUTE"
      | "ANALYZE"
      | "VERIFY"
      | "SYNTHESIZE"
      | "done"
      | "failed",
    pct: number,
    extra?: Record<string, unknown>,
  ) => void | Promise<void>;
}

/**
 * Resultado final do Feature 1 — pareado para fácil consumo.
 */
export interface ResultadoFeature1 {
  analise: AnaliseReequilibrio;
  /** Número de retries que foram necessários (0 se Auditor aprovou na primeira). */
  retries_executados: number;
  /**
   * Snapshot de tokens consumidos + custo estimado USD (F5.1 problema 2).
   * Acumulado por todas as chamadas LLM da execução, segregado por modelo.
   * Útil para budget tracking, análise de regressão de prompt e dashboard
   * de custo por petição.
   */
  uso_llm: SnapshotUso;
}

/**
 * Resultado final do Feature 2.
 */
export interface ResultadoFeature2 {
  parecer: Parecer;
  /** Mesma estrutura de `uso_llm` do Feature 1, escopo desta execução. */
  uso_llm: SnapshotUso;
}

/**
 * Gera UUID v4 simples (não-criptográfico, mas válido formato).
 * Cloudflare Workers expõem `crypto.randomUUID()` mas mantemos uma
 * implementação local para portabilidade em testes Node.
 */
function uuidV4Default(): string {
  // crypto.randomUUID está disponível em Workers e Node 20+
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (não usado em produção)
  return "00000000-0000-4000-8000-000000000000";
}

export class PEVSEngine {
  private readonly cfg: {
    llm: LLMClient;
    sessionAgent: SessionAgent;
    tools: AgentContext["tools"];
    logger: AgentLogger;
    maxRetries: number;
    gerarUuid: () => string;
    now: () => Date;
  };
  private readonly modelos: AgentContext["modelos"];
  private readonly onFase: PEVSConfig["onFase"];
  private readonly skillsPorPapel: PEVSConfig["skillsPorPapel"];

  constructor(cfg: PEVSConfig) {
    this.cfg = {
      llm: cfg.llm,
      sessionAgent: cfg.sessionAgent,
      tools: cfg.tools,
      logger: cfg.logger ?? consoleLogger,
      maxRetries: cfg.maxRetries ?? 3,
      gerarUuid: cfg.gerarUuid ?? uuidV4Default,
      now: cfg.now ?? (() => new Date()),
    };
    this.modelos = cfg.modelos;
    this.onFase = cfg.onFase;
    this.skillsPorPapel = cfg.skillsPorPapel;
  }

  /**
   * Dispara o callback `onFase` sem propagar erros (best-effort).
   */
  private async emitFase(
    fase:
      | "PLAN"
      | "EXECUTE"
      | "ANALYZE"
      | "VERIFY"
      | "SYNTHESIZE"
      | "done"
      | "failed",
    pct: number,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.onFase) return;
    try {
      await this.onFase(fase, pct, extra);
    } catch (err) {
      this.cfg.logger.warn("PEVS.onFase callback falhou", {
        fase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Constrói o AgentContext padrão usado em todas as fases.
   *
   * O `llm` passado AOS ROLES é o `TrackedLLMClient` (wrapper que registra
   * tokens). O `inner` original fica encapsulado — roles não sabem que
   * existe instrumentação, e isso é proposital (single responsibility).
   */
  private montarContexto(
    sessionId: string,
    tracingId: string,
    tracker: TrackedLLMClient,
  ): AgentContext {
    return {
      tools: this.cfg.tools,
      llm: tracker,
      logger: this.cfg.logger,
      sessionId,
      tracingId,
      modelos: this.modelos,
    };
  }

  /**
   * Loga uma transição de fase com payload estruturado.
   */
  private logFase(
    fase: string,
    tracingId: string,
    data: Record<string, unknown> = {},
  ): void {
    this.cfg.logger.info(`PEVS.${fase}`, { tracingId, ...data });
  }

  /** Skills ativas do papel (vazio se não houver) — injetadas no system prompt. */
  private skillsDe(papel: string): SkillFull[] | undefined {
    return this.skillsPorPapel?.[papel];
  }

  /**
   * Emite o log de auditoria final de uma análise — formato fixo para
   * facilitar agregação em dashboards (Workers Logs / Analytics Engine).
   *
   * Usa `console.log` em vez do `logger.info` porque o consumo downstream
   * (busca por `event: "analise_completa"`) é facilitado quando a linha
   * JSON é independente do prefixo do logger estruturado.
   */
  private logAnaliseCompleta(
    tracingId: string,
    peticao: Peticao,
    duracao_ms: number,
    uso: SnapshotUso,
  ): void {
    console.log(
      JSON.stringify({
        event: "analise_completa",
        tracing_id: tracingId,
        peticao_id: peticao.id ?? null,
        contrato: peticao.contrato.numero,
        duracao_ms,
        tokens_total: uso.total_tokens,
        custo_estimado_usd: uso.custo_estimado_usd,
        chamadas_llm: uso.total_chamadas,
        por_modelo: uso.por_modelo,
      }),
    );
  }

  /**
   * Feature 1 — análise de petição (PLAN→EXECUTE→ANALYZE→VERIFY).
   *
   * Não invoca o Redator (isso é Feature 2). Retorna a análise pronta
   * para persistência + decisão do usuário.
   */
  async executarFeature1(
    peticao: Peticao,
    opts: { sessionId?: string; tracingId?: string } = {},
  ): Promise<ResultadoFeature1> {
    const tracingId = opts.tracingId ?? this.cfg.gerarUuid();
    const sessionId = opts.sessionId ?? "default";
    // Tracker novo por execução — snapshot reflete APENAS esta análise.
    const tracker = new TrackedLLMClient(this.cfg.llm);
    const contexto = this.montarContexto(sessionId, tracingId, tracker);
    const inicio = this.cfg.now();

    this.logFase("inicio", tracingId, {
      contrato: peticao.contrato.numero,
      valor_centavos: peticao.contrato.valor_centavos,
    });

    // FASE 1 — PLAN
    this.logFase("PLAN", tracingId);
    await this.emitFase("PLAN", 10);
    const orquestrador = criarOrquestrador();
    const plano = await orquestrador.executar(
      { peticao },
      contexto,
      this.skillsDe("orquestrador"),
    );
    this.logFase("PLAN.ok", tracingId, {
      subtarefas: plano.subtarefas.length,
    });

    // FASE 2 — EXECUTE (Pesquisador + Calculista + Esp.Licitações em paralelo)
    // Esp.Licitações depende do Pesquisador na nossa pipeline (precisa
    // dos achados), então o paralelismo é: Pesquisador || Calculista,
    // depois Esp.Licitações + Analista.
    this.logFase("EXECUTE", tracingId);
    await this.emitFase("EXECUTE", 30);
    const pesquisador = criarPesquisador();
    const calculista = criarCalculista();

    const perguntaFocal = `Reequilíbrio do contrato ${peticao.contrato.numero}: ${peticao.fato_alegado.slice(0, 200)}`;
    const contextoPeticao = `Contrato ${peticao.contrato.numero} (${peticao.contrato.modalidade}); contratante: ${peticao.contratante.razao_social}; contratado: ${peticao.contratado.razao_social}; base legal invocada: ${peticao.base_legal_invocada.join("; ") || "(vazia)"}.`;

    // Competência para resolver a vigência das normas (lookup exato do
    // Pesquisador): data representativa do período de EXECUÇÃO em análise.
    // Heurística (espelha o `inicioRemanescente` do cálculo): o maior entre o
    // início da vigência e hoje — a redação aplicável às prestações ainda por
    // executar. Refinamento futuro: resolver por ano, como faz a tool #10.
    const hojeISO = this.cfg.now().toISOString().slice(0, 10);
    const competencia =
      peticao.contrato.data_inicio_vigencia > hojeISO
        ? peticao.contrato.data_inicio_vigencia
        : hojeISO;

    let resultadoPesquisa: ResultadoPesquisa | undefined;
    let relatorioAuditor: RelatorioAuditor | undefined;
    let retries = 0;
    let feedbackAuditor = "";

    while (retries <= this.cfg.maxRetries) {
      const perguntaComFeedback = feedbackAuditor
        ? `${perguntaFocal}\n\n[RETRY ${retries}] Feedback do Auditor anterior:\n${feedbackAuditor}`
        : perguntaFocal;

      // Pesquisa + Cálculos em paralelo
      const [pesquisaP, calculosP] = await Promise.all([
        pesquisador.executar(
          {
            pergunta_focal: perguntaComFeedback,
            contexto_peticao: contextoPeticao,
            competencia,
          },
          contexto,
          this.skillsDe("pesquisador"),
        ),
        calculista.executar(
          {
            peticao,
            contexto_pedido: `Calcule o valor do reequilíbrio com base no fato alegado.`,
          },
          contexto,
          this.skillsDe("calculista"),
        ),
      ]);
      resultadoPesquisa = pesquisaP;

      // Analista + Esp.Licitações em paralelo (ambos consomem pesquisa)
      this.logFase("EXECUTE.parallel-analysts", tracingId);
      const analista = criarAnalistaJuridico();
      const espLicit = criarEspLicitacoes();
      const [analiseTrib, parecerLicit] = await Promise.all([
        analista.executar(
          {
            pergunta_focal: perguntaComFeedback,
            resultado_pesquisa: pesquisaP,
            peticao,
          },
          contexto,
          this.skillsDe("analista_juridico"),
        ),
        espLicit.executar(
          { pergunta_focal: perguntaComFeedback, resultado_pesquisa: pesquisaP },
          contexto,
          this.skillsDe("esp_licitacoes"),
        ),
      ]);

      // FASE 3 — ANALYZE
      this.logFase("ANALYZE", tracingId);
      await this.emitFase("ANALYZE", 55);
      const espReeq = criarEspReequilibrio();
      const sintese = await espReeq.executar(
        {
          pergunta_focal: perguntaComFeedback,
          analise_tributaria: analiseTrib,
          parecer_licitacao: parecerLicit,
          resultado_calculista: calculosP,
        },
        contexto,
        this.skillsDe("esp_reequilibrio"),
      );

      // FASE 4 — VERIFY (Auditor)
      this.logFase("VERIFY", tracingId, {
        citacoes_a_verificar: pesquisaP.citacoes_candidatas.length,
      });
      await this.emitFase("VERIFY", 75);
      const auditor = criarAuditor();
      relatorioAuditor = await auditor.executar(
        { citacoes: pesquisaP.citacoes_candidatas },
        contexto,
        this.skillsDe("auditor"),
      );
      this.logFase("VERIFY.ok", tracingId, {
        aprovadas: relatorioAuditor.citacoes_verificadas.filter(
          (c) => c.status === "APROVADA",
        ).length,
        rejeitadas: relatorioAuditor.citacoes_verificadas.filter(
          (c) => c.status === "REJEITADA",
        ).length,
        score: relatorioAuditor.score_confianca,
        exige_retry: relatorioAuditor.exige_retry,
      });

      if (!relatorioAuditor.exige_retry) {
        // Caminho feliz — montar análise final
        // Opção A: apura vantajosidade (catálogo → preço → docs) e anexa à
        // análise. Best-effort — null não interrompe o fluxo.
        const precoRef = await apurarVantajosidade(
          peticao,
          contexto.tools,
          this.cfg.now().toISOString().slice(0, 10),
        );
        const analise = this.montarAnalise(
          peticao,
          sintese,
          calculosP,
          relatorioAuditor,
          analiseTrib,
          tracingId,
          precoRef,
        );
        const uso_llm = tracker.snapshot();
        const duracao_ms = this.cfg.now().getTime() - inicio.getTime();
        this.logFase("FIM.ok", tracingId, { veredito: analise.veredito });
        this.logAnaliseCompleta(tracingId, peticao, duracao_ms, uso_llm);
        // Persistir
        await this.cfg.sessionAgent.analisarPeticao(peticao, analise);
        await this.emitFase("done", 100, { veredito: analise.veredito });
        return { analise, retries_executados: retries, uso_llm };
      }

      // Precisamos de retry
      retries++;
      feedbackAuditor = relatorioAuditor.citacoes_verificadas
        .filter((c) => c.status === "REJEITADA")
        .map((c) => `- ${c.norma} ${c.artigo}: ${c.motivo_rejeicao}`)
        .join("\n");
      this.logFase("VERIFY.retry", tracingId, {
        retry: retries,
        max: this.cfg.maxRetries,
      });
    }

    // Esgotou retries — análise inconclusiva
    this.logFase("FIM.retries-esgotados", tracingId, {
      retries,
    });
    const analiseInconclusiva = this.montarAnaliseInconclusiva(
      peticao,
      relatorioAuditor!,
    );
    const uso_llm = tracker.snapshot();
    const duracao_ms = this.cfg.now().getTime() - inicio.getTime();
    this.logAnaliseCompleta(tracingId, peticao, duracao_ms, uso_llm);
    await this.cfg.sessionAgent.analisarPeticao(peticao, analiseInconclusiva);
    await this.emitFase("done", 100, {
      veredito: analiseInconclusiva.veredito,
      retries_esgotados: true,
    });
    return { analise: analiseInconclusiva, retries_executados: retries, uso_llm };
  }

  /**
   * Feature 2 — produz parecer formal a partir de análise existente
   * (já assinada pelo Auditor).
   *
   * Falha se a análise tiver `veredito = "inconclusiva"` ou citações
   * não-APROVADAS — não faz sentido publicar parecer em cima de algo
   * que o próprio Auditor não confiou.
   */
  async executarFeature2(
    analise: AnaliseReequilibrio,
    decisao: DecisaoFeature2,
    opts: { sessionId?: string; tracingId?: string } = {},
  ): Promise<ResultadoFeature2> {
    const tracingId = opts.tracingId ?? this.cfg.gerarUuid();
    const sessionId = opts.sessionId ?? "default";
    const tracker = new TrackedLLMClient(this.cfg.llm);
    const contexto = this.montarContexto(sessionId, tracingId, tracker);
    const inicio = this.cfg.now();

    this.logFase("F2.inicio", tracingId, {
      veredito: analise.veredito,
      tipo_documento: decisao.tipo_documento,
    });

    if (analise.veredito === "inconclusiva") {
      throw new Error(
        "executarFeature2: análise inconclusiva — não é possível gerar parecer formal antes de complementar pontos pendentes",
      );
    }
    const naoAprovada = analise.citacoes.find((c) => c.status !== "APROVADA");
    if (naoAprovada) {
      throw new Error(
        `executarFeature2: análise contém citação não APROVADA (${naoAprovada.norma} ${naoAprovada.artigo}) — Auditor não a aprovou`,
      );
    }

    // FASE 5 — SYNTHESIZE (Redator)
    this.logFase("F2.SYNTHESIZE", tracingId);
    await this.emitFase("SYNTHESIZE", 90);
    const redator = criarRedator();
    const parecerId = this.cfg.gerarUuid();
    const parecer = await redator.executar(
      {
        analise,
        tipo_documento: decisao.tipo_documento,
        cabecalho_meta: decisao.cabecalho_meta,
        parecer_id: parecerId,
      },
      contexto,
      this.skillsDe("redator"),
    );

    // Persistir
    await this.cfg.sessionAgent.gerarParecer(parecer);
    const uso_llm = tracker.snapshot();
    const duracao_ms = this.cfg.now().getTime() - inicio.getTime();
    this.logFase("F2.FIM.ok", tracingId, { parecer_id: parecer.id });
    await this.emitFase("done", 100, { parecer_id: parecer.id });
    // Log estruturado de custo do Feature 2 (mesmo formato do F1 para
    // facilitar agregação no Workers Logs / Analytics Engine).
    console.log(
      JSON.stringify({
        event: "parecer_completo",
        tracing_id: tracingId,
        analise_id: analise.id,
        parecer_id: parecer.id,
        duracao_ms,
        tokens_total: uso_llm.total_tokens,
        custo_estimado_usd: uso_llm.custo_estimado_usd,
        chamadas_llm: uso_llm.total_chamadas,
        por_modelo: uso_llm.por_modelo,
      }),
    );
    return { parecer, uso_llm };
  }

  /**
   * Monta a `AnaliseReequilibrio` final juntando o que cada papel produziu.
   *
   * Faz isso programaticamente (não via LLM) — o LLM já produziu cada peça.
   * O VEREDITO é DETERMINÍSTICO: vem de `classificarMerito` (regra pura sobre
   * o número da engine + as flags de admissibilidade do Analista). O
   * `veredito_sugerido` do Esp. Reequilíbrio é apenas advisory. Esta etapa
   * roda DEPOIS do gate de `inconclusiva` (Auditor reprovou citações), então
   * aqui a análise já está tecnicamente fundamentada.
   */
  private montarAnalise(
    peticao: Peticao,
    sintese: ReturnType<typeof criarEspReequilibrio>["schemaOutput"]["_output"],
    calculos: ReturnType<typeof criarCalculista>["schemaOutput"]["_output"],
    relatorio: RelatorioAuditor,
    analiseTrib: AnaliseJuridica,
    tracingId: string,
    precoRef: PrecoReferencia | null,
  ): AnaliseReequilibrio {
    // Cálculo de reequilíbrio bem-sucedido (delta vem daqui).
    const calc = calculos.calculos.find(
      (c) => c.sucesso && c.valor_final !== null,
    );

    // Sem cálculo válido não há delta para classificar o mérito → diligência
    // (cabe ao órgão complementar os inputs da engine, ex.: alíquotas de
    // referência). Mantém o sistema determinístico mesmo no caminho de falha.
    if (!calc) {
      const pontos = [
        {
          descricao:
            "Cálculo determinístico do reequilíbrio não pôde ser concluído (inputs insuficientes para a engine). Complementar dados antes de decidir o mérito.",
          severidade: "alta" as const,
          responsavel: "orgao" as const,
        },
        ...sintese.pontos_a_complementar,
      ];
      return AnaliseReequilibrioSchema.parse({
        id: this.cfg.gerarUuid(),
        peticao_id: peticao.id ?? this.cfg.gerarUuid(),
        veredito: "diligencia",
        fundamentacao: this.montarFundamentacao(
          sintese,
          relatorio,
          "Diligência: cálculo do diferencial de carga não concluído pela engine determinística.",
        ),
        citacoes: relatorio.citacoes_verificadas,
        calculos: calculos.calculos,
        score_confianca: relatorio.score_confianca,
        pontos_a_complementar: pontos,
        gerado_em: this.cfg.now().toISOString(),
        modelo_auditor: "gemini-3-pro",
        preco_referencia: precoRef,
      });
    }

    // Valor pleiteado: SOMA dos cálculos apresentados pelo requerente (tratados
    // como componentes do pleito total). `null` quando a petição não quantifica
    // — a regra trata isso como falta de instrução (art. 376, IV).
    const valorPleiteado =
      peticao.calculos_apresentados.length > 0
        ? peticao.calculos_apresentados.reduce(
            (soma, c) => soma + c.valor_pretendido_centavos,
            0,
          )
        : null;

    const deltaPp =
      typeof calc.inputs.diferencial_pct === "number"
        ? calc.inputs.diferencial_pct
        : 0;

    // VEREDITO DETERMINÍSTICO — regra pura sobre número + admissibilidade.
    const merito = classificarMerito({
      delta_valor_centavos: calc.valor_final ?? 0,
      delta_percentual_pp: deltaPp,
      valor_pleiteado_centavos: valorPleiteado,
      admissibilidade: {
        no_escopo: analiseTrib.admissibilidade.no_escopo,
        tempestivo: analiseTrib.admissibilidade.tempestivo,
        instruido: analiseTrib.admissibilidade.instruido,
      },
      comprovacao_suficiente: analiseTrib.admissibilidade.comprovacao_suficiente,
    });

    this.logFase("MERITO", tracingId, {
      veredito: merito.veredito,
      motivo: merito.motivo,
      valor_reconhecido_centavos: merito.valor_reconhecido_centavos,
      veredito_sugerido_llm: sintese.veredito_sugerido,
    });

    // `diligencia` exige >=1 ponto_a_complementar (invariante do schema):
    // garante um ponto derivado do motivo quando o LLM não trouxe nenhum.
    let pontos = sintese.pontos_a_complementar;
    if (merito.veredito === "diligencia" && pontos.length === 0) {
      pontos = [
        {
          descricao: merito.fundamento,
          severidade: "alta",
          responsavel: "requerente",
        },
      ];
    }

    return AnaliseReequilibrioSchema.parse({
      id: this.cfg.gerarUuid(),
      peticao_id: peticao.id ?? this.cfg.gerarUuid(),
      veredito: merito.veredito,
      fundamentacao: this.montarFundamentacao(
        sintese,
        relatorio,
        `Veredito (regra determinística): ${merito.veredito} — ${merito.fundamento} Valor reconhecido: R$ ${(merito.valor_reconhecido_centavos / 100).toFixed(2)}.${merito.revisao_de_oficio ? " Recomenda-se revisão de ofício para redução (art. 375)." : ""}`,
      ),
      citacoes: relatorio.citacoes_verificadas,
      calculos: calculos.calculos,
      score_confianca: relatorio.score_confianca,
      pontos_a_complementar: pontos,
      gerado_em: this.cfg.now().toISOString(),
      modelo_auditor: "gemini-3-pro",
      preco_referencia: precoRef,
    });
  }

  /**
   * Monta análise inconclusiva quando os retries esgotaram.
   */
  private montarAnaliseInconclusiva(
    peticao: Peticao,
    relatorio: RelatorioAuditor,
  ): AnaliseReequilibrio {
    const pontosBloqueantes = [
      {
        descricao:
          "Auditor reprovou citações em todos os retries — necessário fornecer fontes verificáveis",
        severidade: "bloqueante" as const,
        responsavel: "requerente" as const,
      },
    ];
    return AnaliseReequilibrioSchema.parse({
      id: this.cfg.gerarUuid(),
      peticao_id: peticao.id ?? this.cfg.gerarUuid(),
      veredito: "inconclusiva",
      fundamentacao: `Análise inconclusiva após ${this.cfg.maxRetries} retries do Auditor. ${relatorio.observacoes || ""} Recomenda-se complementar a documentação com fontes oficiais verificáveis antes de nova análise. ${"_".repeat(50)}`,
      citacoes: relatorio.citacoes_verificadas,
      calculos: [],
      score_confianca: Math.min(0.5, relatorio.score_confianca),
      pontos_a_complementar: pontosBloqueantes,
      gerado_em: this.cfg.now().toISOString(),
      modelo_auditor: "gemini-3-pro",
    });
  }

  /**
   * Junta a síntese do Esp.Reequilíbrio com observações do Auditor
   * para formar a `fundamentacao` da análise (texto livre, >=200 chars).
   */
  private montarFundamentacao(
    sintese: { sintese: string },
    relatorio: RelatorioAuditor,
    conclusaoMerito?: string,
  ): string {
    const base = sintese.sintese;
    const merito = conclusaoMerito ? `\n\n${conclusaoMerito}` : "";
    const obs = relatorio.observacoes
      ? `\n\nObservações do Auditor: ${relatorio.observacoes}`
      : "";
    const corpo = `${base}${merito}${obs}`;
    const padded =
      corpo.length >= 200
        ? corpo
        : `${corpo}\n\n${"_".repeat(Math.max(0, 200 - corpo.length))}`;
    return padded;
  }
}
