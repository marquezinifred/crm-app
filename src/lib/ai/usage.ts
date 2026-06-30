import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';

/**
 * Helpers de uso corrente de IA — Sprint 15B.
 *
 * Lê `ai_usage_logs` (Sprint 4) em janelas mês/dia para o guard
 * `callAiFeature` (limites por tenant).
 */

export interface MonthlyUsage {
  tokens: number;
  costUsd: number;
  requests: number;
}

export async function getCurrentMonthUsage(tenantId: string): Promise<MonthlyUsage> {
  const first = new Date();
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  return runAsSystem(async () => {
    const agg = await prisma.aIUsageLog.aggregate({
      where: { tenantId, createdAt: { gte: first } },
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
    });
    return {
      tokens: agg._sum.totalTokens ?? 0,
      costUsd: Number(agg._sum.costUsd ?? 0),
      requests: agg._count._all,
    };
  });
}

export async function getTodayRequests(tenantId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return runAsSystem(async () => {
    return prisma.aIUsageLog.count({
      where: { tenantId, createdAt: { gte: start } },
    });
  });
}
