/**
 * Helpers de segurança HTTP — CORS, security headers e wrapper de Response.
 *
 * Os headers aqui aplicados são o mínimo defensável para um endpoint MCP
 * público: bloquear iframing, evitar sniff de MIME, restringir CSP, e
 * abrir CORS apenas para verbos necessários (`POST`, `GET`, `OPTIONS`).
 */

/**
 * Headers CORS aplicados em todas as respostas e no preflight (OPTIONS).
 *
 * Mantemos `Access-Control-Allow-Origin: *` porque o MCP é consumido por
 * agentes externos via JSON-RPC sem cookies. Caso evolua para autenticado,
 * trocar pelo `Origin` ecoado + `Vary: Origin`.
 */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    // `X-Google-API-Key` é usado pelos handlers de chat/petição/parecer
    // pra receber a API key do browser sem persistir no servidor.
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, X-Google-API-Key",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Headers de segurança aplicados em todas as respostas.
 *
 * CSP `default-src 'none'` é seguro porque o Worker só serve JSON/texto:
 * nenhum recurso embedável é necessário. Caso passemos a servir HTML,
 * relaxar para `'self'` e `script-src` específico.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  };
}

/**
 * Devolve uma nova Response com os headers de segurança e CORS aplicados.
 *
 * Importante: não muta a Response recebida — clona os headers para
 * preservar imutabilidade esperada pelo runtime do Workers.
 */
export function withSecurity(response: Response): Response {
  // Responses de WebSocket upgrade carregam o handle em `response.webSocket`.
  // Recriar a Response descarta esse handle e quebra o status 101.
  if (
    response.status === 101 ||
    (response as Response & { webSocket?: WebSocket }).webSocket
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(securityHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
