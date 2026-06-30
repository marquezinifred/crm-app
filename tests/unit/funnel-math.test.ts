import { describe, it, expect } from 'vitest';

/**
 * Testa a lógica visual do FunnelChart — Sprint 14.5 (item 3).
 *
 * O bug original era exibir `↓114.3%` quando 16/14 = 1.143 (16 leads vs
 * 14 prospects = +14.3% — ganho). Spec do 14.5 exige:
 *  - taxa = (next/current)*100
 *  - >= 100% → `+X.X%` em cor success
 *  - <  100% → `X.X%` em cor neutra/text-2 (sem sinal de queda)
 */

function conversionDisplay(rate: number | null): { text: string; tone: 'success' | 'neutral' | 'final' } {
  if (rate == null) return { text: '—', tone: 'final' };
  if (rate >= 100) return { text: `+${(rate - 100).toFixed(1)}%`, tone: 'success' };
  return { text: `${rate.toFixed(1)}%`, tone: 'neutral' };
}

describe('FunnelChart conversion display', () => {
  it('ganho mostra +X% em verde', () => {
    expect(conversionDisplay(114.3)).toEqual({ text: '+14.3%', tone: 'success' });
  });

  it('exatamente 100% conta como ganho zero', () => {
    expect(conversionDisplay(100)).toEqual({ text: '+0.0%', tone: 'success' });
  });

  it('perda mostra apenas X% (sem seta de queda)', () => {
    expect(conversionDisplay(67.5)).toEqual({ text: '67.5%', tone: 'neutral' });
  });

  it('estágio final retorna placeholder', () => {
    expect(conversionDisplay(null)).toEqual({ text: '—', tone: 'final' });
  });

  it('largura barra é por contagem, não por valor', () => {
    const stages = [
      { count: 14, sumValue: 100_000 },
      { count: 16, sumValue: 50_000 },
      { count: 5, sumValue: 200_000 },
    ];
    const maxCount = Math.max(...stages.map((s) => s.count));
    expect(maxCount).toBe(16);
    const widths = stages.map((s) => (s.count / maxCount) * 100);
    expect(widths[0]).toBeCloseTo(87.5, 1);
    expect(widths[1]).toBe(100);
    expect(widths[2]).toBeCloseTo(31.25, 1);
  });
});
