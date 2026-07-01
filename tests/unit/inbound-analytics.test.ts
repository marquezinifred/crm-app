import { describe, it, expect } from 'vitest';
import {
  computeInboundFunnel,
  compareConversionRates,
  averageTicketByOrigin,
  averageCycleTime,
  type InboundOpSnap,
} from '@/server/services/inbound-analytics.service';

const mkOpp = (over: Partial<InboundOpSnap>): InboundOpSnap => ({
  id: 'id',
  isInbound: false,
  stage: 'PROSPECT',
  status: 'ACTIVE',
  estimatedValue: 1000,
  closedValue: null,
  createdAt: new Date('2026-01-01'),
  actualCloseDate: null,
  ...over,
});

describe('inbound-analytics — computeInboundFunnel', () => {
  it('conta count/value por origem em cada estágio', () => {
    const opps = [
      mkOpp({ isInbound: true, stage: 'PROSPECT', estimatedValue: 500 }),
      mkOpp({ isInbound: true, stage: 'PROSPECT', estimatedValue: 300 }),
      mkOpp({ isInbound: true, stage: 'LEAD', estimatedValue: 700 }),
      mkOpp({ isInbound: false, stage: 'PROSPECT', estimatedValue: 1000 }),
      mkOpp({ isInbound: false, stage: 'PROPOSTA', estimatedValue: 2000 }),
    ];
    const funnel = computeInboundFunnel(opps);
    const prospect = funnel.find((f) => f.stage === 'PROSPECT')!;
    expect(prospect.inboundCount).toBe(2);
    expect(prospect.inboundValue).toBe(800);
    expect(prospect.outboundCount).toBe(1);
    expect(prospect.outboundValue).toBe(1000);
    const lead = funnel.find((f) => f.stage === 'LEAD')!;
    expect(lead.inboundCount).toBe(1);
    expect(lead.outboundCount).toBe(0);
  });

  it('ignora opps fechadas (WON/LOST/CANCELLED)', () => {
    const opps = [
      mkOpp({ isInbound: true, stage: 'PROSPECT', status: 'WON' }),
      mkOpp({ isInbound: false, stage: 'PROSPECT', status: 'ACTIVE' }),
    ];
    const funnel = computeInboundFunnel(opps);
    const prospect = funnel.find((f) => f.stage === 'PROSPECT')!;
    expect(prospect.inboundCount).toBe(0);
    expect(prospect.outboundCount).toBe(1);
  });

  it('retorna todos os 7 estágios mesmo quando vazios', () => {
    const funnel = computeInboundFunnel([]);
    expect(funnel).toHaveLength(7);
    expect(funnel.every((f) => f.inboundCount === 0 && f.outboundCount === 0)).toBe(true);
  });
});

describe('inbound-analytics — compareConversionRates', () => {
  it('calcula winRate como won / (won + lost) por origem', () => {
    const opps = [
      // Inbound: 3 WON, 1 LOST, 2 ACTIVE = 75% winRate
      mkOpp({ isInbound: true, status: 'WON' }),
      mkOpp({ isInbound: true, status: 'WON' }),
      mkOpp({ isInbound: true, status: 'WON' }),
      mkOpp({ isInbound: true, status: 'LOST' }),
      mkOpp({ isInbound: true, status: 'ACTIVE' }),
      mkOpp({ isInbound: true, status: 'ACTIVE' }),
      // Outbound: 1 WON, 3 LOST = 25% winRate
      mkOpp({ isInbound: false, status: 'WON' }),
      mkOpp({ isInbound: false, status: 'LOST' }),
      mkOpp({ isInbound: false, status: 'LOST' }),
      mkOpp({ isInbound: false, status: 'LOST' }),
    ];
    const { inbound, outbound } = compareConversionRates(opps);
    expect(inbound.won).toBe(3);
    expect(inbound.lost).toBe(1);
    expect(inbound.prospects).toBe(6);
    expect(inbound.winRatePct).toBe(75);
    expect(outbound.won).toBe(1);
    expect(outbound.lost).toBe(3);
    expect(outbound.winRatePct).toBe(25);
  });

  it('winRate = 0 quando nenhuma decidida', () => {
    const opps = [
      mkOpp({ isInbound: true, status: 'ACTIVE' }),
      mkOpp({ isInbound: false, status: 'ACTIVE' }),
    ];
    const { inbound, outbound } = compareConversionRates(opps);
    expect(inbound.winRatePct).toBe(0);
    expect(outbound.winRatePct).toBe(0);
  });
});

describe('inbound-analytics — averageTicketByOrigin', () => {
  it('usa closedValue quando WON tem, senão estimatedValue', () => {
    const opps = [
      mkOpp({ isInbound: true, status: 'WON', estimatedValue: 100, closedValue: 90 }),
      mkOpp({ isInbound: true, status: 'WON', estimatedValue: 300, closedValue: null }),
      mkOpp({ isInbound: false, status: 'WON', estimatedValue: 500, closedValue: 550 }),
    ];
    const t = averageTicketByOrigin(opps);
    // Inbound: (90 + 300) / 2 = 195
    expect(t.inboundAvgBrl).toBe(195);
    expect(t.inboundCount).toBe(2);
    // Outbound: 550 / 1 = 550
    expect(t.outboundAvgBrl).toBe(550);
    expect(t.outboundCount).toBe(1);
  });

  it('só considera status=WON', () => {
    const opps = [
      mkOpp({ isInbound: true, status: 'LOST', estimatedValue: 1000 }),
      mkOpp({ isInbound: true, status: 'ACTIVE', estimatedValue: 2000 }),
    ];
    const t = averageTicketByOrigin(opps);
    expect(t.inboundCount).toBe(0);
    expect(t.inboundAvgBrl).toBe(0);
  });
});

describe('inbound-analytics — averageCycleTime', () => {
  it('calcula dias entre createdAt e actualCloseDate', () => {
    const opps = [
      mkOpp({
        isInbound: true,
        status: 'WON',
        createdAt: new Date('2026-01-01'),
        actualCloseDate: new Date('2026-01-11'), // 10 dias
      }),
      mkOpp({
        isInbound: true,
        status: 'WON',
        createdAt: new Date('2026-01-01'),
        actualCloseDate: new Date('2026-01-21'), // 20 dias
      }),
      mkOpp({
        isInbound: false,
        status: 'LOST',
        createdAt: new Date('2026-01-01'),
        actualCloseDate: new Date('2026-04-01'), // 90 dias
      }),
    ];
    const c = averageCycleTime(opps);
    expect(c.inboundAvgDays).toBe(15); // (10 + 20) / 2
    expect(c.inboundCount).toBe(2);
    expect(c.outboundAvgDays).toBe(90);
    expect(c.outboundCount).toBe(1);
  });

  it('retorna null quando sem opps fechadas', () => {
    const opps = [
      mkOpp({ isInbound: true, status: 'ACTIVE', actualCloseDate: null }),
    ];
    const c = averageCycleTime(opps);
    expect(c.inboundAvgDays).toBeNull();
    expect(c.outboundAvgDays).toBeNull();
  });

  it('não conta days negativos (edge case data close antes de create)', () => {
    const opps = [
      mkOpp({
        isInbound: true,
        status: 'WON',
        createdAt: new Date('2026-01-10'),
        actualCloseDate: new Date('2026-01-01'), // 9 dias negativos → clamped em 0
      }),
    ];
    const c = averageCycleTime(opps);
    expect(c.inboundAvgDays).toBe(0);
  });
});
