/**
 * Helpers de citação canônica de dispositivos jurídicos.
 *
 * O objetivo é gerar identificadores e labels determinísticos que possam
 * ser reaproveitados em:
 *   - geração da chave R2 (`{norma}/art_{n}.json`)
 *   - chave canônica do dispositivo (`{norma}#art{n}-par{p}-inc{i}-al{a}`)
 *   - label legível (ex.: "Art. 5º, §1º, II, b da Lei 14.133/2021")
 */

/**
 * Identificador semântico de um dispositivo. `null` quando o nível não se aplica
 * (ex.: artigo sem parágrafo).
 */
export interface DispositivoRef {
  norma_id: string;
  norma_label?: string;
  artigo: number | null;
  paragrafo?: number | string | null;
  inciso?: string | null;
  alinea?: string | null;
}

/**
 * Resolve a "hierarquia path" usada como chave estável no D1
 * (idempotente: mesma entrada → mesmo path).
 */
export function buildHierarquiaPath(ref: DispositivoRef): string {
  const parts: string[] = [];
  if (ref.artigo !== null && ref.artigo !== undefined) {
    parts.push(`art${ref.artigo}`);
  }
  if (ref.paragrafo !== null && ref.paragrafo !== undefined) {
    parts.push(`par${ref.paragrafo}`);
  }
  if (ref.inciso) {
    parts.push(`inc${ref.inciso}`);
  }
  if (ref.alinea) {
    parts.push(`al${ref.alinea}`);
  }
  return parts.join("-");
}

/**
 * ID canônico determinístico de um dispositivo — usado para junção entre
 * Vectorize e D1.
 */
export function buildDispositivoId(ref: DispositivoRef): string {
  return `${ref.norma_id}#${buildHierarquiaPath(ref)}`;
}

/**
 * Constrói o caminho R2 esperado para um dispositivo.
 *
 * Convenção (espelha hierarquia jurídica):
 *   {norma_id}/art{N}/par{P}/inc{I}/al{A}.json
 *
 * Quando não há nível profundo, para no último presente.
 */
export function buildR2Path(ref: DispositivoRef): string {
  const segments: string[] = [ref.norma_id];
  if (ref.artigo !== null && ref.artigo !== undefined) {
    segments.push(`art${ref.artigo}`);
  }
  if (ref.paragrafo !== null && ref.paragrafo !== undefined) {
    segments.push(`par${ref.paragrafo}`);
  }
  if (ref.inciso) {
    segments.push(`inc${ref.inciso}`);
  }
  if (ref.alinea) {
    segments.push(`al${ref.alinea}`);
  }
  return `${segments.join("/")}.json`;
}

/**
 * Label humano de uma citação, ex.: "Art. 5º, §1º, II, b da Lei 14.133/2021".
 */
export function buildLabel(ref: DispositivoRef): string {
  const parts: string[] = [];
  if (ref.artigo !== null && ref.artigo !== undefined) {
    parts.push(`Art. ${ref.artigo}º`);
  }
  if (ref.paragrafo !== null && ref.paragrafo !== undefined) {
    parts.push(`§${ref.paragrafo}º`);
  }
  if (ref.inciso) {
    parts.push(ref.inciso.toUpperCase());
  }
  if (ref.alinea) {
    parts.push(ref.alinea.toLowerCase());
  }
  const norma = ref.norma_label ?? ref.norma_id;
  return `${parts.join(", ")} da ${norma}`;
}
