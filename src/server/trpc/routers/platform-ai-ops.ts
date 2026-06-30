import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, platformProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { platformAudit } from '@/server/services/audit-platform.service';
import { zUuid } from '@/lib/validators';
import { usdToBrlWithMargin } from '@/lib/ai/pricing';

export const platformAiOpsRouter = router({
  summary: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [byProvider, anomalies, topTenants] = await Promise.all([
        prisma.aIUsageLog.groupBy({
          by: ['provider'],
          where: { createdAt: { gte: monthStart } },
          _sum: { totalTokens: true, costUsd: true },
          _count: { _all: true },
        }),
        prisma.aiAnomalyAlert.findMany({
          where: { acknowledgedAt: null },
          orderBy: { detectedAt: 'desc' },
          take: 20,
          include: { tenant: { select: { name: true, slug: true } } },
        }),
        prisma.aIUsageLog.groupBy({
          by: ['tenantId'],
          where: { createdAt: { gte: monthStart } },
          _sum: { totalTokens: true, costUsd: true },
          orderBy: { _sum: { totalTokens: 'desc' } },
          take: 10,
        }),
      ]);

      const topTenantIds = topTenants.map((t) => t.tenantId);
      const topTenantNames = topTenantIds.length
        ? await prisma.tenant.findMany({
            where: { id: { in: topTenantIds } },
            select: { id: true, name: true, slug: true, plan: true },
          })
        : [];
      const nameMap = new Map(topTenantNames.map((t) => [t.id, t]));

      return {
        byProvider: byProvider.map((p) => ({
          provider: p.provider,
          tokens: p._sum.totalTokens ?? 0,
          requests: p._count._all,
          costBrl: usdToBrlWithMargin(Number(p._sum.costUsd ?? 0)),
        })),
        anomalies,
        topTenants: topTenants.map((t) => ({
          tenantId: t.tenantId,
          tokens: t._sum.totalTokens ?? 0,
          costBrl: usdToBrlWithMargin(Number(t._sum.costUsd ?? 0)),
          tenant: nameMap.get(t.tenantId),
        })),
      };
    }),
  ),

  byTenant: platformProcedure
    .input(z.object({ id: zUuid }))
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const [limits, monthly, byProviderModel, recentDaily, anomalies] = await Promise.all([
          prisma.tenantAiLimits.findUnique({ where: { tenantId: input.id } }),
          prisma.aIUsageLog.aggregate({
            where: { tenantId: input.id, createdAt: { gte: monthStart } },
            _sum: { totalTokens: true, costUsd: true },
            _count: { _all: true },
          }),
          prisma.aIUsageLog.groupBy({
            by: ['provider', 'model'],
            where: { tenantId: input.id, createdAt: { gte: monthStart } },
            _sum: { totalTokens: true, costUsd: true },
            _count: { _all: true },
          }),
          prisma.aiUsageDaily.findMany({
            where: { tenantId: input.id },
            orderBy: { date: 'desc' },
            take: 90,
          }),
          prisma.aiAnomalyAlert.findMany({
            where: { tenantId: input.id },
            orderBy: { detectedAt: 'desc' },
            take: 20,
          }),
        ]);
        return {
          limits,
          monthlyUsage: {
            tokens: monthly._sum.totalTokens ?? 0,
            costBrl: usdToBrlWithMargin(Number(monthly._sum.costUsd ?? 0)),
            requests: monthly._count._all,
          },
          breakdown: byProviderModel.map((g) => ({
            provider: g.provider,
            model: g.model,
            tokens: g._sum.totalTokens ?? 0,
            requests: g._count._all,
            costBrl: usdToBrlWithMargin(Number(g._sum.costUsd ?? 0)),
          })),
          recentDaily,
          anomalies,
        };
      }),
    ),

  setLimits: platformProcedure
    .input(
      z.object({
        tenantId: zUuid,
        monthlyTokenLimit: z.number().int().positive().nullable(),
        dailyRequestLimit: z.number().int().positive().nullable(),
        pinnedModelHaiku: z.string().max(120).nullable(),
        pinnedModelSonnet: z.string().max(120).nullable(),
        anomalyThresholdMultiplier: z.number().min(1).max(20).default(3.0),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const updated = await prisma.tenantAiLimits.upsert({
          where: { tenantId: input.tenantId },
          create: {
            tenantId: input.tenantId,
            monthlyTokenLimit: input.monthlyTokenLimit ?? null,
            dailyRequestLimit: input.dailyRequestLimit ?? null,
            pinnedModelHaiku: input.pinnedModelHaiku,
            pinnedModelSonnet: input.pinnedModelSonnet,
            anomalyThresholdMultiplier: input.anomalyThresholdMultiplier,
            updatedById: ctx.platformUser.id,
          },
          update: {
            monthlyTokenLimit: input.monthlyTokenLimit ?? null,
            dailyRequestLimit: input.dailyRequestLimit ?? null,
            pinnedModelHaiku: input.pinnedModelHaiku,
            pinnedModelSonnet: input.pinnedModelSonnet,
            anomalyThresholdMultiplier: input.anomalyThresholdMultiplier,
            updatedById: ctx.platformUser.id,
          },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.aiOps.setLimits',
          tableName: 'tenant_ai_limits',
          recordId: input.tenantId,
          tenantIdOverride: input.tenantId,
          after: updated,
        });
        return updated;
      }),
    ),

  acknowledgeAlert: platformProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const alert = await prisma.aiAnomalyAlert.findUnique({ where: { id: input.id } });
        if (!alert) throw new TRPCError({ code: 'NOT_FOUND' });
        await prisma.aiAnomalyAlert.update({
          where: { id: input.id },
          data: {
            acknowledgedAt: new Date(),
            acknowledgedById: ctx.platformUser.id,
          },
        });
        return { ok: true };
      }),
    ),
});
