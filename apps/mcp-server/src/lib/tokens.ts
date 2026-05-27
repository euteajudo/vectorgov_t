/**
 * Estimativa de contagem de tokens para paginação de respostas.
 *
 * Não embarcamos `tiktoken` (peso WASM ~3MB) — para texto jurídico em PT-BR
 * a heurística "1 token ≈ 4 chars" é estável dentro de ±15% para modelos
 * BPE típicos (GPT-4, Gemini, Claude).
 *
 * Quando a precisão importar (ex.: ajuste fino de prompt), trocar por
 * tiktoken-lite ou pelo tokenizer do próprio modelo alvo.
 */

/**
 * Heurística de tokens — divisão truncada por 4.
 *
 * @param text - texto UTF-8
 * @returns número aproximado de tokens (≥ 0)
 */
export function approxTokenCount(text: string): number {
  if (!text) return 0;
  // length em UTF-16 — para texto latino é praticamente idêntico ao count UTF-8.
  return Math.ceil(text.length / 4);
}

/**
 * Trunca um texto para caber em `maxTokens`, devolvendo o trecho cortado
 * e um cursor (offset em caracteres) para a próxima chamada.
 *
 * Estratégia: corta no caractere ~maxTokens*4, mas tenta voltar até um
 * separador "limpo" (`\n`, `. `, `; `) para não cortar palavra no meio.
 */
export function truncateForTokens(
  text: string,
  maxTokens: number,
  cursor: number,
): { trecho: string; proximoCursor: number | null; truncado: boolean } {
  if (cursor >= text.length) {
    return { trecho: "", proximoCursor: null, truncado: false };
  }
  const targetChars = maxTokens * 4;
  const restante = text.slice(cursor);
  if (approxTokenCount(restante) <= maxTokens) {
    return { trecho: restante, proximoCursor: null, truncado: false };
  }
  // Tenta cortar no separador mais recente antes do limite.
  let cortePref = targetChars;
  const separadores = ["\n\n", "\n", ". ", "; ", ", "];
  for (const sep of separadores) {
    const idx = restante.lastIndexOf(sep, targetChars);
    if (idx > targetChars * 0.6) {
      cortePref = idx + sep.length;
      break;
    }
  }
  const trecho = restante.slice(0, cortePref);
  return {
    trecho,
    proximoCursor: cursor + cortePref,
    truncado: true,
  };
}
