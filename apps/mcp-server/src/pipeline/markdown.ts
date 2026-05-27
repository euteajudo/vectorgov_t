/**
 * Geração do `.md` por dispositivo, com YAML front-matter para indexação.
 *
 * Cada dispositivo gera um arquivo:
 *   `<lei_id>/dispositivos/livro-X/.../art-NNN[-p-Y][-i-III][-a-a].md`
 *
 * O caminho usa o `hierarquia_path` para reconstruir a estrutura
 * (livro, título, capítulo). Quando o parser não devolve hierarquia,
 * caímos em `dispositivos/sem-hierarquia/<id>.md`.
 *
 * Mantemos as funções puras (sem side-effect de R2) para facilitar teste.
 */

import type { DispositivoChunk, NormaMetadata } from "@vectorgov-t/schemas";

/**
 * Caracteres não permitidos em chaves R2 / paths POSIX.
 * Substitui por hífen e remove duplicatas.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Pad numérico com 3 dígitos (art-009, art-473).
 *
 * Mantemos 3 dígitos porque a maior lei catalogada (LC 214) tem ~600 artigos
 * — se ultrapassar 999, mudamos para 4 dígitos sem quebrar nada (paths novos
 * convivem com paths antigos no R2).
 */
function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/**
 * Converte `hierarquia_path` ("Livro I -> Título II -> Capítulo III -> Art. 473")
 * em segmentos de caminho slugificados, descartando o último elemento (que é
 * o próprio dispositivo — será reconstruído pelo nome do arquivo).
 *
 * Retorna `[]` se não houver hierarquia confiável.
 */
function hierarquiaToSegments(hierarquia: string): string[] {
  if (typeof hierarquia !== "string" || hierarquia.trim().length === 0) {
    return [];
  }
  const parts = hierarquia
    .split(/->|→|>/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return [];
  // Descarta o último (Art. NNN, § X, etc.) — o arquivo já carrega esse nome.
  const sansLast = parts.slice(0, -1);
  return sansLast.map(slugify).filter((s) => s.length > 0);
}

/**
 * Monta o sufixo de nome de arquivo a partir dos identificadores do dispositivo.
 *
 * Exemplos:
 *   tipo=artigo, artigo=473 → "art-473"
 *   tipo=paragrafo, artigo=473, paragrafo="1" → "art-473-p-1"
 *   tipo=paragrafo, artigo=473, paragrafo="unico" → "art-473-p-unico"
 *   tipo=inciso, artigo=473, inciso="II" → "art-473-i-ii"
 *   tipo=alinea, artigo=473, inciso="II", alinea="a" → "art-473-i-ii-a-a"
 *   sem artigo (ex.: anexo) → fallback usa o `dispositivo.id`.
 */
function buildFilename(d: DispositivoChunk): string {
  if (d.artigo === null || d.artigo === undefined) {
    // Sem artigo (ex.: anexo) — usa o ID sanitizado como fallback.
    return `${slugify(d.id)}.md`;
  }
  const parts: string[] = [`art-${pad3(d.artigo)}`];
  if (d.paragrafo) parts.push(`p-${slugify(d.paragrafo)}`);
  if (d.inciso) parts.push(`i-${slugify(d.inciso)}`);
  if (d.alinea) parts.push(`a-${slugify(d.alinea)}`);
  return `${parts.join("-")}.md`;
}

/**
 * Constrói a chave R2 completa para um dispositivo.
 *
 * Formato: `<lei_id>/dispositivos/<segmento1>/<segmento2>/.../<filename>.md`.
 * Sem hierarquia: `<lei_id>/dispositivos/sem-hierarquia/<filename>.md`.
 */
export function dispositivoR2Key(
  leiId: string,
  dispositivo: DispositivoChunk,
): string {
  const segments = hierarquiaToSegments(dispositivo.hierarquia_path);
  const filename = buildFilename(dispositivo);
  const middle = segments.length > 0 ? segments.join("/") : "sem-hierarquia";
  return `${leiId}/dispositivos/${middle}/${filename}`;
}

/**
 * Escapa caracteres YAML mínimos para o front-matter (aspas duplas
 * + escape de aspa/quebra-de-linha). Usa string aspeada — suficiente
 * para valores curtos como hierarquia.
 */
function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/**
 * Gera o conteúdo markdown completo com YAML front-matter + corpo.
 *
 * O front-matter inclui campos mínimos para retrieval downstream:
 * `id`, `norma_id`, `norma_tipo`, `tipo_dispositivo`, `artigo`, `paragrafo`,
 * `inciso`, `alinea`, `hierarquia`, `page_number`, `citations`,
 * `canonical_start`, `canonical_end`.
 */
export function renderDispositivoMd(
  norma: NormaMetadata,
  dispositivo: DispositivoChunk,
): string {
  const fm: string[] = ["---"];
  fm.push(`id: ${yamlEscape(dispositivo.id)}`);
  fm.push(`norma_id: ${yamlEscape(dispositivo.norma_id)}`);
  fm.push(`norma_tipo: ${yamlEscape(norma.tipo)}`);
  fm.push(`norma_numero: ${yamlEscape(norma.numero)}`);
  fm.push(`norma_ano: ${norma.ano}`);
  fm.push(`tipo_dispositivo: ${yamlEscape(dispositivo.tipo_dispositivo)}`);
  if (dispositivo.artigo !== null && dispositivo.artigo !== undefined) {
    fm.push(`artigo: ${dispositivo.artigo}`);
  }
  if (dispositivo.paragrafo) fm.push(`paragrafo: ${yamlEscape(dispositivo.paragrafo)}`);
  if (dispositivo.inciso) fm.push(`inciso: ${yamlEscape(dispositivo.inciso)}`);
  if (dispositivo.alinea) fm.push(`alinea: ${yamlEscape(dispositivo.alinea)}`);
  fm.push(`hierarquia: ${yamlEscape(dispositivo.hierarquia_path)}`);
  if (dispositivo.page_number !== null && dispositivo.page_number !== undefined) {
    fm.push(`page_number: ${dispositivo.page_number}`);
  }
  fm.push(`canonical_start: ${dispositivo.canonical_start}`);
  fm.push(`canonical_end: ${dispositivo.canonical_end}`);
  if (dispositivo.citations && dispositivo.citations.length > 0) {
    fm.push("citations:");
    for (const c of dispositivo.citations) {
      fm.push(`  - ${yamlEscape(c)}`);
    }
  }
  fm.push("---");
  fm.push("");
  fm.push(dispositivo.texto);
  fm.push("");
  return fm.join("\n");
}

/**
 * Constrói o caminho do _meta.json da norma.
 */
export function normaMetaR2Key(leiId: string): string {
  return `${leiId}/_meta.json`;
}

/**
 * Constrói o caminho do _sumario.json da norma.
 */
export function normaSumarioR2Key(leiId: string): string {
  return `${leiId}/_sumario.json`;
}

/**
 * Constrói o caminho do _index.json global de normas.
 *
 * O índice fica na raiz do bucket porque é consultado pelo
 * `fs_listar_estrutura` sem saber qual norma listar primeiro.
 */
export function indiceGlobalR2Key(): string {
  return `_index.json`;
}
