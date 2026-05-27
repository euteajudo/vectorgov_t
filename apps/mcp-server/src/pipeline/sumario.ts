/**
 * Normaliza o sumário do parser Python para o shape consumido pelas tools MCP.
 *
 * O parser emite `{ artigos: { ... } }`; `fs_listar_estrutura` consome
 * `{ estrutura: NoSumario[], total_dispositivos }`.
 */

export interface NoSumario {
  tipo: string;
  numero: string | null;
  titulo: string | null;
  caminho: string;
  filhos: NoSumario[];
}

export interface SumarioFile {
  estrutura: NoSumario[];
  total_dispositivos: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childMapToNodes(
  tipo: string,
  value: unknown,
  parentPath: string,
): NoSumario[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([numero, raw]) => {
    const item = isRecord(raw) ? raw : {};
    const caminho =
      typeof item.id === "string" ? item.id : `${parentPath}/${tipo}-${numero}`;
    return {
      tipo,
      numero,
      titulo: null,
      caminho,
      filhos: [],
    };
  });
}

function artigosObjectToNodes(artigos: Record<string, unknown>): NoSumario[] {
  return Object.entries(artigos).map(([numero, raw]) => {
    const item = isRecord(raw) ? raw : {};
    const filhosRaw = isRecord(item.filhos) ? item.filhos : {};
    const caminho = typeof item.id === "string" ? item.id : `art${numero}`;
    const filhos = [
      ...childMapToNodes("paragrafo", filhosRaw.paragrafos, caminho),
      ...childMapToNodes("inciso", filhosRaw.incisos, caminho),
      ...childMapToNodes("alinea", filhosRaw.alineas, caminho),
    ];
    return {
      tipo: "artigo",
      numero,
      titulo: typeof item.titulo === "string" ? item.titulo : null,
      caminho,
      filhos,
    };
  });
}

function countNodes(nodes: NoSumario[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1 + countNodes(node.filhos);
  }
  return total;
}

export function sumarioToEstruturaFile(
  raw: unknown,
  totalFallback = 0,
): SumarioFile {
  if (isRecord(raw) && Array.isArray(raw.estrutura)) {
    const estrutura = raw.estrutura as NoSumario[];
    const total =
      typeof raw.total_dispositivos === "number"
        ? raw.total_dispositivos
        : totalFallback || countNodes(estrutura);
    return { estrutura, total_dispositivos: total };
  }

  if (isRecord(raw) && isRecord(raw.artigos)) {
    const estrutura = artigosObjectToNodes(raw.artigos);
    return {
      estrutura,
      total_dispositivos: totalFallback || countNodes(estrutura),
    };
  }

  return { estrutura: [], total_dispositivos: totalFallback };
}
