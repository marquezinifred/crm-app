import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { Prisma } from '@prisma/client';

/**
 * Coleta uso corrente do tenant — Sprint 12.
 *
 * Usado para:
 *   - enforcement em runtime (compara contra plan-limits)
 *   - snapshot diário pelo worker (UsageSnapshot)
 *   - UI /admin/billing (gráficos)
 */

export interface CurrentUsage {
  userCount: number;
  companyCount: number;
  contactCount: number;
  opportunityCount: number;
  storageBytes: bigint;
  aiTokensMonth: number;
  aiCostCentsMonth: number;
}

export async function collectCurrentUsage(tenantId: string): Promise<CurrentUsage> {
  return runAsSystem(async () => {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const [users, companies, contacts, opps, ai, storage] = await Promise.all([
      prisma.user.count({ where: { tenantId, deletedAt: null, active: true } }),
      prisma.company.count({ where: { tenantId, deletedAt: null } }),
      prisma.contact.count({ where: { tenantId, deletedAt: null } }),
      prisma.opportunity.count({ where: { tenantId, deletedAt: null } }),
      prisma.aIUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: firstOfMonth } },
        _sum: { totalTokens: true, costUsd: true },
      }),
      prisma.documentVersion.aggregate({
        where: { tenantId },
        _sum: { sizeBytes: true },
      }),
    ]);

    return {
      userCount: users,
      companyCount: companies,
      contactCount: contacts,
      opportunityCount: opps,
      storageBytes: BigInt(storage._sum.sizeBytes ?? 0),
      aiTokensMonth: ai._sum.totalTokens ?? 0,
      aiCostCentsMonth: Math.round(Number(ai._sum.costUsd ?? 0) * 100),
    };
  });
}

export async function takeSnapshot(tenantId: string) {
  const u = await collectCurrentUsage(tenantId);
  return runAsSystem(() =>
    prisma.usageSnapshot.create({
      data: {
        tenantId,
        userCount: u.userCount,
        companyCount: u.companyCount,
        contactCount: u.contactCount,
        opportunityCount: u.opportunityCount,
        storageBytes: u.storageBytes,
        aiTokensMonth: u.aiTokensMonth,
        aiCostCentsMonth: u.aiCostCentsMonth,
      } as Prisma.UsageSnapshotUncheckedCreateInput,
    }),
  );
}
