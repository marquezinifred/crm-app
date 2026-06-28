import { describe, it, expect } from 'vitest';
import { __test } from '@/server/services/alert-generator.service';

const { nextOccurrence, daysBetween, startOfDay } = __test;

// JS Date(year<100, ...) vira 19yy — usar setFullYear para fixar ano 1
function recurringDate(month: number, day: number): Date {
  const d = new Date(2000, month, day);
  d.setFullYear(1);
  return d;
}

describe('nextOccurrence', () => {
  const today = new Date(2026, 5, 27); // 27/jun/2026

  it('data única no futuro: usa ano armazenado', () => {
    const stored = new Date(2026, 11, 15);
    const next = nextOccurrence(stored, today);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(11);
    expect(next.getDate()).toBe(15);
  });

  it('data recorrente (ano 0001) futura no ano corrente', () => {
    const stored = recurringDate(11, 15); // dia 15/12 recorrente
    const next = nextOccurrence(stored, today);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(11);
    expect(next.getDate()).toBe(15);
  });

  it('data recorrente já passada → próxima vai para o ano seguinte', () => {
    const stored = recurringDate(0, 10); // 10/jan recorrente
    const next = nextOccurrence(stored, today); // hoje é 27/jun
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(10);
  });

  it('data recorrente HOJE → retorna hoje (não vai para o próximo ano)', () => {
    const stored = recurringDate(today.getMonth(), today.getDate());
    const next = nextOccurrence(stored, today);
    expect(next.getFullYear()).toBe(today.getFullYear());
  });
});

describe('daysBetween', () => {
  it('mesma data → 0', () => {
    const t = new Date(2026, 5, 27);
    expect(daysBetween(t, t)).toBe(0);
  });

  it('amanhã → 1', () => {
    const today = new Date(2026, 5, 27);
    const tomorrow = new Date(2026, 5, 28);
    expect(daysBetween(tomorrow, today)).toBe(1);
  });

  it('em 7 dias → 7', () => {
    const today = new Date(2026, 5, 27, 23, 59);
    const future = new Date(2026, 6, 4, 0, 0);
    expect(daysBetween(future, today)).toBe(7);
  });

  it('ontem → -1', () => {
    const today = new Date(2026, 5, 27);
    const yest = new Date(2026, 5, 26);
    expect(daysBetween(yest, today)).toBe(-1);
  });

  it('ignora horas/minutos (compara só startOfDay)', () => {
    const a = new Date(2026, 5, 27, 8, 0);
    const b = new Date(2026, 5, 27, 23, 59);
    expect(daysBetween(a, b)).toBe(0);
  });
});

describe('startOfDay', () => {
  it('zera horas/minutos/segundos/ms', () => {
    const d = new Date(2026, 5, 27, 14, 30, 45, 123);
    const z = startOfDay(d);
    expect(z.getHours()).toBe(0);
    expect(z.getMinutes()).toBe(0);
    expect(z.getSeconds()).toBe(0);
    expect(z.getMilliseconds()).toBe(0);
  });
});
