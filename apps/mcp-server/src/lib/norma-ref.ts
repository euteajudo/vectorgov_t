/**
 * Resolução de referências normativas legíveis → identificadores canônicos.
 *
 * O sistema tem duas representações de uma norma:
 *   - Legível: "Lei nº 14.133/2021", "LC 214/2025" — como aparece em petições
 *     e na fala dos agentes LLM.
 *   - Canônica (`norma_id`): slug "lei-14133-2021", "lc-214-2025" — como o D1 /
 *     R2 indexam (ver `lib/citation.ts`).
 *
 * As tools MCP (`fs_ler_dispositivo`, `consultar_artigo`) exigem `norma_id` +
 * `artigo` numérico. Estes helpers fazem a ponte. NÃO há tabela de lookup
 * reverso no banco — `slugificarNorma` é heurístico e `resolverNormaId`
 * valida contra o catálogo real via `fs_listar_normas`.
 */

/** Interface mínima de uma tool (evita acoplar lib/ a agents/types). */
interface ToolInvocavel {
  nome: string;
  executar(args: Record<string, unknown>): Promise<unknown>;
}

/** Tipo de norma → prefixo do slug. */
const PREFIXO_POR_TIPO: Array<{ re: RegExp; prefixo: string }> = [
  // Ordem importa: "lei complementar" antes de "lei".
  { re: /lei\s+complementar|^lc\b|\blc\s/i, prefixo: "lc" },
  { re: /emenda\s+constitucional|^ec\b|\bec\s/i, prefixo: "ec" },
  { re: /instru[çc][ãa]o\s+normativa|^in\b|\bin\s/i, prefixo: "instrucao-normativa" },
  { re: /decreto/i, prefixo: "decreto" },
  { re: /constitui[çc][ãa]o/i, prefixo: "constituicao" },
  { re: /\blei\b/i, prefixo: "lei" },
];

/**
 * Heurística: converte um nome legível em slug canônico `{tipo}-{numero}-{ano}`.
 *
 * Retorna `null` quando não consegue extrair número+ano (ex.: "Constituição
 * Federal" sem número — caso tratado à parte por quem chama, se necessário).
 *
 * Exemplos:
 *   "Lei nº 14.133/2021"          → "lei-14133-2021"
 *   "Lei 14.133, de 2021"         → "lei-14133-2021"
 *   "LC 214/2025"                 → "lc-214-2025"
 *   "Lei Complementar nº 214/2025"→ "lc-214-2025"
 *   "Decreto 12.955/2026"         → "decreto-12955-2026"
 */
export function slugificarNorma(nomeLegivel: string): string | null {
  const tipoMatch = PREFIXO_POR_TIPO.find((t) => t.re.test(nomeLegivel));
  if (!tipoMatch) return null;

  // Número: primeiro grupo de dígitos (com pontos opcionais) — remove os pontos.
  const numMatch = nomeLegivel.match(/(\d{1,3}(?:\.\d{3})*|\d+)/);
  if (!numMatch) return null;
  const numero = numMatch[1]!.replace(/\./g, "");

  // Ano: grupo de 4 dígitos (após "/", "de" ou isolado).
  const anoMatch = nomeLegivel.match(/\b(19|20)\d{2}\b/);
  if (!anoMatch) return null;
  const ano = anoMatch[0];

  // Evita confundir número == ano (ex.: "Decreto 2021/2021" é raro mas válido).
  return `${tipoMatch.prefixo}-${numero}-${ano}`;
}

interface NormaCatalogo {
  norma_id: string;
}

/**
 * Resolve `norma_id` confirmado contra o catálogo real (`fs_listar_normas`).
 *
 * Estratégia:
 *   1. Gera slug heurístico via `slugificarNorma`.
 *   2. Lista as normas existentes.
 *   3. Retorna o id se houver match exato; senão tenta casar por sufixo
 *      `numero-ano` (cobre variação de prefixo de tipo).
 *   4. `null` se nada bater — o chamador (Auditor) trata como REJEITADA segura.
 *
 * Se a tool `fs_listar_normas` não estiver disponível, cai para o slug
 * heurístico puro (melhor esforço).
 */
export async function resolverNormaId(
  nomeLegivel: string,
  tools: ToolInvocavel[],
): Promise<string | null> {
  const slug = slugificarNorma(nomeLegivel);

  const toolListar = tools.find((t) => t.nome === "fs_listar_normas");
  if (!toolListar) return slug;

  let catalogo: NormaCatalogo[] = [];
  try {
    const resp = (await toolListar.executar({})) as
      | { normas?: NormaCatalogo[] }
      | undefined;
    catalogo = resp?.normas ?? [];
  } catch {
    return slug;
  }

  if (catalogo.length === 0) return slug;

  if (slug && catalogo.some((n) => n.norma_id === slug)) return slug;

  // Fallback: casa por sufixo numero-ano (ignora divergência de prefixo).
  if (slug) {
    const sufixo = slug.split("-").slice(1).join("-"); // "14133-2021"
    const porSufixo = catalogo.find((n) => n.norma_id.endsWith(sufixo));
    if (porSufixo) return porSufixo.norma_id;
  }

  return null;
}

export interface ArtigoRef {
  artigo: number;
  paragrafo?: number | string;
  inciso?: string;
  alinea?: string;
}

/**
 * Parseia um identificador legível de dispositivo em referência estruturada.
 *
 * Exemplos:
 *   "art. 124"            → { artigo: 124 }
 *   "art. 124, § 1º, II"  → { artigo: 124, paragrafo: 1, inciso: "II" }
 *   "Art 5º, §3, IV, b"   → { artigo: 5, paragrafo: 3, inciso: "IV", alinea: "b" }
 *   "caput do art. 9"     → { artigo: 9 }
 *
 * Retorna `null` quando não encontra um número de artigo (ex.: "Acórdão
 * 1234/2023-Plenário" — jurisprudência, fora do escopo de fs_ler_dispositivo).
 */
export function parseArtigoRef(ref: string): ArtigoRef | null {
  const artMatch = ref.match(/art(?:igo|\.)?\s*(\d+)/i);
  if (!artMatch) return null;
  const artigo = Number(artMatch[1]);
  if (!Number.isInteger(artigo) || artigo < 1) return null;

  const out: ArtigoRef = { artigo };

  const parMatch = ref.match(/§\s*(\d+)|par[áa]grafo\s+(\d+)/i);
  if (parMatch) {
    out.paragrafo = Number(parMatch[1] ?? parMatch[2]);
  } else if (/par[áa]grafo\s+[úu]nico/i.test(ref)) {
    out.paragrafo = "unico";
  }

  // Inciso: romano após § ou após vírgula (I, II, III, IV, V...).
  const incMatch = ref.match(/\b([IVXLCDM]{1,7})\b/);
  if (incMatch) out.inciso = incMatch[1]!.toUpperCase();

  // Alínea: letra minúscula isolada (", b" ou "alínea b").
  const alMatch = ref.match(/al[íi]nea\s+([a-z])\b|,\s*([a-z])\b\s*$/i);
  if (alMatch) out.alinea = (alMatch[1] ?? alMatch[2])!.toLowerCase();

  return out;
}
