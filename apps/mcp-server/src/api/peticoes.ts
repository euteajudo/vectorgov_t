/**
 * Endpoints REST para o ciclo de vida de uma petição.
 *
 * São endpoints user-friendly que a UI Web consome. Internamente eles
 * orquestram o motor PEVS (que ainda não está plugado em produção neste
 * worker) — por enquanto, as funções devolvem mocks marcados com TODO
 * para integração real na próxima sprint.
 *
 * Rotas cobertas:
 *  - `POST /api/peticoes/upload`            (multipart: pdf + metadata JSON)
 *  - `GET  /api/peticoes/:id`               (status + análise completa quando done)
 *  - `POST /api/peticoes/:id/parecer`       (dispara geração de parecer)
 *  - `GET  /api/peticoes/:id/parecer`       (lê parecer já gerado)
 *
 * Persistência atual: KV (`CACHE`) com chave `peticao:<id>` (24h TTL).
 * Quando o backend tiver D1 com tabela `peticoes`, migrar para SQL.
 */
import type { Env } from "../env.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";

/**
 * Tamanho máximo de PDF aceito (bytes). Igual ao endpoint de ingestão.
 */
const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Estado interno persistido em KV por petição.
 *
 * TODO: substituir por D1 quando a tabela `peticoes` existir.
 */
interface PeticaoRecord {
  id: string;
  fase:
    | "queued"
    | "PLAN"
    | "EXECUTE"
    | "ANALYZE"
    | "VERIFY"
    | "SYNTHESIZE"
    | "done"
    | "failed";
  progresso_pct: number;
  iniciado_em: string;
  atualizado_em: string;
  metadata: Record<string, unknown>;
  analise?: unknown;
  parecer?: unknown;
  erro?: string;
}

/**
 * Gera UUID v4. Usa `crypto.randomUUID()` que existe nativo em Workers.
 */
function newPeticaoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // fallback determinístico (apenas para ambientes sem crypto.randomUUID)
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

const KV_PREFIX = "peticao:";
const KV_TTL_SECONDS = 24 * 60 * 60; // 24 horas

async function writeRecord(env: Env, record: PeticaoRecord): Promise<void> {
  await env.CACHE.put(`${KV_PREFIX}${record.id}`, JSON.stringify(record), {
    expirationTtl: KV_TTL_SECONDS,
  });
}

async function readRecord(env: Env, id: string): Promise<PeticaoRecord | null> {
  const raw = await env.CACHE.get(`${KV_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PeticaoRecord;
  } catch {
    return null;
  }
}

/**
 * Mock de análise completa — devolve algo que valida contra `AnaliseReequilibrioSchema`.
 *
 * TODO: substituir pela invocação real do `PEVSEngine.executarFeature1(...)`
 * quando os agentes estiverem plugados no Worker.
 */
function gerarAnaliseMock(
  peticaoId: string,
  metadata: Record<string, unknown>,
): unknown {
  const agora = new Date().toISOString();
  return {
    id: newPeticaoId(),
    peticao_id: peticaoId,
    veredito: "parcialmente_procedente",
    fundamentacao:
      "A petição apresenta requisitos formais do art. 124 da Lei nº 14.133/2021 para reequilíbrio econômico-financeiro. " +
      "Verificada a ocorrência de fato superveniente extraordinário (variação atípica do INCC acima de 12% no período), " +
      "constata-se nexo de causalidade com o desequilíbrio alegado. Contudo, o cálculo apresentado pelo contratado utiliza " +
      "índice inadequado (IPCA em vez de INCC), o que justifica o deferimento parcial com ajuste metodológico. Recomenda-se " +
      "termo aditivo limitado ao impacto líquido demonstrado no demonstrativo IV.",
    citacoes: [
      {
        id: "cit-001",
        tipo_fonte: "lei",
        norma: "Lei nº 14.133/2021",
        artigo: "art. 124, II, d",
        texto_literal:
          "Art. 124. Os contratos regidos por esta Lei poderão ser alterados, com as devidas justificativas, nos seguintes casos: " +
          "[...] II - por acordo entre as partes: [...] d) para restabelecer o equilíbrio econômico-financeiro inicial do contrato, " +
          "em caso de força maior, caso fortuito ou fato do príncipe ou em decorrência de fatos imprevisíveis, ou previsíveis de " +
          "consequências incalculáveis, retardadores ou impeditivos da execução do ajustado, ou ainda em caso de álea econômica " +
          "extraordinária e extracontratual.",
        hash:
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        status: "APROVADA",
        fonte_url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm",
      },
      {
        id: "cit-002",
        tipo_fonte: "acordao_tcu",
        norma: "Acórdão TCU 1.595/2018-Plenário",
        artigo: "Item 9.3.1",
        texto_literal:
          "É indispensável a comprovação do nexo de causalidade entre o fato superveniente e o desequilíbrio, " +
          "vedada a recomposição genérica de margem de lucro.",
        hash:
          "f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
        status: "APROVADA",
        fonte_url: null,
      },
    ],
    calculos: [
      {
        id: "calc-001",
        tipo: "reequilibrio_economico",
        descricao:
          "Recálculo do desequilíbrio com índice setorial (INCC) em substituição ao IPCA apresentado.",
        inputs: {
          custo_unitario_original: 1234.56,
          variacao_incc_acumulada: 0.0875,
          quantidade_meses_restantes: 18,
        },
        memoria: [
          {
            descricao: "Custo unitário base (referência da proposta vencedora)",
            valor: 1234.56,
            unidade: "BRL",
          },
          {
            descricao: "× variação acumulada INCC no período",
            valor: 1.0875,
            unidade: "fator",
            formula: "1 + 0,0875",
          },
          {
            descricao: "= Custo unitário reequilibrado",
            valor: 1342.57,
            unidade: "BRL",
          },
          {
            descricao: "Diferença unitária mensal",
            valor: 108.01,
            unidade: "BRL",
          },
          {
            descricao: "× meses restantes (18)",
            valor: 1944.18,
            unidade: "BRL",
          },
        ],
        valor_final: 1944.18,
        unidade_final: "BRL",
        sucesso: true,
        placeholder: true,
      },
    ],
    score_confianca: 0.82,
    pontos_a_complementar: [
      {
        descricao:
          "Anexar nota fiscal de aquisição dos insumos para validar o impacto unitário.",
        severidade: "media",
        responsavel: "requerente",
      },
    ],
    gerado_em: agora,
    modelo_auditor: "gemini-3-pro",
    metadata_origem: metadata,
  };
}

/**
 * Mock de parecer formal — devolve algo que valida contra `ParecerSchema`.
 */
function gerarParecerMock(analiseId: string): unknown {
  const agora = new Date().toISOString();
  const id = newPeticaoId();
  return {
    id,
    analise_id: analiseId,
    cabecalho: {
      numero: `PARECER-${id.slice(0, 8).toUpperCase()}/2026`,
      parecerista: "Agente IA Auditor + Redator (Vectorgov_t)",
      orgao: "Procuradoria Jurídica",
      assunto: "Pedido de reequilíbrio econômico-financeiro — contrato administrativo",
      data: agora.slice(0, 10),
    },
    secoes: [
      {
        numero: "I",
        titulo: "Relatório",
        conteudo:
          "Trata-se de pedido de reequilíbrio econômico-financeiro formulado pelo contratado, " +
          "fundamentado em alegação de fato superveniente caracterizado por variação atípica de " +
          "insumos da construção civil. A petição foi protocolizada acompanhada de planilha de " +
          "cálculo e nota técnica do engenheiro responsável.",
      },
      {
        numero: "II",
        titulo: "Fundamentação",
        conteudo:
          "O art. 124, II, alínea 'd', da Lei nº 14.133/2021 admite a alteração contratual por acordo " +
          "para restabelecer o equilíbrio econômico-financeiro em caso de fatos imprevisíveis ou de " +
          "consequências incalculáveis. No caso concreto, restou demonstrado o nexo de causalidade entre " +
          "a variação atípica do INCC e o impacto direto nos insumos, conforme exigido pelo Acórdão TCU " +
          "1.595/2018-Plenário. Contudo, observa-se que o cálculo apresentado pelo requerente utilizou " +
          "o IPCA (índice geral), enquanto o adequado é o índice setorial INCC, gerando distorção a maior.",
      },
      {
        numero: "III",
        titulo: "Conclusão",
        conteudo:
          "Pelo deferimento parcial do pleito, no valor de R$ 1.944,18 (mil novecentos e quarenta e quatro " +
          "reais e dezoito centavos), com fundamento no art. 124, II, 'd', da Lei 14.133/2021, condicionado " +
          "à apresentação de notas fiscais comprobatórias dos insumos no prazo de 15 dias.",
      },
      {
        numero: "IV",
        titulo: "Cálculos e Demonstrativos",
        conteudo:
          "Demonstrativo de recálculo com substituição do índice IPCA pelo INCC, conforme tabela anexa. " +
          "Custo unitário reequilibrado: R$ 1.342,57. Diferença unitária mensal: R$ 108,01. Meses restantes " +
          "de execução: 18. Valor total do reequilíbrio: R$ 1.944,18.",
      },
      {
        numero: "V",
        titulo: "Recomendações",
        conteudo:
          "(1) Lavrar termo aditivo limitado ao valor deferido. (2) Exigir do contratado a apresentação " +
          "de notas fiscais no prazo de 15 dias úteis. (3) Comunicar à área de controle interno para fins " +
          "de transparência ativa. (4) Atualizar a planilha de cronograma físico-financeiro do contrato.",
      },
    ],
    conclusao_objetiva:
      "Pelo deferimento parcial do pleito, no valor de R$ 1.944,18, com fundamento no art. 124, II, 'd', da Lei 14.133/2021.",
    recomendacoes: [
      {
        descricao: "Lavrar termo aditivo limitado ao valor deferido (R$ 1.944,18).",
        prioridade: "alta",
        prazo_dias: 10,
      },
      {
        descricao: "Exigir notas fiscais comprobatórias dos insumos.",
        prioridade: "alta",
        prazo_dias: 15,
      },
      {
        descricao: "Comunicar área de controle interno.",
        prioridade: "media",
        prazo_dias: 30,
      },
    ],
    citacoes: [
      {
        id: "cit-001",
        tipo_fonte: "lei",
        norma: "Lei nº 14.133/2021",
        artigo: "art. 124, II, d",
        texto_literal:
          "Art. 124. Os contratos regidos por esta Lei poderão ser alterados [...] " +
          "d) para restabelecer o equilíbrio econômico-financeiro inicial do contrato [...]",
        hash:
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        status: "APROVADA",
        fonte_url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/L14133.htm",
      },
    ],
    calculos: [],
    gerado_em: agora,
  };
}

/**
 * Roda em background "simulando" o pipeline PEVS por algumas centenas de ms.
 *
 * Em produção real, este avanço de fases viria do `PEVSEngine` com `await`
 * em cada step + `env.CACHE.put` para atualizar o registro.
 *
 * TODO: integrar PEVS engine real.
 */
async function simularPipeline(
  env: Env,
  ctx: ExecutionContext,
  record: PeticaoRecord,
): Promise<void> {
  // Background task — não bloqueia a resposta HTTP.
  ctx.waitUntil(
    (async () => {
      const fases: PeticaoRecord["fase"][] = [
        "PLAN",
        "EXECUTE",
        "ANALYZE",
        "VERIFY",
        "SYNTHESIZE",
      ];
      const pcts = [10, 30, 55, 75, 90];
      for (let i = 0; i < fases.length; i++) {
        // Pequeno delay para que o frontend perceba progressão visual.
        await new Promise((r) => setTimeout(r, 400));
        const updated: PeticaoRecord = {
          ...record,
          fase: fases[i]!,
          progresso_pct: pcts[i]!,
          atualizado_em: new Date().toISOString(),
        };
        await writeRecord(env, updated);
        record = updated;
      }
      const final: PeticaoRecord = {
        ...record,
        fase: "done",
        progresso_pct: 100,
        atualizado_em: new Date().toISOString(),
        analise: gerarAnaliseMock(record.id, record.metadata),
      };
      await writeRecord(env, final);
    })(),
  );
}

/**
 * Handler de `POST /api/peticoes/upload` (multipart/form-data).
 *
 * Campos esperados:
 *  - `pdf`: arquivo (obrigatório, máx 50MB)
 *  - `metadata`: string JSON com dados estruturados da petição (obrigatório)
 *
 * Resposta 202 com `{ id, fase, iniciado_em }`. O cliente faz polling em
 * `GET /api/peticoes/:id` até `fase === "done"`.
 */
export async function handlePeticaoUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return errorResponse(
      `multipart inválido: ${err instanceof Error ? err.message : "erro"}`,
      400,
    );
  }

  const pdfRaw = form.get("pdf");
  if (!(pdfRaw instanceof File)) {
    return errorResponse("Campo 'pdf' ausente ou não é arquivo", 400);
  }
  if (pdfRaw.size === 0) {
    return errorResponse("Arquivo 'pdf' está vazio", 400);
  }
  if (pdfRaw.size > MAX_PDF_BYTES) {
    return errorResponse(
      `Arquivo excede ${MAX_PDF_BYTES} bytes (50MB)`,
      400,
    );
  }

  const metadataRaw = form.get("metadata");
  let metadata: Record<string, unknown> = {};
  if (typeof metadataRaw === "string" && metadataRaw.length > 0) {
    try {
      metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    } catch {
      return errorResponse("Campo 'metadata' deve ser JSON válido", 400);
    }
  }

  // TODO: persistir PDF em R2 (R2_LEIS bucket ou bucket dedicado a petições)
  // antes de disparar o pipeline. Por enquanto descartamos o blob.

  const id = newPeticaoId();
  const agora = new Date().toISOString();
  const record: PeticaoRecord = {
    id,
    fase: "queued",
    progresso_pct: 0,
    iniciado_em: agora,
    atualizado_em: agora,
    metadata: {
      ...metadata,
      pdf_nome: pdfRaw.name,
      pdf_tamanho_bytes: pdfRaw.size,
    },
  };
  await writeRecord(env, record);

  // Dispara o "pipeline" em background.
  await simularPipeline(env, ctx, record);

  return jsonResponse(
    {
      id,
      fase: record.fase,
      iniciado_em: record.iniciado_em,
    },
    202,
  );
}

/**
 * Handler de `GET /api/peticoes/:id`.
 */
export async function handlePeticaoStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").filter(Boolean).pop();
  if (!id) {
    return errorResponse("id da petição obrigatório", 400);
  }

  const record = await readRecord(env, id);
  if (!record) {
    return errorResponse("Petição não encontrada", 404);
  }

  return jsonResponse({
    id: record.id,
    fase: record.fase,
    progresso_pct: record.progresso_pct,
    iniciado_em: record.iniciado_em,
    atualizado_em: record.atualizado_em,
    analise: record.analise,
    erro: record.erro,
  });
}

/**
 * Handler de `POST /api/peticoes/:id/parecer`.
 *
 * Gera e persiste o parecer. Em produção, dispararia o agente Redator
 * via PEVS Engine (Feature 2). Aqui devolve mock sincronicamente.
 */
export async function handleGerarParecer(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  // Esperado: ["api", "peticoes", ":id", "parecer"]
  const id = parts[parts.length - 2];
  if (!id) {
    return errorResponse("id da petição obrigatório", 400);
  }

  const record = await readRecord(env, id);
  if (!record) {
    return errorResponse("Petição não encontrada", 404);
  }
  if (record.fase !== "done" || !record.analise) {
    return errorResponse(
      "Análise ainda não está concluída para gerar parecer",
      409,
    );
  }

  // TODO: integrar PEVSEngine.executarFeature2(...)
  const analise = record.analise as { id: string };
  const parecer = gerarParecerMock(analise.id ?? id);

  const updated: PeticaoRecord = {
    ...record,
    parecer,
    atualizado_em: new Date().toISOString(),
  };
  await writeRecord(env, updated);

  return jsonResponse(parecer, 201);
}

/**
 * Handler de `GET /api/peticoes/:id/parecer`.
 */
export async function handleGetParecer(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 2];
  if (!id) {
    return errorResponse("id da petição obrigatório", 400);
  }

  const record = await readRecord(env, id);
  if (!record) {
    return errorResponse("Petição não encontrada", 404);
  }
  if (!record.parecer) {
    return errorResponse("Parecer ainda não gerado", 404);
  }

  return jsonResponse(record.parecer);
}
