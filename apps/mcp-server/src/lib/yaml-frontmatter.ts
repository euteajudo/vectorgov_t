/**
 * Parser minimalista de YAML front-matter para o subsistema de Skills.
 *
 * Suporta apenas o subset que controlamos no formato das skills do
 * Vectorgov_t (definido em `packages/skills/active/*.md`):
 *
 *   - Documento começa com `---` na primeira linha.
 *   - Termina com `---` ou `...` em linha isolada.
 *   - Chaves no formato `chave: valor` (1 nível raiz).
 *   - Sub-objetos com indentação de 2 espaços (`trigger.palavras_chave`).
 *   - Listas em duas formas:
 *       a) Inline JSON-like: `chave: [a, b, "c d"]`.
 *       b) Block style: `chave:` + linhas `  - item`.
 *   - Strings entre aspas duplas/simples ou bare (sem aspas).
 *   - Números inteiros e booleans literais (`true`/`false`).
 *
 * NÃO suporta YAML completo (âncoras, multilinha `|`, etc.) — por design.
 * Caso uma skill precise de algo mais complexo, o erro é explícito e o
 * autor deve simplificar o front-matter.
 *
 * Por que não usar `js-yaml`?
 *   - O Worker roda no isolate da Cloudflare, e cada KB conta.
 *   - O formato é estritamente nosso — `js-yaml` é overkill.
 *   - Validação real fica no Zod (`SkillMetadata`), não no parser.
 */

/**
 * Erro tipado para falhas de parsing. Carrega `line` para facilitar
 * depuração quando um autor escreve YAML malformado.
 */
export class FrontmatterParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line ? `${message} (linha ${line})` : message);
    this.name = "FrontmatterParseError";
  }
}

/**
 * Resultado do parsing: o objeto bruto do front-matter + o corpo markdown
 * restante (texto após o segundo `---`).
 */
export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Tira aspas simples ou duplas se a string estiver totalmente envolvida.
 * Mantém aspas literais quando a string contém aspas internas válidas.
 */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Coage valores escalares do YAML para JS:
 *   - `true` / `false` → boolean.
 *   - inteiros puros   → number.
 *   - resto            → string (com aspas removidas).
 */
function coerceScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (Number.isSafeInteger(n)) return n;
  }
  return stripQuotes(trimmed);
}

/**
 * Faz parse de uma lista inline (formato JSON-like): `[a, "b c", 3]`.
 *
 * Estratégia simples: divide por vírgulas respeitando aspas, depois
 * coage cada item. Suficiente para o formato das skills.
 */
function parseInlineList(value: string): Array<string | number | boolean> {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new FrontmatterParseError(
      `lista inline inválida (esperado [ ... ]): ${value}`,
    );
  }
  const inside = trimmed.slice(1, -1).trim();
  if (inside.length === 0) return [];
  const items: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let current = "";
  for (const ch of inside) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) items.push(current);
  return items.map((item) => coerceScalar(item));
}

/**
 * Conta a indentação inicial de uma linha (espaços apenas; tabs proibidos).
 */
function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line.charAt(i) === " ") i++;
  if (i < line.length && line.charAt(i) === "\t") {
    throw new FrontmatterParseError(
      "tabs proibidos no front-matter (use espaços)",
    );
  }
  return i;
}

/**
 * Parse principal — separa front-matter do corpo e devolve objeto + body.
 *
 * @param source — conteúdo completo do `.md` (front-matter + corpo).
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  // Normaliza CRLF/CR para LF — autores podem editar no Windows.
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "---") {
    throw new FrontmatterParseError(
      "front-matter ausente: arquivo deve começar com '---'",
    );
  }

  // Localiza fim do front-matter (`---` ou `...` em linha isolada).
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === "---" || ln === "...") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new FrontmatterParseError(
      "front-matter sem fechamento '---' ou '...'",
    );
  }

  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n");

  const data: Record<string, unknown> = {};
  // Pilha de contexto para sub-objetos: cada nível guarda { obj, indent }.
  // Suportamos só 1 nível extra (suficiente para `trigger:`), mas a estrutura
  // generaliza caso evoluamos o formato.
  type StackEntry = { obj: Record<string, unknown>; indent: number };
  const stack: StackEntry[] = [{ obj: data, indent: -1 }];

  // Estado para parsing de lista block-style (linhas `  - item`).
  let listTarget: Array<string | number | boolean> | null = null;
  let listIndent = -1;

  for (let i = 0; i < fmLines.length; i++) {
    const lineNo = i + 2; // +1 pelo `---`, +1 base 1
    const rawLine = fmLines[i];

    // Pula linhas vazias e comentários `#`.
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) {
      // Lista vazia válida termina aqui.
      continue;
    }

    const indent = indentOf(rawLine);
    const content = rawLine.slice(indent);

    // Item de lista block-style: `- valor`.
    if (content.startsWith("- ")) {
      if (listTarget === null || indent !== listIndent) {
        throw new FrontmatterParseError(
          `item de lista sem chave correspondente: ${rawLine}`,
          lineNo,
        );
      }
      const itemValue = coerceScalar(content.slice(2));
      listTarget.push(itemValue);
      continue;
    }

    // Encerra qualquer lista pendente quando aparece chave normal.
    listTarget = null;
    listIndent = -1;

    // Ajusta pilha de contexto baseado em indentação.
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    // Linha deve ser `chave: ...` ou `chave:` (sub-objeto / lista).
    const colonIdx = content.indexOf(":");
    if (colonIdx === -1) {
      throw new FrontmatterParseError(
        `linha sem ':' não é suportada: ${rawLine}`,
        lineNo,
      );
    }
    const key = content.slice(0, colonIdx).trim();
    const rest = content.slice(colonIdx + 1).trim();
    const targetObj = stack[stack.length - 1]!.obj;

    if (rest === "") {
      // Sub-objeto ou lista block. Decide pelo lookahead.
      const next = fmLines[i + 1] ?? "";
      const nextContent = next.trim();
      if (nextContent.startsWith("- ")) {
        // Lista block-style.
        const arr: Array<string | number | boolean> = [];
        targetObj[key] = arr;
        listTarget = arr;
        listIndent = indentOf(next);
      } else {
        // Sub-objeto: cria contexto aninhado.
        const child: Record<string, unknown> = {};
        targetObj[key] = child;
        stack.push({ obj: child, indent });
      }
      continue;
    }

    // Lista inline `[a, b]`.
    if (rest.startsWith("[")) {
      targetObj[key] = parseInlineList(rest);
      continue;
    }

    // Escalar simples.
    targetObj[key] = coerceScalar(rest);
  }

  return { data, body };
}
