import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, limitsFor, checkUsage } from '@/lib/billing/plan-limits';

describe('plan limits', () => {
  it('TRIAL é o mais restrito', () => {
    expect(PLAN_LIMITS.TRIAL.maxUsers).toBeLessThan(PLAN_LIMITS.STARTER.maxUsers);
    expect(PLAN_LIMITS.STARTER.maxCompanies).toBeLessThan(PLAN_LIMITS.PRO.maxCompanies);
  });

  it('ENTERPRISE tem limites infinitos e todas features ligadas', () => {
    expect(PLAN_LIMITS.ENTERPRISE.maxUsers).toBe(Number.POSITIVE_INFINITY);
    expect(PLAN_LIMITS.ENTERPRISE.features.hidePoweredBy).toBe(true);
    expect(PLAN_LIMITS.ENTERPRISE.features.overrideWcag).toBe(true);
  });

  it('hidePoweredBy só em Enterprise', () => {
    expect(PLAN_LIMITS.TRIAL.features.hidePoweredBy).toBe(false);
    expect(PLAN_LIMITS.STARTER.features.hidePoweredBy).toBe(false);
    expect(PLAN_LIMITS.PRO.features.hidePoweredBy).toBe(false);
    expect(PLAN_LIMITS.ENTERPRISE.features.hidePoweredBy).toBe(true);
  });

  it('limitsFor é equivalente a indexar PLAN_LIMITS', () => {
    expect(limitsFor('PRO')).toBe(PLAN_LIMITS.PRO);
  });

  it('checkUsage detecta exceeded', () => {
    expect(checkUsage(10, 10).exceeded).toBe(true);
    expect(checkUsage(11, 10).exceeded).toBe(true);
    expect(checkUsage(9, 10).exceeded).toBe(false);
  });

  it('checkUsage retorna pct entre 0 e 1', () => {
    expect(checkUsage(5, 10).pct).toBe(0.5);
    expect(checkUsage(100, 10).pct).toBe(1);
  });

  it('checkUsage com Infinity nunca excede', () => {
    expect(checkUsage(1_000_000, Number.POSITIVE_INFINITY).exceeded).toBe(false);
    expect(checkUsage(1_000_000, Number.POSITIVE_INFINITY).pct).toBe(0);
  });
});
