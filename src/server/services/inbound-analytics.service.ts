import type { OpportunityStage, OpportunityStatus } from '@prisma/client';

/**
 * Sprint 15D — Analytics comparativo inbound vs outbound.
 *
 * Funções puras que aceitam OppSnap[] (subset de OpportunitySnap com
 * isInbound) e devolvem métricas. Testável sem DB — a leitura vive no
 * router reports.
 */

export interface InboundOpSnap {
  id: string;
  isInbound: boolean;
  stage: OpportunityStage;
  status: OpportunityStatus;
  estimatedValue: number;
  closedValue: number | null;
  createdAt: Date;
  actualCloseDate: Date | null;
}

export interface FunnelStageBucket {
  stage: OpportunityStage;
  inboundCount: number;
  outboundCount: number;
  inboundValue: number;
  outboundValue: number;
}

const STAGES: OpportunityStage[] = [
  'PROSPECT',
  'LEAD',
  'OPORTUNIDADE',
  'PROPOSTA',
  'NEGOCIACAO',
  'ACEITE',
  'CONTRATO',
];

/**
 * Funil comparativo — count e sumValue por estágio × origem.
 * Considera apenas opps ACTIVE. Ordem STAGES é a canônica do enum.
 */
export function computeInboundFunnel(opps: InboundOpSnap[]): FunnelStageBucket[] {
  const active = opps.filter((o) => o.status === 'ACTIVE');
  const buckets: FunnelStageBucket[] = STAGES.map((stage) => ({
    stage,
    inboundCount: 0,
    outboundCount: 0,
    inboundValue: 0,
    outboundValue: 0,
  }));
  for (const o of active) {
    const b = buckets.find((x) => x.stage === o.stage);
    if (!b) continue;
    if (o.isInbound) {
      b.inboundCount += 1;
      b.inboundValue += o.estimatedValue;
    } else {
      b.outboundCount += 1;
      b.outboundValue += o.estimatedValue;
    }
  }
  return buckets;
}

export interface ConversionRateSummary {
  inbound: {
    prospects: number;
    won: number;
    lost: number;
    winRatePct: number;
  };
  outbound: {
    prospects: number;
    won: number;
    lost: number;
    winRatePct: number;
  };
}

/**
 * Conversion rate por origem — WON / (WON + LOST). Retorna 0 quando
 * não há decidido. Prospects = todos (ACTIVE + WON + LOST + CANCELLED).
 */
export function compareConversionRates(opps: InboundOpSnap[]): ConversionRateSummary {
  const inb = opps.filter((o) => o.isInbound);
  const out = opps.filter((o) => !o.isInbound);
  const summarize = (list: InboundOpSnap[]) => {
    const won = list.filter((o) => o.status === 'WON').length;
    const lost = list.filter((o) => o.status === 'LOST').length;
    const decided = won + lost;
    return {
      prospects: list.length,
      won,
      lost,
      winRatePct: decided === 0 ? 0 : Math.round((won / decided) * 1000) / 10,
    };
  };
  return { inbound: summarize(inb), outbound: summarize(out) };
}

export interface TicketByOrigin {
  inboundAvgBrl: number;
  outboundAvgBrl: number;
  inboundCount: number;
  outboundCount: number;
}

/**
 * Ticket médio final — usa closedValue quando WON, senão estimatedValue.
 * Filtra apenas opps decididas (WON).
 */
export function averageTicketByOrigin(opps: InboundOpSnap[]): TicketByOrigin {
  const won = opps.filter((o) => o.status === 'WON');
  const inbWon = won.filter((o) => o.isInbound);
  const outWon = won.filter((o) => !o.isInbound);
  const avg = (list: InboundOpSnap[]) => {
    if (list.length === 0) return 0;
    const sum = list.reduce(
      (acc, o) => acc + Number(o.closedValue ?? o.estimatedValue),
      0,
    );
    return Math.round(sum / list.length);
  };
  return {
    inboundAvgBrl: avg(inbWon),
    outboundAvgBrl: avg(outWon),
    inboundCount: inbWon.length,
    outboundCount: outWon.length,
  };
}

export interface CycleTimeByOrigin {
  inboundAvgDays: number | null;
  outboundAvgDays: number | null;
  inboundCount: number;
  outboundCount: number;
}

/**
 * Cycle time médio — dias entre createdAt e actualCloseDate. Considera
 * apenas opps com actualCloseDate preenchido (WON ou LOST fechado).
 * Retorna null quando sem dados suficientes (evita "0 dias" enganoso).
 */
export function averageCycleTime(opps: InboundOpSnap[]): CycleTimeByOrigin {
  const closed = opps.filter(
    (o) =>
      o.actualCloseDate instanceof Date && (o.status === 'WON' || o.status === 'LOST'),
  );
  const calc = (list: InboundOpSnap[]) => {
    if (list.length === 0) return null;
    const totalDays = list.reduce((acc, o) => {
      const closeAt = o.actualCloseDate!;
      const days = Math.round((closeAt.getTime() - o.createdAt.getTime()) / 86_400_000);
      return acc + Math.max(0, days);
    }, 0);
    return Math.round(totalDays / list.length);
  };
  const inbClosed = closed.filter((o) => o.isInbound);
  const outClosed = closed.filter((o) => !o.isInbound);
  return {
    inboundAvgDays: calc(inbClosed),
    outboundAvgDays: calc(outClosed),
    inboundCount: inbClosed.length,
    outboundCount: outClosed.length,
  };
}

export const _internal = { STAGES };
