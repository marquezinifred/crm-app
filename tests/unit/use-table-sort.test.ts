import { describe, it, expect } from 'vitest';
import {
  compareSortValues,
  nextSortState,
  resolveValue,
  type SortKey,
  type SortState,
} from '@/lib/hooks/useTableSort';

/**
 * P-17 — Sort local em tabelas.
 *
 * Testes cobrem os helpers PUROS que fundamentam o hook:
 *  - compareSortValues (string com localeCompare pt-BR, number, Date, bool, null-safe)
 *  - resolveValue (keyof + accessor function)
 *  - nextSortState (transição asc → desc → null; troca coluna reseta pra asc)
 *
 * O harness com React ({@link tests/unit/table-th-sortable.test.tsx})
 * cobre a integração via renderização de UI real.
 */

type Row = { id: string; name: string; count: number; date: Date | null };

const ROWS: readonly Row[] = [
  { id: 'a', name: 'Zilda', count: 3, date: new Date('2024-01-15') },
  { id: 'b', name: 'ana', count: 10, date: new Date('2023-05-01') },
  { id: 'c', name: 'Álvaro', count: 5, date: null },
  { id: 'd', name: 'joão', count: 1, date: new Date('2025-08-20') },
];

function applySort<T>(rows: readonly T[], key: SortKey<T>, dir: 'asc' | 'desc'): T[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    const cmp = compareSortValues(resolveValue(a, key), resolveValue(b, key));
    return dir === 'asc' ? cmp : -cmp;
  });
  return copy;
}

describe('compareSortValues', () => {
  it('ordena string com localeCompare pt-BR (acento e case-insensitive)', () => {
    const sorted = applySort(ROWS, 'name', 'asc');
    // Base sensitivity: acentos são iguais na base, "case" também ignorado.
    // Ordem esperada: Álvaro, ana, joão, Zilda
    expect(sorted.map((r) => r.name)).toEqual(['Álvaro', 'ana', 'joão', 'Zilda']);
  });

  it('ordena number asc/desc', () => {
    expect(applySort(ROWS, 'count', 'asc').map((r) => r.count)).toEqual([1, 3, 5, 10]);
    expect(applySort(ROWS, 'count', 'desc').map((r) => r.count)).toEqual([10, 5, 3, 1]);
  });

  it('ordena Date cronologicamente', () => {
    const sorted = applySort(ROWS, 'date', 'asc');
    // b=2023 < a=2024 < d=2025 < c=null
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('null vai pro fim em asc, pro início em desc', () => {
    const rows: { v: number | null }[] = [{ v: 5 }, { v: null }, { v: 2 }];
    expect(applySort(rows, 'v', 'asc').map((r) => r.v)).toEqual([2, 5, null]);
    expect(applySort(rows, 'v', 'desc').map((r) => r.v)).toEqual([null, 5, 2]);
  });

  it('boolean: true antes de false em asc', () => {
    expect(compareSortValues(true, false)).toBeLessThan(0);
    expect(compareSortValues(false, true)).toBeGreaterThan(0);
    expect(compareSortValues(true, true)).toBe(0);
  });

  it('null + null → 0', () => {
    expect(compareSortValues(null, null)).toBe(0);
    expect(compareSortValues(undefined, undefined)).toBe(0);
    expect(compareSortValues(null, undefined)).toBe(0);
  });

  it('numeric collation em strings ("10" > "2" com localeCompare padrão fica errado, mas numeric:true corrige)', () => {
    const rows = [{ v: '10' }, { v: '2' }, { v: '30' }];
    expect(applySort(rows, 'v', 'asc').map((r) => r.v)).toEqual(['2', '10', '30']);
  });
});

describe('resolveValue', () => {
  it('acessa por keyof', () => {
    expect(resolveValue(ROWS[0]!, 'name')).toBe('Zilda');
    expect(resolveValue(ROWS[1]!, 'count')).toBe(10);
  });

  it('acessa via accessor function (valor computado)', () => {
    type T = { name: string; nested: { count: number } };
    const row: T = { name: 'x', nested: { count: 42 } };
    expect(resolveValue(row, (r: T) => r.nested.count)).toBe(42);
  });
});

describe('nextSortState — toggle 3 estados', () => {
  it('coluna nova a partir de null → asc', () => {
    const s: SortState<Row> = { key: null, dir: 'asc' };
    expect(nextSortState(s, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('mesmo key em asc → desc', () => {
    const s: SortState<Row> = { key: 'name', dir: 'asc' };
    expect(nextSortState(s, 'name')).toEqual({ key: 'name', dir: 'desc' });
  });

  it('mesmo key em desc → null (volta ao original)', () => {
    const s: SortState<Row> = { key: 'name', dir: 'desc' };
    expect(nextSortState(s, 'name')).toEqual({ key: null, dir: 'asc' });
  });

  it('troca de coluna reseta pra asc mesmo se estava em desc', () => {
    const s: SortState<Row> = { key: 'name', dir: 'desc' };
    expect(nextSortState(s, 'count')).toEqual({ key: 'count', dir: 'asc' });
  });

  it('ciclo completo em 3 cliques volta pro início', () => {
    let s: SortState<Row> = { key: null, dir: 'asc' };
    s = nextSortState(s, 'name'); // asc
    expect(s).toEqual({ key: 'name', dir: 'asc' });
    s = nextSortState(s, 'name'); // desc
    expect(s).toEqual({ key: 'name', dir: 'desc' });
    s = nextSortState(s, 'name'); // null
    expect(s).toEqual({ key: null, dir: 'asc' });
  });

  it('accessor function preserva identidade ao ciclar', () => {
    const accessor: SortKey<Row> = (r) => r.count;
    let s: SortState<Row> = { key: null, dir: 'asc' };
    s = nextSortState(s, accessor);
    expect(s.key).toBe(accessor);
    expect(s.dir).toBe('asc');
    s = nextSortState(s, accessor);
    expect(s.dir).toBe('desc');
    s = nextSortState(s, accessor);
    expect(s.key).toBeNull();
  });
});
