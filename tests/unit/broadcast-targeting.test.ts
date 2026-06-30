import { describe, it, expect } from 'vitest';
import {
  matchesTargeting,
  isWithinWindow,
} from '@/server/services/broadcast.service';

const TENANT = { id: 't1', plan: 'PRO' as const };

describe('Broadcast targeting', () => {
  it('ALL pega todo mundo', () => {
    expect(
      matchesTargeting(
        { target: 'ALL', targetPlans: [], targetTenantIds: [] },
        TENANT,
      ),
    ).toBe(true);
  });

  it('BY_PLAN pega só se o plano match', () => {
    expect(
      matchesTargeting(
        { target: 'BY_PLAN', targetPlans: ['PRO', 'ENTERPRISE'], targetTenantIds: [] },
        TENANT,
      ),
    ).toBe(true);
    expect(
      matchesTargeting(
        { target: 'BY_PLAN', targetPlans: ['STARTER'], targetTenantIds: [] },
        TENANT,
      ),
    ).toBe(false);
  });

  it('MANUAL_LIST pega só se o tenant.id está no array', () => {
    expect(
      matchesTargeting(
        { target: 'MANUAL_LIST', targetPlans: [], targetTenantIds: ['t1', 't9'] },
        TENANT,
      ),
    ).toBe(true);
    expect(
      matchesTargeting(
        { target: 'MANUAL_LIST', targetPlans: [], targetTenantIds: ['t2'] },
        TENANT,
      ),
    ).toBe(false);
  });
});

describe('Broadcast window', () => {
  const now = new Date('2026-08-01T12:00:00Z');

  it('antes do starts_at → fora', () => {
    expect(
      isWithinWindow(
        { startsAt: new Date('2026-08-02T00:00:00Z'), endsAt: null, active: true },
        now,
      ),
    ).toBe(false);
  });

  it('depois do ends_at → fora', () => {
    expect(
      isWithinWindow(
        { startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-30'), active: true },
        now,
      ),
    ).toBe(false);
  });

  it('inactive → fora mesmo na janela', () => {
    expect(
      isWithinWindow(
        { startsAt: new Date('2026-07-01'), endsAt: new Date('2026-08-30'), active: false },
        now,
      ),
    ).toBe(false);
  });

  it('janela aberta + active → dentro', () => {
    expect(
      isWithinWindow(
        { startsAt: new Date('2026-07-01'), endsAt: null, active: true },
        now,
      ),
    ).toBe(true);
  });
});
