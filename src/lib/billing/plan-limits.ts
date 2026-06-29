import type { TenantPlan } from '@prisma/client';

/**
 * Limites por plano — Sprint 12.
 *
 * Soft limits: enforcement em UI (banner amarelo "82% do limite").
 * Hard limits: bloqueio server-side (tRPC mutation que cria recurso retorna
 * FORBIDDEN com mensagem de upgrade).
 *
 * Valores podem ser ajustados sem migration — não persistimos no banco.
 */

export interface PlanLimits {
  maxUsers: number;
  maxCompanies: number;
  maxContacts: number;
  maxStorageBytes: number;
  maxAiTokensMonth: number;
  features: {
    customBranding: boolean;
    overrideWcag: boolean;
    apiAccess: boolean;
    hidePoweredBy: boolean;
    advancedReports: boolean;
    benchmarks: boolean;
  };
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  TRIAL: {
    maxUsers: 3,
    maxCompanies: 50,
    maxContacts: 200,
    maxStorageBytes: 100 * MB,
    maxAiTokensMonth: 50_000,
    features: {
      customBranding: false,
      overrideWcag: false,
      apiAccess: false,
      hidePoweredBy: false,
      advancedReports: false,
      benchmarks: false,
    },
  },
  STARTER: {
    maxUsers: 10,
    maxCompanies: 500,
    maxContacts: 2_000,
    maxStorageBytes: 1 * GB,
    maxAiTokensMonth: 500_000,
    features: {
      customBranding: false,
      overrideWcag: false,
      apiAccess: false,
      hidePoweredBy: false,
      advancedReports: false,
      benchmarks: false,
    },
  },
  PRO: {
    maxUsers: 50,
    maxCompanies: 5_000,
    maxContacts: 25_000,
    maxStorageBytes: 25 * GB,
    maxAiTokensMonth: 5_000_000,
    features: {
      customBranding: true,
      overrideWcag: false,
      apiAccess: true,
      hidePoweredBy: false,
      advancedReports: true,
      benchmarks: true,
    },
  },
  ENTERPRISE: {
    maxUsers: Number.POSITIVE_INFINITY,
    maxCompanies: Number.POSITIVE_INFINITY,
    maxContacts: Number.POSITIVE_INFINITY,
    maxStorageBytes: Number.POSITIVE_INFINITY,
    maxAiTokensMonth: Number.POSITIVE_INFINITY,
    features: {
      customBranding: true,
      overrideWcag: true,
      apiAccess: true,
      hidePoweredBy: true,
      advancedReports: true,
      benchmarks: true,
    },
  },
};

export function limitsFor(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export interface UsageCheck {
  exceeded: boolean;
  pct: number; // 0..1
  current: number;
  limit: number;
}

export function checkUsage(current: number, limit: number): UsageCheck {
  if (limit === Number.POSITIVE_INFINITY) {
    return { exceeded: false, pct: 0, current, limit };
  }
  return {
    exceeded: current >= limit,
    pct: Math.min(1, current / limit),
    current,
    limit,
  };
}
