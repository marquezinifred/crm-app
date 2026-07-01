/**
 * Funções puras de analytics para relatórios.
 * Recebem dados já materializados (sem Prisma) e devolvem agregados.
 * Facilita teste unitário sem mock de banco.
 */

import type { OpportunityStage, OpportunityStatus, OpportunityLossReason } from '@prisma/client';

export const STAGE_ORDER_ARR: OpportunityStage[] = [
  'PROSPECT',
  'LEAD',
  'OPORTUNIDADE',
  'PROPOSTA',
  'NEGOCIACAO',
  'ACEITE',
  'CONTRATO',
];

export const DEFAULT_CONVERSION_RATES: Record<OpportunityStage, number> = {
  PROSPECT: 5,
  LEAD: 15,
  OPORTUNIDADE: 30,
  PROPOSTA: 50,
  NEGOCIACAO: 70,
  ACEITE: 85,
  CONTRATO: 100,
};

export interface OpportunitySnap {
  id: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  estimatedValue: number;
  closedValue: number | null;
  // Sprint 15D — nullable pra suportar opps inbound aguardando alocação
  // na fila de prospects. performanceByOwner filtra estas out.
  ownerId: string | null;
  ownerName: string;
  lossReason: OpportunityLossReason | null;
  createdAt: Date;
  currentStageEnteredAt: Date;
  actualCloseDate: Date | null;
}

// ---------- Funil ----------

export interface FunnelStage {
  stage: OpportunityStage;
  count: number;
  sumValue: number;
  conversionToNextPct: number | null;
}

export function computeFunnel(opps: OpportunitySnap[]): FunnelStage[] {
  const active = opps.filter((o) => o.status === 'ACTIVE');
  const counts = new Map<OpportunityStage, { count: number; sumValue: number }>();
  for (const s of STAGE_ORDER_ARR) counts.set(s, { count: 0, sumValue: 0 });
  for (const o of active) {
    const c = counts.get(o.stage)!;
    c.count += 1;
    c.sumValue += o.estimatedValue;
  }
  return STAGE_ORDER_ARR.map((stage, i) => {
    const cur = counts.get(stage)!;
    const next = STAGE_ORDER_ARR[i + 1];
    const nextCount = next ? counts.get(next)!.count : 0;
    return {
      stage,
      count: cur.count,
      sumValue: cur.sumValue,
      conversionToNextPct:
        next && cur.count > 0 ? Math.round((nextCount / cur.count) * 1000) / 10 : null,
    };
  });
}

// ---------- Tempo médio por estágio ----------

export interface StageHistoryEntry {
  opportunityId: string;
  fromStage: OpportunityStage | null;
  toStage: OpportunityStage;
  at: Date;
}

export function avgDaysPerStage(
  history: StageHistoryEntry[],
): Record<OpportunityStage, { avgDays: number; samples: number }> {
  const buckets = new Map<OpportunityStage, number[]>();
  for (const s of STAGE_ORDER_ARR) buckets.set(s, []);

  // Para cada oportunidade, ordena entradas por timestamp e calcula a duração
  // que ela ficou em cada estágio antes de sair.
  const byOpp = new Map<string, StageHistoryEntry[]>();
  for (const h of history) {
    const arr = byOpp.get(h.opportunityId) ?? [];
    arr.push(h);
    byOpp.set(h.opportunityId, arr);
  }
  for (const entries of byOpp.values()) {
    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < entries.length - 1; i++) {
      const cur = entries[i]!;
      const next = entries[i + 1]!;
      const days = (next.at.getTime() - cur.at.getTime()) / 86_400_000;
      buckets.get(cur.toStage)!.push(days);
    }
  }

  const result = {} as Record<OpportunityStage, { avgDays: number; samples: number }>;
  for (const s of STAGE_ORDER_ARR) {
    const xs = buckets.get(s)!;
    const samples = xs.length;
    const avg = samples === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / samples;
    result[s] = { avgDays: Math.round(avg * 10) / 10, samples };
  }
  return result;
}

// ---------- Ganho/Perda ----------

export interface WinLossBreakdown {
  won: { count: number; sumValue: number };
  lost: { count: number; sumValue: number };
  cancelled: { count: number; sumValue: number };
  winRatePct: number;
  byLossReason: Array<{
    reason: OpportunityLossReason | 'SEM_MOTIVO';
    count: number;
    sumValue: number;
  }>;
}

export function winLossBreakdown(opps: OpportunitySnap[]): WinLossBreakdown {
  const won = { count: 0, sumValue: 0 };
  const lost = { count: 0, sumValue: 0 };
  const cancelled = { count: 0, sumValue: 0 };
  const reasonMap = new Map<string, { count: number; sumValue: number }>();

  for (const o of opps) {
    const v = Number(o.closedValue ?? o.estimatedValue);
    if (o.status === 'WON') {
      won.count += 1;
      won.sumValue += v;
    } else if (o.status === 'LOST') {
      lost.count += 1;
      lost.sumValue += v;
      const key = o.lossReason ?? 'SEM_MOTIVO';
      const bucket = reasonMap.get(key) ?? { count: 0, sumValue: 0 };
      bucket.count += 1;
      bucket.sumValue += v;
      reasonMap.set(key, bucket);
    } else if (o.status === 'CANCELLED') {
      cancelled.count += 1;
      cancelled.sumValue += v;
    }
  }

  const decided = won.count + lost.count;
  const winRatePct = decided === 0 ? 0 : Math.round((won.count / decided) * 1000) / 10;
  const byLossReason = Array.from(reasonMap.entries())
    .map(([reason, agg]) => ({
      reason: reason as OpportunityLossReason | 'SEM_MOTIVO',
      count: agg.count,
      sumValue: agg.sumValue,
    }))
    .sort((a, b) => b.count - a.count);

  return { won, lost, cancelled, winRatePct, byLossReason };
}

// ---------- Projeção de receita ----------

export interface RevenueProjection {
  base: number;
  best: number;
  worst: number;
  byStage: Array<{ stage: OpportunityStage; base: number; rate: number; weightedValue: number }>;
}

/**
 * Projeção: cada oportunidade ativa entra ponderada pela taxa de conversão
 * do seu estágio atual. Cenários:
 *   - base:  rate
 *   - best:  rate * 1.2 (capado em 100)
 *   - worst: rate * 0.7
 */
export function projectRevenue(
  activeOpps: OpportunitySnap[],
  rates: Partial<Record<OpportunityStage, number>> = {},
): RevenueProjection {
  const effective = (s: OpportunityStage): number => {
    const r = rates[s];
    return typeof r === 'number' ? r : DEFAULT_CONVERSION_RATES[s];
  };

  const byStageMap = new Map<OpportunityStage, { count: number; sumValue: number }>();
  for (const s of STAGE_ORDER_ARR) byStageMap.set(s, { count: 0, sumValue: 0 });
  for (const o of activeOpps) {
    if (o.status !== 'ACTIVE') continue;
    const b = byStageMap.get(o.stage)!;
    b.count += 1;
    b.sumValue += o.estimatedValue;
  }

  let base = 0;
  let best = 0;
  let worst = 0;
  const byStage = STAGE_ORDER_ARR.map((stage) => {
    const { sumValue } = byStageMap.get(stage)!;
    const rate = effective(stage);
    const weightedValue = (sumValue * rate) / 100;
    base += weightedValue;
    best += (sumValue * Math.min(100, rate * 1.2)) / 100;
    worst += (sumValue * rate * 0.7) / 100;
    return { stage, base: sumValue, rate, weightedValue };
  });

  return {
    base: Math.round(base * 100) / 100,
    best: Math.round(best * 100) / 100,
    worst: Math.round(worst * 100) / 100,
    byStage,
  };
}

// ---------- Performance por responsável ----------

export interface OwnerPerformance {
  ownerId: string;
  ownerName: string;
  active: number;
  won: number;
  lost: number;
  wonValue: number;
  winRatePct: number;
}

export interface PerformanceReport {
  rows: OwnerPerformance[];
  teamAverage: {
    active: number;
    won: number;
    winRatePct: number;
    wonValue: number;
  };
}

export function performanceByOwner(opps: OpportunitySnap[]): PerformanceReport {
  const map = new Map<string, OwnerPerformance>();
  for (const o of opps) {
    // Sprint 15D — opps inbound sem owner ainda não contam no ranking.
    if (!o.ownerId) continue;
    const cur = map.get(o.ownerId) ?? {
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      active: 0,
      won: 0,
      lost: 0,
      wonValue: 0,
      winRatePct: 0,
    };
    if (o.status === 'ACTIVE') cur.active += 1;
    if (o.status === 'WON') {
      cur.won += 1;
      cur.wonValue += Number(o.closedValue ?? o.estimatedValue);
    }
    if (o.status === 'LOST') cur.lost += 1;
    map.set(o.ownerId, cur);
  }
  const rows = Array.from(map.values()).map((r) => {
    const decided = r.won + r.lost;
    r.winRatePct = decided === 0 ? 0 : Math.round((r.won / decided) * 1000) / 10;
    return r;
  });
  rows.sort((a, b) => b.wonValue - a.wonValue);

  const n = rows.length || 1;
  const teamAverage = {
    active: Math.round(rows.reduce((s, r) => s + r.active, 0) / n),
    won: Math.round(rows.reduce((s, r) => s + r.won, 0) / n),
    winRatePct: Math.round((rows.reduce((s, r) => s + r.winRatePct, 0) / n) * 10) / 10,
    wonValue: Math.round(rows.reduce((s, r) => s + r.wonValue, 0) / n),
  };
  return { rows, teamAverage };
}
