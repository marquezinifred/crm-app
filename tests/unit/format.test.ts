import { describe, it, expect } from 'vitest';
import {
  formatBRL,
  formatBRLCompact,
  formatPercent,
  formatRelativeDate,
} from '@/lib/utils/format';

describe('formatBRL', () => {
  it('formata moeda com decimais', () => {
    expect(formatBRL(1234.56).replace(/\s/g, ' ')).toMatch(/R\$ 1\.234,56/);
  });

  it('valor inteiro sem casas decimais', () => {
    expect(formatBRL(287_555).replace(/\s/g, ' ')).toMatch(/R\$ 287\.555/);
  });

  it('lida com zero', () => {
    expect(formatBRL(0)).toMatch(/R\$\s?0/);
  });

  it('NaN / Infinity → "R$ —"', () => {
    expect(formatBRL(Number.NaN)).toBe('R$ —');
    expect(formatBRL(Number.POSITIVE_INFINITY)).toBe('R$ —');
  });
});

describe('formatBRLCompact', () => {
  it('R$ < 1k mostra inteiro', () => {
    expect(formatBRLCompact(789)).toBe('R$ 789');
  });

  it('R$ entre 1k e 1M mostra milhar', () => {
    expect(formatBRLCompact(287_555)).toBe('R$ 288k');
    expect(formatBRLCompact(1_000)).toBe('R$ 1k');
  });

  it('R$ ≥ 1M mostra com decimal abaixo de 10M', () => {
    expect(formatBRLCompact(1_200_000)).toBe('R$ 1,2M');
    expect(formatBRLCompact(9_900_000)).toBe('R$ 9,9M');
  });

  it('R$ ≥ 10M sem decimal', () => {
    expect(formatBRLCompact(12_000_000)).toBe('R$ 12M');
  });

  it('NaN / Infinity → "R$ —"', () => {
    expect(formatBRLCompact(Number.NaN)).toBe('R$ —');
  });
});

describe('formatPercent', () => {
  it('default 1 casa decimal', () => {
    expect(formatPercent(50)).toBe('50.0%');
  });
  it('respeita fractionDigits', () => {
    expect(formatPercent(33.333, 0)).toBe('33%');
  });
});

describe('formatRelativeDate', () => {
  it('hoje / amanhã / ontem', () => {
    const now = new Date();
    expect(formatRelativeDate(now)).toBe('hoje');
    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect(formatRelativeDate(tomorrow)).toBe('amanhã');
    const yesterday = new Date(now.getTime() - 86_400_000);
    expect(formatRelativeDate(yesterday)).toBe('ontem');
  });
  it('futuro distante', () => {
    const future = new Date(Date.now() + 86_400_000 * 7);
    expect(formatRelativeDate(future)).toBe('em 7d');
  });
  it('passado distante', () => {
    const past = new Date(Date.now() - 86_400_000 * 3);
    expect(formatRelativeDate(past)).toBe('há 3d');
  });
});
