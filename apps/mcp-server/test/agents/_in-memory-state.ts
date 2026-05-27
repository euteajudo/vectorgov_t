/**
 * Implementação em memória de `SessionAgentState` (storage SQL + KV).
 *
 * Não pretende ser um motor SQL completo — apenas o suficiente para
 * os métodos do `SessionAgent` rodarem em testes Node sem o runtime
 * do Workers. Cobre:
 *
 *   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS (no-op)
 *   - INSERT OR REPLACE INTO ...
 *   - INSERT INTO ...
 *   - SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ...
 *   - LEFT JOIN (apenas o caso do `listarHistorico`)
 *
 * Se ampliarmos o uso de SQL no SessionAgent, evoluir esse shim
 * (ou trocar por `better-sqlite3` em testes).
 */
import type { StorageKV, StorageSQL, SessionAgentState } from "../../src/agents/session-agent.js";

interface Tabela {
  colunas: string[];
  /**
   * Mapa por chave primária (primeira coluna declarada como PK ou
   * `id` quando explícita). Cada valor é o registro completo.
   */
  registros: Map<string, Record<string, unknown>>;
  /** Ordem de inserção — útil para ORDER BY estável. */
  ordem: string[];
}

interface DBMemoria {
  tabelas: Map<string, Tabela>;
}

/**
 * Cria um estado em memória para `SessionAgent`.
 */
export function createInMemoryState(): SessionAgentState & {
  /** Para inspecionar o storage diretamente em testes. */
  _db: DBMemoria;
  _kv: Map<string, unknown>;
} {
  const db: DBMemoria = { tabelas: new Map() };
  const kvStore = new Map<string, unknown>();

  const kv: StorageKV = {
    async get<T>(key: string): Promise<T | undefined> {
      return kvStore.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      kvStore.set(key, value);
    },
  };

  const sql: StorageSQL = {
    exec(query: string, ...bindings: unknown[]) {
      return execShim(db, query, bindings);
    },
  };

  return {
    storage: Object.assign(kv, { sql }) as StorageKV & { sql: StorageSQL },
    _db: db,
    _kv: kvStore,
  };
}

/**
 * Parser/executor SQL super-simplificado.
 *
 * Heurísticas para parsing — robustas o suficiente para os queries
 * literais que o SessionAgent emite. NÃO use em produção.
 */
function execShim(
  db: DBMemoria,
  rawQuery: string,
  bindings: unknown[],
): { toArray(): Array<Record<string, unknown>>; rowsWritten?: number } {
  const query = rawQuery.replace(/\s+/g, " ").trim();
  const upper = query.toUpperCase();

  if (upper.startsWith("CREATE TABLE")) {
    handleCreateTable(db, query);
    return { toArray: () => [], rowsWritten: 0 };
  }

  if (upper.startsWith("CREATE INDEX")) {
    // no-op no shim
    return { toArray: () => [], rowsWritten: 0 };
  }

  if (upper.startsWith("INSERT OR REPLACE INTO") || upper.startsWith("INSERT INTO")) {
    const rows = handleInsert(db, query, bindings);
    return { toArray: () => [], rowsWritten: rows };
  }

  if (upper.startsWith("SELECT")) {
    const result = handleSelect(db, query, bindings);
    return { toArray: () => result };
  }

  throw new Error(`InMemoryState: query não suportada pelo shim: ${rawQuery}`);
}

function handleCreateTable(db: DBMemoria, query: string): void {
  // Padrão: CREATE TABLE IF NOT EXISTS nome ( ... )
  const match = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([A-Za-z0-9_]+)\s*\((.+)\)\s*;?$/i.exec(
    query,
  );
  if (!match) throw new Error(`CREATE TABLE não parseável: ${query}`);
  const nome = match[1]!;
  const colsRaw = match[2]!;
  if (db.tabelas.has(nome)) return;
  const colunas = colsRaw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => !c.toUpperCase().startsWith("FOREIGN KEY"))
    .map((c) => c.split(/\s+/)[0]!)
    .filter(Boolean);
  db.tabelas.set(nome, {
    colunas,
    registros: new Map(),
    ordem: [],
  });
}

function handleInsert(
  db: DBMemoria,
  query: string,
  bindings: unknown[],
): number {
  // Padrão: INSERT [OR REPLACE] INTO nome (col, col, col) VALUES (?, ?, ?)
  const match =
    /INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(
      query,
    );
  if (!match) throw new Error(`INSERT não parseável: ${query}`);
  const nomeTabela = match[1]!;
  const colunas = match[2]!.split(",").map((c) => c.trim());
  const valores = match[3]!.split(",").map((v) => v.trim());
  const tabela = db.tabelas.get(nomeTabela);
  if (!tabela) throw new Error(`tabela inexistente: ${nomeTabela}`);
  if (colunas.length !== valores.length) {
    throw new Error("nº de colunas != nº de valores em INSERT");
  }
  const registro: Record<string, unknown> = {};
  let bindIdx = 0;
  for (let i = 0; i < colunas.length; i++) {
    const v = valores[i]!;
    if (v === "?") {
      registro[colunas[i]!] = bindings[bindIdx++];
    } else if (/^\d+$/.test(v)) {
      registro[colunas[i]!] = Number(v);
    } else if (/^'.*'$/.test(v)) {
      registro[colunas[i]!] = v.slice(1, -1);
    } else if (v.toUpperCase() === "NULL") {
      registro[colunas[i]!] = null;
    } else {
      throw new Error(`valor não suportado em INSERT: ${v}`);
    }
  }
  // Primeira coluna do CREATE TABLE é considerada PK no nosso schema.
  const pkCol = tabela.colunas[0]!;
  const pk = String(registro[pkCol] ?? "");
  if (!pk) throw new Error(`PK ausente em INSERT na tabela ${nomeTabela}`);
  if (!tabela.registros.has(pk)) tabela.ordem.push(pk);
  tabela.registros.set(pk, registro);
  return 1;
}

interface SelectAST {
  cols: Array<{ tabelaAlias?: string; coluna: string; alias?: string }>;
  fromTabela: string;
  fromAlias?: string;
  joinTabela?: string;
  joinAlias?: string;
  joinCondLeft?: { alias: string; col: string };
  joinCondRight?: { alias: string; col: string };
  where?: { coluna: string; op: string; placeholder: boolean };
  orderBy?: { coluna: string; dir: "ASC" | "DESC" };
  limit?: number;
}

function handleSelect(
  db: DBMemoria,
  query: string,
  bindings: unknown[],
): Array<Record<string, unknown>> {
  const ast = parseSelect(query);
  const tabela = db.tabelas.get(ast.fromTabela);
  if (!tabela) throw new Error(`SELECT em tabela inexistente: ${ast.fromTabela}`);

  // 1. Materializa linhas-base na ordem de inserção
  let linhas: Array<Record<string, unknown>> = ast.ordem
    ? // (placeholder; ordem real vem do array `tabela.ordem`)
      []
    : [];
  linhas = tabela.ordem.map((pk) => ({ ...tabela.registros.get(pk)! }));

  // 2. Aplica WHERE (apenas igualdade com placeholder)
  let bindIdx = 0;
  if (ast.where) {
    const w = ast.where;
    const valor = w.placeholder ? bindings[bindIdx++] : null;
    linhas = linhas.filter((r) => {
      const v = r[w.coluna];
      return w.op === "=" ? v === valor : false;
    });
  }

  // 3. LEFT JOIN (caso único do listarHistorico)
  if (ast.joinTabela && ast.joinAlias && ast.joinCondLeft && ast.joinCondRight) {
    const tj = db.tabelas.get(ast.joinTabela);
    if (!tj) throw new Error(`JOIN em tabela inexistente: ${ast.joinTabela}`);
    const filhos = tj.ordem.map((pk) => tj.registros.get(pk)!);
    const condEsq = ast.joinCondLeft;
    const condDir = ast.joinCondRight;
    linhas = linhas.map((mae) => {
      const filho = filhos.find((f) => {
        const valEsq =
          condEsq.alias === ast.fromAlias ? mae[condEsq.col] : f[condEsq.col];
        const valDir =
          condDir.alias === ast.joinAlias ? f[condDir.col] : mae[condDir.col];
        return valEsq === valDir;
      });
      const joined: Record<string, unknown> = { ...mae };
      // Prefixa colunas do filho com o alias (pa.*) para resolução
      // posterior na projeção.
      if (filho) {
        for (const [k, v] of Object.entries(filho)) {
          joined[`${ast.joinAlias}.${k}`] = v;
        }
      } else {
        // LEFT JOIN sem match → colunas do filho ficam NULL
        for (const c of tj.colunas) {
          joined[`${ast.joinAlias}.${c}`] = null;
        }
      }
      return joined;
    });
  }

  // 4. ORDER BY
  if (ast.orderBy) {
    const ob = ast.orderBy;
    linhas.sort((a, b) => {
      const va = a[ob.coluna];
      const vb = b[ob.coluna];
      if (typeof va === "number" && typeof vb === "number") {
        return ob.dir === "ASC" ? va - vb : vb - va;
      }
      const sa = String(va ?? "");
      const sb = String(vb ?? "");
      return ob.dir === "ASC" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }

  // 5. LIMIT (pode vir como placeholder)
  if (ast.limit !== undefined) {
    const lim = ast.limit === -1 ? Number(bindings[bindIdx++]) : ast.limit;
    linhas = linhas.slice(0, lim);
  }

  // 6. Projeção
  return linhas.map((linha) => {
    const out: Record<string, unknown> = {};
    for (const c of ast.cols) {
      const chave = c.tabelaAlias ? `${c.tabelaAlias}.${c.coluna}` : c.coluna;
      const valor =
        c.tabelaAlias && c.tabelaAlias === ast.joinAlias
          ? linha[chave]
          : linha[c.coluna];
      const nomeSaida = c.alias ?? c.coluna;
      out[nomeSaida] = valor;
    }
    return out;
  });
}

function parseSelect(query: string): SelectAST & { ordem?: boolean } {
  // Esta função é deliberadamente acoplada aos queries do SessionAgent.
  const ast: SelectAST = {
    cols: [],
    fromTabela: "",
  };

  // 1. SELECT <cols> FROM
  const selMatch = /SELECT\s+(.+?)\s+FROM\s+/i.exec(query);
  if (!selMatch) throw new Error(`SELECT não parseável: ${query}`);
  const colsRaw = selMatch[1]!;
  ast.cols = colsRaw.split(",").map((c) => {
    const t = c.trim();
    // <alias>.<col> [AS <alias_out>]
    const m1 = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+AS\s+([A-Za-z0-9_]+))?$/i.exec(t);
    if (m1) {
      return { tabelaAlias: m1[1], coluna: m1[2]!, alias: m1[3] };
    }
    // <col> [AS <alias_out>]
    const m2 = /^([A-Za-z0-9_]+)(?:\s+AS\s+([A-Za-z0-9_]+))?$/i.exec(t);
    if (m2) {
      return { coluna: m2[1]!, alias: m2[2] };
    }
    throw new Error(`coluna não parseável: ${t}`);
  });

  // 2. FROM <tabela> [<alias>]
  const fromMatch = /\sFROM\s+([A-Za-z0-9_]+)(?:\s+([A-Za-z0-9_]+))?/i.exec(query);
  if (!fromMatch) throw new Error(`FROM não parseável: ${query}`);
  ast.fromTabela = fromMatch[1]!;
  if (fromMatch[2] && !/^(WHERE|ORDER|LIMIT|LEFT|JOIN)$/i.test(fromMatch[2]!)) {
    ast.fromAlias = fromMatch[2];
  }

  // 3. LEFT JOIN <tabela> <alias> ON <a>.<col> = <b>.<col>
  const joinMatch =
    /LEFT\s+JOIN\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s+ON\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/i.exec(
      query,
    );
  if (joinMatch) {
    ast.joinTabela = joinMatch[1]!;
    ast.joinAlias = joinMatch[2]!;
    ast.joinCondLeft = { alias: joinMatch[3]!, col: joinMatch[4]! };
    ast.joinCondRight = { alias: joinMatch[5]!, col: joinMatch[6]! };
  }

  // 4. WHERE <col> = ?
  const whereMatch = /\sWHERE\s+([A-Za-z0-9_]+)\s*(=)\s*(\?|'[^']*'|\d+)/i.exec(query);
  if (whereMatch) {
    ast.where = {
      coluna: whereMatch[1]!,
      op: whereMatch[2]!,
      placeholder: whereMatch[3] === "?",
    };
  }

  // 5. ORDER BY <col> [ASC|DESC]
  const orderMatch = /ORDER\s+BY\s+([A-Za-z0-9_.]+)\s*(ASC|DESC)?/i.exec(query);
  if (orderMatch) {
    let col = orderMatch[1]!;
    if (col.includes(".")) col = col.split(".")[1]!;
    ast.orderBy = {
      coluna: col,
      dir: (orderMatch[2]?.toUpperCase() ?? "ASC") as "ASC" | "DESC",
    };
  }

  // 6. LIMIT <n> | LIMIT ?
  const limitMatch = /LIMIT\s+(\d+|\?)/i.exec(query);
  if (limitMatch) {
    ast.limit = limitMatch[1] === "?" ? -1 : Number(limitMatch[1]);
  }

  return ast;
}
