'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * P-17 — Sort local em tabelas ≤ 200 rows.
 *
 * Toggle: 1º clique = asc, 2º = desc, 3º = null (volta à ordem original).
 * Null/undefined vão pro fim em asc, pro início em desc.
 * Strings usam localeCompare('pt-BR') pra ordenar acentos corretamente.
 * Datas são convertidas via getTime().
 *
 * Accessor pode ser keyof T (chave direta) ou (row) => value (computado —
 * ex: `(t) => t._count.users` pra contagens de relação Prisma).
 */

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | Date | boolean | null | undefined;
export type SortKey<T> = keyof T | ((row: T) => SortValue);

export function resolveValue<T>(row: T, key: SortKey<T>): SortValue {
  if (typeof key === 'function') return key(row);
  return row[key] as SortValue;
}

export function compareSortValues(a: SortValue, b: SortValue): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? -1 : 1;
  }

  const as = typeof a === 'string' ? a : String(a);
  const bs = typeof b === 'string' ? b : String(b);
  return as.localeCompare(bs, 'pt-BR', { sensitivity: 'base', numeric: true });
}

export type SortState<T> = { key: SortKey<T> | null; dir: SortDir };

/**
 * Pure state transition — testável sem React.
 * Clique na coluna atual: asc → desc → null.
 * Clique em outra coluna: reseta pra asc dessa coluna.
 */
export function nextSortState<T>(
  prev: SortState<T>,
  key: SortKey<T>,
): SortState<T> {
  if (prev.key !== key) return { key, dir: 'asc' };
  if (prev.dir === 'asc') return { key, dir: 'desc' };
  return { key: null, dir: 'asc' };
}

export function useTableSort<T>(
  rows: readonly T[],
  defaultKey: SortKey<T> | null = null,
  defaultDir: SortDir = 'asc',
) {
  const [state, setState] = useState<SortState<T>>({
    key: defaultKey,
    dir: defaultDir,
  });

  const toggleSort = useCallback((key: SortKey<T>) => {
    setState((prev) => nextSortState(prev, key));
  }, []);

  const getSortState = useCallback(
    (key: SortKey<T>): SortDir | null => {
      if (state.key !== key) return null;
      return state.dir;
    },
    [state],
  );

  const sorted = useMemo(() => {
    if (!state.key) return rows.slice();
    const key = state.key;
    const dir = state.dir;
    const copy = rows.slice();
    copy.sort((a, b) => {
      const cmp = compareSortValues(resolveValue(a, key), resolveValue(b, key));
      return dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, state]);

  return {
    sorted,
    sortKey: state.key,
    sortDir: state.dir,
    toggleSort,
    getSortState,
  };
}
