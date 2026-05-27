/**
 * Schemas Zod para validação de entrada dos endpoints REST do Worker MCP.
 *
 * Centraliza todos os schemas usados em `peticoes.ts`, `historico.ts`,
 * `skills.ts` — facilita manutenção e garante mensagens de erro consistentes.
 *
 * Resolve o follow-up P0 #53 levantado pelo Reviewer-Frontend da Track H:
 * "endpoints REST sem validação Zod, mesmo tendo `@vectorgov-t/schemas`
 * disponível e o brief pedindo explicitamente 'valida contra ParecerSchema'."
 */
import { z } from "zod";
import { errorResponse } from "../lib/responses.js";

// ============================================================================
// PETIÇÕES — POST /api/peticoes/upload
// ============================================================================

/**
 * Metadata da petição enviada via multipart (campo `metadata` como JSON string).
 *
 * Todos os campos são opcionais para permitir uploads exploratórios, mas
 * quando presentes precisam ser strings/números válidos.
 */
export const PeticaoUploadMetadataSchema = z
  .object({
    contrato_numero: z.string().trim().min(1).max(200).optional(),
    contratante: z.string().trim().min(1).max(500).optional(),
    contratado: z.string().trim().min(1).max(500).optional(),
    contratante_cnpj: z
      .string()
      .trim()
      .regex(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, {
        message: "CNPJ inválido (use 14 dígitos ou XX.XXX.XXX/XXXX-XX)",
      })
      .optional(),
    contratado_cnpj: z
      .string()
      .trim()
      .regex(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, {
        message: "CNPJ inválido (use 14 dígitos ou XX.XXX.XXX/XXXX-XX)",
      })
      .optional(),
    data_protocolo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: "data_protocolo deve ser YYYY-MM-DD",
      })
      .optional(),
    valor_pleiteado_centavos: z.number().int().nonnegative().optional(),
    observacoes: z.string().max(5000).optional(),

    // Campos necessários pra o PEVS engine real. Opcionais no schema mas
    // o handler exige todos quando dispara o pipeline real.
    requerente: z.string().trim().min(1).max(300).optional(),
    objeto: z.string().trim().min(1).max(1000).optional(),
    modalidade: z
      .enum([
        "pregao_eletronico",
        "pregao_presencial",
        "concorrencia",
        "dispensa",
        "inexigibilidade",
        "concurso",
        "leilao",
        "dialogo_competitivo",
        "outro",
      ])
      .optional(),
    valor_contrato_centavos: z.number().int().nonnegative().optional(),
    data_assinatura: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: "data_assinatura deve ser YYYY-MM-DD",
      })
      .optional(),
    fato_alegado: z
      .string()
      .trim()
      .min(50, "fato_alegado precisa de pelo menos 50 caracteres")
      .max(20_000)
      .optional(),
    base_legal_invocada: z.array(z.string().min(1).max(500)).optional(),
  })
  .passthrough(); // permite campos extras sem rejeitar

export type PeticaoUploadMetadata = z.infer<typeof PeticaoUploadMetadataSchema>;

// ============================================================================
// HISTÓRICO — GET /api/historico
// ============================================================================

export const HistoricoQuerySchema = z.object({
  contratante: z.string().trim().min(1).max(200).optional(),
  contratado: z.string().trim().min(1).max(200).optional(),
  veredito: z
    .enum([
      "procedente",
      "parcialmente_procedente",
      "improcedente",
      "inconclusiva",
    ])
    .optional(),
  data_inicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "data_inicio deve ser YYYY-MM-DD",
    })
    .optional(),
  data_fim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "data_fim deve ser YYYY-MM-DD" })
    .optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
});

export type HistoricoQuery = z.infer<typeof HistoricoQuerySchema>;

/**
 * Helper: extrai e valida query params da URL.
 *
 * Retorna `{ ok: true, data }` ou `{ ok: false, response }` — caller faz
 * early return com a response 400 quando inválido.
 */
export function parseHistoricoQuery(
  url: URL,
):
  | { ok: true; data: HistoricoQuery }
  | { ok: false; response: Response } {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    raw[k] = v;
  }
  const parsed = HistoricoQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        `Query params inválidos: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ")}`,
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

// ============================================================================
// SKILLS — POST /api/skills/:nome/publicar
// ============================================================================

/**
 * Validação mínima de markdown com YAML front-matter.
 *
 * Não fazemos parsing completo aqui (isso seria responsabilidade da tool
 * `skill_publicar` real via `yaml-frontmatter.ts`), apenas garantimos:
 *   - tamanho mínimo razoável (50 chars)
 *   - presença de front-matter delimitado (`---` no início)
 *   - campo `nome:` presente (sanity)
 */
const FRONT_MATTER_REGEX = /^---\s*\n[\s\S]*?\nnome:\s*\S/;

export const SkillPublicarInputSchema = z.object({
  conteudo_markdown: z
    .string()
    .min(50, { message: "conteudo_markdown deve ter ao menos 50 caracteres" })
    .max(60_000, { message: "conteudo_markdown excede 60.000 caracteres" })
    .refine((s) => FRONT_MATTER_REGEX.test(s), {
      message:
        "conteudo_markdown deve começar com YAML front-matter (--- ... ---) contendo o campo 'nome:'",
    }),
  promover: z.boolean().default(false),
  descricao_versao: z.string().trim().max(500).optional(),
});

export type SkillPublicarInput = z.infer<typeof SkillPublicarInputSchema>;

// ============================================================================
// PETIÇÃO ID — usado por todas as rotas com :id
// ============================================================================

/**
 * Schema para o ID da petição na URL. Aceita UUID v4 ou string segura.
 * Bloqueia path traversal e caracteres especiais.
 */
export const PeticaoIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, {
    message: "id deve conter apenas letras, números, hífens e underscores",
  });

export function validatePeticaoId(
  id: string | undefined,
):
  | { ok: true; data: string }
  | { ok: false; response: Response } {
  const parsed = PeticaoIdSchema.safeParse(id);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        `id da petição inválido: ${parsed.error.issues[0]?.message ?? "formato inválido"}`,
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Schema do nome de skill na URL.
 */
export const SkillNomeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, {
    message:
      "nome da skill deve usar apenas letras minúsculas, números e hífen (kebab-case)",
  });

export function validateSkillNome(
  nome: string | undefined,
):
  | { ok: true; data: string }
  | { ok: false; response: Response } {
  const parsed = SkillNomeSchema.safeParse(nome);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        `nome da skill inválido: ${parsed.error.issues[0]?.message ?? "formato inválido"}`,
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

// ============================================================================
// Helper genérico — formata erro Zod em response 400
// ============================================================================

export function zodErrorResponse(
  err: z.ZodError,
  contexto = "Entrada inválida",
): Response {
  const detalhes = err.issues
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  return errorResponse(`${contexto}: ${detalhes}`, 400);
}
