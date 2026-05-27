/**
 * Utilidades transversais do frontend.
 *
 * `cn`: combinador clsx + tailwind-merge usado por todos componentes
 * shadcn/ui. Resolve conflitos de classes Tailwind (ex.: `p-2 p-4` → `p-4`).
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina class names com resolução de conflitos Tailwind.
 *
 * @example
 *   cn("p-2", condition && "p-4") // → "p-4" se condition=true
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formata centavos (BRL int) em string monetária pt-BR.
 *
 * @example
 *   formatBRL(123456) // → "R$ 1.234,56"
 */
export function formatBRL(centavos: number): string {
  const reais = centavos / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(reais);
}

/**
 * Formata data ISO (YYYY-MM-DD ou ISO 8601 completo) em dd/mm/yyyy.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Trunca string em N chars com elipse.
 */
export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
