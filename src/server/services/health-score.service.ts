import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import type { TenantPlan } from '@prisma/client';

/**
 * Tenant Health Score — Sprint 15B.
 *
 * Calcula 8 sinais 0-100, aplica pesos por plano e gera score composto +
 * bucket (GREEN ≥ 70 / YELLOW 40–69 / RED < 40) + razões legíveis.
 *
 * Funções `score*` são puras e exportadas — permitem unit test sem DB.
 * `computeHealthScore(tenantId)` faz a coleta + composição.
 */

export type Bucket = 'GREEN' | 'YELLOW' | 'RED';
export type SignalKey =
  | 'logins'
  | 'oppsCreated'
  | 'featuresUsed'
  | 'nps'
  | 'openTickets'
  | 'trialProgress'
  | 'evaluations'
  | 'resourceUsage';

export interface Signals {
  logins: number | null;
  oppsCreated: number | null;
  featuresUsed: number | null;
  nps: number | null;
  openTickets: number | null;
  trialProgress: number | null;
  evaluations: number | null;
  resourceUsage: number | null;
}

export interface HealthOutput {
  signals: Signals;
  score: number;
  bucket: Bucket;
  reasons: string[];
}

const PLAN_EXPECTED_LOGINS_30D: Record<TenantPlan, number> = {
  TRIAL: 5,
  STARTER: 15,
  PRO: 60,
  ENTERPRISE: 120,
};
const PLAN_EXPECTED_OPPS_MONTH: Record<TenantPlan, number> = {
  TRIAL: 2,
  STARTER: 10,
  PRO: 40,
  ENTERPRISE: 100,
};

export const WEIGHTS_BY_PLAN: Record<TenantPlan, Record<SignalKey, number>> = {
  TRIAL: {
    logins: 3, oppsCreated: 2, featuresUsed: 1, nps: 0,
    openTickets: 1, trialProgress: 3, evaluations: 0, resourceUsage: 1,
  },
  STARTER: {
    logins: 3, oppsCreated: 3, featuresUsed: 1, nps: 1,
    openTickets: 2, trialProgress: 0, evaluations: 1, resourceUsage: 1,
  },
  PRO: {
    logins: 2, oppsCreated: 3, featuresUsed: 2, nps: 2,
    openTickets: 2, trialProgress: 0, evaluations: 1, resourceUsage: 2,
  },
  ENTERPRISE: {
    logins: 1, oppsCreated: 2, featuresUsed: 3, nps: 3,
    openTickets: 2, trialProgress: 0, evaluations: 1, resourceUsage: 2,
  },
};

/** clamp(0, 100) — protege contra inputs absurdos. */
export function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 100 se ≥ esperado, decai linear. Esperado 0 → 100 fixo. */
export function scoreLogins(actual: number, plan: TenantPlan): number {
  const expected = PLAN_EXPECTED_LOGINS_30D[plan];
  if (expected === 0) return 100;
  return clamp((actual / expected) * 100);
}

export function scoreOpps(actual: number, plan: TenantPlan): number {
  const expected = PLAN_EXPECTED_OPPS_MONTH[plan];
  if (expected === 0) return 100;
  return clamp((actual / expected) * 100);
}

export function scoreFeatures(usedCount: number, availableCount: number): number {
  if (availableCount === 0) return 100;
  return clamp((usedCount / availableCount) * 100);
}

export function scoreNps(value: number | null): number | null {
  // NPS varia de -100 a 100; normaliza pra 0-100.
  if (value == null) return null;
  return clamp(((value + 100) / 200) * 100);
}

export function scoreTickets(openLong: number): number {
  // 0 tickets antigos = 100; 5 ou mais = 0; decresce linear.
  return clamp((1 - openLong / 5) * 100);
}

export function scoreTrial(setupPct: number): number {
  return clamp(setupPct);
}

export function scoreEvaluations(count: number): number {
  // Cada avaliação adiciona 20 até 100.
  return clamp(count * 20);
}

export function scoreResources(pctUsed: number): number {
  // Faixa saudável: 30–80%. Fora disso reduz.
  if (pctUsed <= 30) return clamp(pctUsed * 2.5); // sub-utilizado
  if (pctUsed <= 80) return 100;
  if (pctUsed <= 95) return clamp(100 - (pctUsed - 80) * 3);
  return clamp(100 - (pctUsed - 80) * 4); // > 95% = quase no teto
}

export function composeScore(signals: Signals, plan: TenantPlan): number {
  const weights = WEIGHTS_BY_PLAN[plan];
  let weighted = 0;
  let totalWeight = 0;
  for (const k of Object.keys(weights) as SignalKey[]) {
    const value = signals[k];
    if (value === null || value === undefined) continue;
    weighted += value * weights[k];
    totalWeight += weights[k];
  }
  if (totalWeight === 0) return 0;
  return clamp(weighted / totalWeight);
}

export function bucketFor(score: number): Bucket {
  if (score >= 70) return 'GREEN';
  if (score >= 40) return 'YELLOW';
  return 'RED';
}

export function collectReasons(signals: Signals, plan: TenantPlan): string[] {
  const reasons: string[] = [];
  if (signals.logins !== null && signals.logins < 40) {
    reasons.push('Equipe pouco ativa nos últimos 30 dias');
  }
  if (signals.oppsCreated !== null && signals.oppsCreated < 30) {
    reasons.push('Volume de oportunidades abaixo do esperado para o plano');
  }
  if (signals.featuresUsed !== null && signals.featuresUsed < 30) {
    reasons.push('Poucas features de IA em uso');
  }
  if (signals.openTickets !== null && signals.openTickets < 40) {
    reasons.push('Tickets antigos abertos no suporte');
  }
  if (signals.resourceUsage !== null && signals.resourceUsage < 30) {
    reasons.push('Pouco uso da capacidade contratada');
  }
  if (signals.trialProgress !== null && signals.trialProgress < 50 && plan === 'TRIAL') {
    reasons.push('Onboarding incompleto durante o trial');
  }
  if (signals.nps !== null && signals.nps < 40) {
    reasons.push('NPS baixo no último ciclo');
  }
  return reasons;
}

/**
 * Coleta os 8 sinais reais e calcula o score. Usado pelo worker
 * `health-score-rollup` e pelas procedures de leitura.
 */
export async function computeHealthScore(tenantId: string): Promise<HealthOutput> {
  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, setupCompletedAt: true, trialEndsAt: true },
    });
    if (!tenant) {
      throw new Error('Tenant não encontrado');
    }

    const since30d = new Date(Date.now() - 30 * 86_400_000);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [loginsCount, oppsCount, featuresEnabled, openTickets, usageSnapshot, activeFeaturesTotal] =
      await Promise.all([
        prisma.userAccessLog.count({
          where: { tenantId, at: { gte: since30d } },
        }),
        prisma.opportunity.count({
          where: { tenantId, createdAt: { gte: monthStart }, deletedAt: null },
        }),
        prisma.tenantAiFeature.count({
          where: { tenantId, status: { in: ['INCLUDED', 'ADDON_ACTIVE'] } },
        }),
        prisma.dataSubjectRequest.count({
          where: {
            tenantId,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
            submittedAt: { lt: new Date(Date.now() - 7 * 86_400_000) },
          },
        }),
        prisma.usageSnapshot.findFirst({
          where: { tenantId },
          orderBy: { capturedAt: 'desc' },
        }),
        prisma.aiFeature.count({ where: { active: true } }),
      ]);

    // Trial progress: usa setupCompletedAt para 100, senão tempo decorrido vs total
    let trialProgress: number | null = null;
    if (tenant.plan === 'TRIAL' && tenant.trialEndsAt) {
      if (tenant.setupCompletedAt) {
        trialProgress = 100;
      } else {
        // Heurística mínima — sem ConfigChecklist completo
        trialProgress = 30;
      }
    }

    const signals: Signals = {
      logins: scoreLogins(loginsCount, tenant.plan),
      oppsCreated: scoreOpps(oppsCount, tenant.plan),
      featuresUsed: scoreFeatures(featuresEnabled, activeFeaturesTotal),
      nps: null,
      openTickets: scoreTickets(openTickets),
      trialProgress,
      evaluations: null,
      resourceUsage: usageSnapshot ? scoreResources(Math.min(80, Number(usageSnapshot.aiTokensMonth) / 50)) : null,
    };

    const score = composeScore(signals, tenant.plan);
    const bucket = bucketFor(score);
    const reasons = collectReasons(signals, tenant.plan);
    return { signals, score, bucket, reasons };
  });
}
