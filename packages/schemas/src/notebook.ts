/**
 * Schemas Zod do recurso Notebook — chat com documento estilo NotebookLM.
 *
 * Um Notebook = 1 PDF anexado + N mensagens de conversa. Persistência fica
 * num Durable Object por notebook (apps/mcp-server/src/agents/notebook-agent.ts).
 *
 * Os schemas aqui descrevem o que sai do Worker pra UI (REST + WebSocket
 * events). Estado interno do DO pode armazenar mais campos (ex.: embeddings
 * em BLOB) que não são serializados ao cliente.
 */
import { z } from "zod";

/**
 * Metadados de um notebook (sem conteúdo do documento ou histórico).
 *
 * Usado em GET /api/notebooks (listagem) e GET /api/notebooks/:id (detail).
 */
export const NotebookMetaSchema = z.object({
  id: z.string().uuid(),
  titulo: z.string().min(1).max(200),
  documento_nome: z.string().nullable(),
  documento_total_paginas: z.number().int().nonnegative().nullable(),
  documento_total_chars: z.number().int().nonnegative().nullable(),
  criado_em: z.number().int().positive(),
  atualizado_em: z.number().int().positive(),
});
export type NotebookMeta = z.infer<typeof NotebookMetaSchema>;

/**
 * Uma chamada de tool feita pelo orquestrador durante uma turn de
 * resposta. Persistida junto da mensagem assistant para a UI mostrar
 * o "thinking trace" estilo Claude.
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  nome: z.string(),
  args: z.unknown(),
  resultado: z.unknown().nullable(),
  erro: z.string().nullable(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Uma mensagem na conversa do notebook.
 *
 * Roles:
 *  - `user`: pergunta digitada pelo humano.
 *  - `assistant`: resposta do orquestrador (texto final, depois de tool calls).
 *  - `system`: mensagens internas (raras, ex.: confirmação de upload).
 */
export const MensagemSchema = z.object({
  id: z.string().uuid(),
  notebook_id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  tool_calls: z.array(ToolCallSchema).default([]),
  modelo: z.string().nullable(),
  tokens_total: z.number().int().nonnegative().nullable(),
  criado_em: z.number().int().positive(),
});
export type Mensagem = z.infer<typeof MensagemSchema>;

/**
 * Payload de criação de notebook (POST /api/notebooks).
 * Vazio inicialmente — o documento é anexado em um segundo passo.
 */
export const CriarNotebookInputSchema = z.object({
  titulo: z.string().min(1).max(200).optional(),
});
export type CriarNotebookInput = z.infer<typeof CriarNotebookInputSchema>;

/**
 * Resposta do upload de documento (POST /api/notebooks/:id/upload).
 */
export const UploadDocumentoOutputSchema = z.object({
  notebook_id: z.string().uuid(),
  documento_nome: z.string(),
  total_paginas: z.number().int().nonnegative(),
  total_chars: z.number().int().nonnegative(),
  pdf_hash: z.string(),
});
export type UploadDocumentoOutput = z.infer<typeof UploadDocumentoOutputSchema>;

/**
 * Eventos enviados do servidor pro cliente via WebSocket durante o stream
 * de uma resposta. Cliente parseia e atualiza UI a cada evento.
 */
export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("token"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    call_id: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    call_id: z.string(),
    name: z.string(),
    result: z.unknown(),
    is_error: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    message_id: z.string().uuid(),
    tokens: z.number().int().nonnegative(),
    finish_reason: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/**
 * Eventos enviados do cliente pro servidor.
 */
export const ChatClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    text: z.string().min(1).max(8000),
  }),
  z.object({
    type: z.literal("abort"),
  }),
]);
export type ChatClientEvent = z.infer<typeof ChatClientEventSchema>;
