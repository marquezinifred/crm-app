import { describe, it, expect } from 'vitest';
import {
  computeFunnel,
  avgDaysPerStage,
  winLossBreakdown,
  performanceByOwner,
  projectRevenue,
  DEFAULT_CONVERSION_RATES,
  type OpportunitySnap,
  type StageHistoryEntry,
} from '@/server/services/analytics.service';

function opp(partial: Partial<OpportunitySnap> & { id: string; stage: OpportunitySnap['stage']; status: OpportunitySnap['status'] }): OpportunitySnap {
  return {
    estimatedValue: 10000,
    closedValue: null,
    ownerId: 'u1',
    ownerName: 'User',
    lossReason: null,
    createdAt: new Date(2026, 0, 1),
    currentStageEnteredAt: new Date(2026, 5, 1),
    actualCloseDate: null,
    ...partial,
  };
}

describe('computeFunnel', () => {
  it('agrupa por estágio e calcula conversão', () => {
    const opps = [
      opp({ id: '1', stage: 'PROSPECT', status: 'ACTIVE', estimatedValue: 1000 }),
      opp({ id: '2', stage: 'PROSPECT', status: 'ACTIVE', estimatedValue: 2000 }),
      opp({ id: '3', stage: 'LEAD', status: 'ACTIVE', estimatedValue: 3000 }),
      opp({ id: '4', stage: 'OPORTUNIDADE', status: 'ACTIVE' }),
    ];
    const f = computeFunnel(opps);
    expect(f.find((x) => x.stage === 'PROSPECT')).toMatchObject({ count: 2, sumValue: 3000 });
    expect(f.find((x) => x.stage === 'PROSPECT')!.conversionToNextPct).toBe(50); // 1/2
    expect(f.find((x) => x.stage === 'LEAD')!.conversionToNextPct).toBe(100); // 1/1
  });

  it('ignora oportunidades não ACTIVE', () => {
    const opps = [
      opp({ id: '1', stage: 'LEAD', status: 'WON' }),
      opp({ id: '2', stage: 'LEAD', status: 'ACTIVE' }),
    ];
    const f = computeFunnel(opps);
    expect(f.find((x) => x.stage === 'LEAD')!.count).toBe(1);
  });

  it('conversão null quando count=0', () => {
    expect(computeFunnel([]).every((s) => s.conversionToNextPct === null || s.stage === 'CONTRATO')).toBe(true);
  });
});

describe('winLossBreakdown', () => {
  it('calcula win rate ignorando ACTIVE/CANCELLED', () => {
    const opps = [
      opp({ id: '1', stage: 'CONTRATO', status: 'WON', closedValue: 50000 }),
      opp({ id: '2', stage: 'NEGOCIACAO', status: 'LOST', lossReason: 'PRECO' }),
      opp({ id: '3', stage: 'NEGOCIACAO', status: 'LOST', lossReason: 'PRECO' }),
      opp({ id: '4', stage: 'ACEITE', status: 'ACTIVE' }),
      opp({ id: '5', stage: 'PROSPECT', status: 'CANCELLED' }),
    ];
    const r = winLossBreakdown(opps);
    expect(r.won.count).toBe(1);
    expect(r.lost.count).toBe(2);
    expect(r.cancelled.count).toBe(1);
    expect(r.winRatePct).toBeCloseTo(33.3, 1);
    expect(r.byLossReason[0]).toMatchObject({ reason: 'PRECO', count: 2 });
  });
});

describe('projectRevenue', () => {
  it('soma ponderado por estágio com defaults', () => {
    const opps = [
      opp({ id: '1', stage: 'PROSPECT', status: 'ACTIVE', estimatedValue: 100000 }),
      opp({ id: '2', stage: 'ACEITE', status: 'ACTIVE', estimatedValue: 100000 }),
    ];
    const r = projectRevenue(opps);
    // PROSPECT 5% + ACEITE 85% = 5000 + 85000 = 90000
    expect(r.base).toBe(90_000);
    expect(r.best).toBeGreaterThan(r.base);
    expect(r.worst).toBeLessThan(r.base);
  });

  it('cap em 100% no cenário best', () => {
    const opps = [opp({ id: '1', stage: 'ACEITE', status: 'ACTIVE', estimatedValue: 1000 })];
    const r = projectRevenue(opps, { ACEITE: 90 });
    // 90 * 1.2 = 108 → cap 100
    expect(r.best).toBe(1000);
  });

  it('ignora não-ACTIVE', () => {
    const opps = [opp({ id: '1', stage: 'CONTRATO', status: 'WON', estimatedValue: 100000 })];
    expect(projectRevenue(opps).base).toBe(0);
  });

  it('aceita rates customizadas; falta de rate cai para default', () => {
    const opps = [
      opp({ id: '1', stage: 'OPORTUNIDADE', status: 'ACTIVE', estimatedValue: 10000 }),
    ];
    const r = projectRevenue(opps, { OPORTUNIDADE: 50 });
    expect(r.base).toBe(5000); // override 50 ao invés do default 30
  });
});

describe('performanceByOwner', () => {
  it('agrupa, calcula winrate e ordena por wonValue', () => {
    const opps = [
      opp({ id: '1', ownerId: 'a', ownerName: 'Alice', stage: 'CONTRATO', status: 'WON', closedValue: 50_000 }),
      opp({ id: '2', ownerId: 'a', ownerName: 'Alice', stage: 'NEGOCIACAO', status: 'LOST' }),
      opp({ id: '3', ownerId: 'b', ownerName: 'Bob', stage: 'CONTRATO', status: 'WON', closedValue: 100_000 }),
    ];
    const r = performanceByOwner(opps);
    expect(r.rows[0]!.ownerName).toBe('Bob');
    expect(r.rows.find((x) => x.ownerId === 'a')!.winRatePct).toBe(50);
    expect(r.teamAverage.wonValue).toBe(75_000); // (50k + 100k) / 2
  });
});

describe('avgDaysPerStage', () => {
  it('calcula tempo entre entradas consecutivas no histórico', () => {
    const day = (n: number) => new Date(2026, 5, n);
    const history: StageHistoryEntry[] = [
      { opportunityId: '1', fromStage: null, toStage: 'PROSPECT', at: day(1) },
      { opportunityId: '1', fromStage: 'PROSPECT', toStage: 'LEAD', at: day(4) }, // PROSPECT durou 3 dias
      { opportunityId: '1', fromStage: 'LEAD', toStage: 'OPORTUNIDADE', at: day(10) }, // LEAD durou 6 dias
    ];
    const r = avgDaysPerStage(history);
    expect(r.PROSPECT.avgDays).toBe(3);
    expect(r.LEAD.avgDays).toBe(6);
    expect(r.OPORTUNIDADE.samples).toBe(0); // sem saída registrada
  });
});

describe('DEFAULT_CONVERSION_RATES', () => {
  it('CONTRATO é sempre 100', () => {
    expect(DEFAULT_CONVERSION_RATES.CONTRATO).toBe(100);
  });
});
