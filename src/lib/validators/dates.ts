/**
 * Helpers para tratamento de datas no formato PT-BR.
 * Suporta:
 *   - DD/MM/AAAA → Date completa
 *   - DD/MM      → mês/dia recorrente anual (ano = 0001 sentinela)
 */

export const RECURRING_YEAR_SENTINEL = 1;

export function parseBrDate(input: string): Date | null {
  const trimmed = input.trim();
  const fullMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (fullMatch) {
    const [, dd, mm, yyyy] = fullMatch;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (
      date.getFullYear() !== Number(yyyy) ||
      date.getMonth() !== Number(mm) - 1 ||
      date.getDate() !== Number(dd)
    ) {
      return null;
    }
    return date;
  }
  const shortMatch = /^(\d{2})\/(\d{2})$/.exec(trimmed);
  if (shortMatch) {
    const [, dd, mm] = shortMatch;
    // Date(yyyy < 100) é interpretado como 19yyyy — use setFullYear para fixar 0001
    const date = new Date(2000, Number(mm) - 1, Number(dd));
    if (date.getMonth() !== Number(mm) - 1 || date.getDate() !== Number(dd)) {
      return null;
    }
    date.setFullYear(RECURRING_YEAR_SENTINEL);
    return date;
  }
  return null;
}

export function isRecurringDate(date: Date): boolean {
  return date.getFullYear() === RECURRING_YEAR_SENTINEL;
}

export function formatBrDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  if (isRecurringDate(date)) return `${dd}/${mm}`;
  return `${dd}/${mm}/${date.getFullYear()}`;
}
