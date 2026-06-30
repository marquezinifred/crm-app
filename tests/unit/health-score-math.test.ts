import { describe, it, expect } from 'vitest';
import {
  scoreLogins,
  scoreOpps,
  scoreFeatures,
  scoreNps,
  scoreTickets,
  scoreTrial,
  scoreEvaluations,
  scoreResources,
  composeScore,
  bucketFor,
  collectReasons,
  clamp,
  WEIGHTS_BY_PLAN,
} from '@/server/services/health-score.service';

describe('Health score — individual signals', () => {
  it('scoreLogins escala com expected do plano', () => {
    expect(scoreLogins(0, 'PRO')).toBe(0);
    expect(scoreLogins(60, 'PRO')).toBe(100);
    expect(scoreLogins(30, 'PRO')).toBe(50);
    expect(scoreLogins(120, 'PRO')).toBe(100); // capped
  });

  it('scoreOpps escala com expected do plano', () => {
    expect(scoreOpps(0, 'STARTER')).toBe(0);
    expect(scoreOpps(5, 'STARTER')).toBe(50);
    expect(scoreOpps(10, 'STARTER')).toBe(100);
  });

  it('scoreFeatures é ratio com cap em 100', () => {
    expect(scoreFeatures(0, 5)).toBe(0);
    expect(scoreFeatures(5, 5)).toBe(100);
    expect(scoreFeatures(2, 4)).toBe(50);
    expect(scoreFeatures(3, 0)).toBe(100); // sem features = 100
  });

  it('scoreNps normaliza -100..100 → 0..100', () => {
    expect(scoreNps(-100)).toBe(0);
    expect(scoreNps(0)).toBe(50);
    expect(scoreNps(100)).toBe(100);
    expect(scoreNps(null)).toBe(null);
  });

  it('scoreTickets decresce com nº de tickets antigos', () => {
    expect(scoreTickets(0)).toBe(100);
    expect(scoreTickets(2)).toBe(60);
    expect(scoreTickets(5)).toBe(0);
    expect(scoreTickets(10)).toBe(0); // clamped
  });

  it('scoreTrial usa setupPct direto', () => {
    expect(scoreTrial(33)).toBe(33);
    expect(scoreTrial(100)).toBe(100);
  });

  it('scoreEvaluations cresce com count, cap 100', () => {
    expect(scoreEvaluations(0)).toBe(0);
    expect(scoreEvaluations(3)).toBe(60);
    expect(scoreEvaluations(10)).toBe(100); // cap
  });

  it('scoreResources favorece faixa 30–80%', () => {
    expect(scoreResources(50)).toBe(100);
    expect(scoreResources(30)).toBe(75);
    expect(scoreResources(85)).toBe(85);
    expect(scoreResources(100)).toBe(20);
  });

  it('clamp 0..100', () => {
    expect(clamp(-50)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(42.7)).toBe(43);
    expect(clamp(Number.NaN)).toBe(0);
  });
});

describe('Health score — composição', () => {
  it('composeScore pondera por plano', () => {
    const signals = {
      logins: 60, oppsCreated: 80, featuresUsed: 100, nps: null,
      openTickets: 100, trialProgress: null, evaluations: null, resourceUsage: 50,
    };
    const proScore = composeScore(signals, 'PRO');
    expect(proScore).toBeGreaterThan(60);
    expect(proScore).toBeLessThan(100);
  });

  it('bucketFor segue thresholds da spec', () => {
    expect(bucketFor(85)).toBe('GREEN');
    expect(bucketFor(70)).toBe('GREEN');
    expect(bucketFor(55)).toBe('YELLOW');
    expect(bucketFor(40)).toBe('YELLOW');
    expect(bucketFor(30)).toBe('RED');
    expect(bucketFor(0)).toBe('RED');
  });

  it('WEIGHTS_BY_PLAN soma > 0 em todos os planos', () => {
    for (const plan of ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const) {
      const sum = Object.values(WEIGHTS_BY_PLAN[plan]).reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('collectReasons explica RED', () => {
    const reasons = collectReasons(
      {
        logins: 20, oppsCreated: 20, featuresUsed: 20, nps: null,
        openTickets: 20, trialProgress: null, evaluations: null, resourceUsage: 20,
      },
      'PRO',
    );
    expect(reasons.length).toBeGreaterThan(0);
  });
});
