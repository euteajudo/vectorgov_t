/**
 * Diff palavra-a-palavra usando o algoritmo LCS (longest common subsequence).
 *
 * Sem dependência externa para manter o Worker leve. Implementação tabular
 * em O(N·M) — adequada para parágrafos de até alguns milhares de palavras
 * (a maioria dos dispositivos jurídicos tem < 500 palavras).
 *
 * Em textos maiores que ~5k palavras o desempenho degrada; nesse caso,
 * trocar por Myers diff (`diff` npm package) seria o próximo passo.
 */

/**
 * Segmento de diff — `tipo` indica se foi igual, adicionado ou removido.
 */
export interface DiffSeg {
  tipo: "igual" | "adicionado" | "removido";
  texto: string;
}

/**
 * Divide texto em "palavras" preservando o espaçamento original — útil
 * para reconstruir o texto pós-diff sem quebrar layout jurídico (números
 * de parágrafo, pontuação).
 */
function tokenize(text: string): string[] {
  // Captura palavras + separadores. O regex global divide mantendo o
  // separador (whitespace + pontuação) como tokens próprios.
  return text.match(/\S+|\s+/g) ?? [];
}

/**
 * Constrói a matriz de LCS — `dp[i][j]` = tamanho da LCS de a[0..i) com b[0..j).
 */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? (dp[i - 1]![j - 1]! + 1)
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp;
}

/**
 * Reconstrói o diff a partir da matriz LCS, juntando tokens vizinhos
 * do mesmo tipo em um único segmento (output mais compacto).
 */
export function wordDiff(a: string, b: string): DiffSeg[] {
  const aT = tokenize(a);
  const bT = tokenize(b);
  const dp = lcsMatrix(aT, bT);

  const segs: DiffSeg[] = [];
  function push(tipo: DiffSeg["tipo"], texto: string): void {
    if (texto.length === 0) return;
    const last = segs[segs.length - 1];
    if (last && last.tipo === tipo) {
      last.texto += texto;
    } else {
      segs.push({ tipo, texto });
    }
  }

  let i = aT.length;
  let j = bT.length;
  const out: DiffSeg[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aT[i - 1] === bT[j - 1]) {
      out.unshift({ tipo: "igual", texto: aT[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      out.unshift({ tipo: "adicionado", texto: bT[j - 1]! });
      j--;
    } else if (i > 0) {
      out.unshift({ tipo: "removido", texto: aT[i - 1]! });
      i--;
    }
  }
  // Junta vizinhos do mesmo tipo via `push`.
  for (const s of out) push(s.tipo, s.texto);
  return segs;
}

/**
 * Conta palavras (não-whitespace) por tipo, usado no `resumo`.
 */
export function countWords(segs: DiffSeg[]): {
  iguais: number;
  adicionadas: number;
  removidas: number;
} {
  const acc = { iguais: 0, adicionadas: 0, removidas: 0 };
  for (const s of segs) {
    const n = (s.texto.match(/\S+/g) ?? []).length;
    if (s.tipo === "igual") acc.iguais += n;
    else if (s.tipo === "adicionado") acc.adicionadas += n;
    else acc.removidas += n;
  }
  return acc;
}
