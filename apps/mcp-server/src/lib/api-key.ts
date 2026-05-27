/**
 * Helpers para extrair a GOOGLE_API_KEY de requests HTTP/WS.
 *
 * A key vem SEMPRE do cliente — nunca persistida no servidor. Caminhos:
 *
 *  1. HTTP REST: header `X-Google-API-Key: <key>`.
 *  2. WebSocket upgrade: `Sec-WebSocket-Protocol: vectorgov-key.<key>, ...`.
 *     Browsers só permitem passar info "no-canal" pro WS via subprotocol;
 *     usamos o prefixo `vectorgov-key.` pra distinguir de outros protocols.
 *
 * Em ambos os casos, falta da key é erro `MissingApiKeyError` que o caller
 * traduz pra 401 com mensagem amigável.
 */

const WS_PROTOCOL_PREFIX = "vectorgov-key.";

/**
 * Extrai a API key de um request HTTP comum.
 * Retorna `null` se ausente (caller decide se isso é erro).
 */
export function extractApiKey(request: Request): string | null {
  const raw = request.headers.get("X-Google-API-Key");
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extrai a API key de um request de WebSocket upgrade — lê
 * `Sec-WebSocket-Protocol` e busca o item que começa com `vectorgov-key.`.
 *
 * Browsers chamam `new WebSocket(url, [\`vectorgov-key.\${key}\`])`. O header
 * resultante pode ter múltiplos protocols separados por vírgula.
 */
export function extractApiKeyFromWS(request: Request): string | null {
  const raw = request.headers.get("Sec-WebSocket-Protocol") || "";
  const parts = raw.split(/[\s,]+/).filter((p) => p.length > 0);
  const found = parts.find((p) => p.startsWith(WS_PROTOCOL_PREFIX));
  if (!found) return null;
  const key = found.slice(WS_PROTOCOL_PREFIX.length);
  return key.length > 0 ? key : null;
}

/**
 * Echo do subprotocol pra resposta 101 — browsers exigem que o servidor
 * confirme um dos protocols pedidos. Devolvemos a string LITERAL recebida
 * (incluindo a key) porque é exatamente isso que o browser espera.
 *
 * Isso ECOA a key na resposta. Como a conexão é WSS (TLS), o valor não
 * aparece em wire externamente. Mas pode aparecer em logs de proxy/
 * inspeção local — aceitável para demo.
 */
export function findKeySubprotocol(request: Request): string | null {
  const raw = request.headers.get("Sec-WebSocket-Protocol") || "";
  const parts = raw.split(/[\s,]+/).filter((p) => p.length > 0);
  return parts.find((p) => p.startsWith(WS_PROTOCOL_PREFIX)) ?? null;
}

/**
 * Erro disparado quando a key não chega — handlers traduzem pra 401.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "GOOGLE_API_KEY ausente — configure em /admin/config no UI primeiro",
    );
    this.name = "MissingApiKeyError";
  }
}
