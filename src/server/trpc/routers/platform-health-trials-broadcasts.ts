import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, platformProcedure, protectedProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { platformAudit } from '@/server/services/audit-platform.service';
import { zUuid } from '@/lib/validators';
import { BroadcastTarget, BroadcastVariant, Prisma, TenantPlan } from '@prisma/client';
import {
  activeForUser,
  dismissForUser,
  previewTargeting,
} from '@/server/services/broadcast.service';

export const platformHealthRouter = router({
  today: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const snapshots = await prisma.tenantHealthSnapshot.findMany({
        where: { date: today },
        include: { tenant: { select: { id: true, name: true, slug: true, plan: true } } },
        orderBy: { healthScore: 'asc' },
      });
      const byBucket = {
        RED: snapshots.filter((s) => s.bucket === 'RED'),
        YELLOW: snapshots.filter((s) => s.bucket === 'YELLOW'),
        GREEN: snapshots.filter((s) => s.bucket === 'GREEN'),
      };
      return { snapshots, byBucket };
    }),
  ),
  byTenant: platformProcedure
    .input(z.object({ tenantId: zUuid, days: z.number().int().min(7).max(180).default(90) }))
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const since = new Date();
        since.setDate(since.getDate() - input.days);
        return prisma.tenantHealthSnapshot.findMany({
          where: { tenantId: input.tenantId, date: { gte: since } },
          orderBy: { date: 'asc' },
        });
      }),
    ),
});

export const platformTrialsRouter = router({
  list: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      return prisma.tenant.findMany({
        where: { subscriptionStatus: 'TRIALING', deletedAt: null },
        orderBy: { trialEndsAt: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          trialSource: true,
          trialEndsAt: true,
          trialExtendedCount: true,
          setupCompletedAt: true,
          createdAt: true,
        },
      });
    }),
  ),

  extend: platformProcedure
    .input(z.object({ tenantId: zUuid, days: z.number().int().min(1).max(90) }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
        if (!tenant) throw new TRPCError({ code: 'NOT_FOUND' });
        const newEnd = new Date(
          (tenant.trialEndsAt ?? new Date()).getTime() + input.days * 86_400_000,
        );
        const updated = await prisma.tenant.update({
          where: { id: input.tenantId },
          data: {
            trialEndsAt: newEnd,
            trialExtendedCount: { increment: 1 },
          },
        });
        await prisma.trialEvent.create({
          data: {
            tenantId: input.tenantId,
            eventType: 'EXTENDED',
            metadata: { extended_days: input.days, by_platform_user: ctx.platformUser.id } as Prisma.InputJsonValue,
          },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.trials.extend',
          tableName: 'tenants',
          recordId: input.tenantId,
          tenantIdOverride: input.tenantId,
          after: { extendedDays: input.days, newEnd },
        });
        return updated;
      }),
    ),

  convertManual: platformProcedure
    .input(z.object({ tenantId: zUuid, plan: z.nativeEnum(TenantPlan) }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const updated = await prisma.tenant.update({
          where: { id: input.tenantId },
          data: {
            plan: input.plan,
            subscriptionStatus: 'ACTIVE',
            trialConversionAt: new Date(),
          },
        });
        await prisma.trialEvent.create({
          data: {
            tenantId: input.tenantId,
            eventType: 'CONVERTED',
            metadata: { plan: input.plan, by: ctx.platformUser.id } as Prisma.InputJsonValue,
          },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.trials.convertManual',
          tableName: 'tenants',
          recordId: input.tenantId,
          tenantIdOverride: input.tenantId,
          after: updated,
        });
        return updated;
      }),
    ),
});

const broadcastCreateInput = z.object({
  title: z.string().min(2).max(140),
  message: z.string().min(2).max(2000),
  variant: z.nativeEnum(BroadcastVariant).default(BroadcastVariant.INFO),
  target: z.nativeEnum(BroadcastTarget),
  targetPlans: z.array(z.string()).default([]),
  targetTenantIds: z.array(zUuid).default([]),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
  actionLabel: z.string().max(40).nullable().optional(),
  actionUrl: z.string().url().max(400).nullable().optional(),
  dismissible: z.boolean().default(true),
});

export const platformBroadcastsRouter = router({
  list: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      return prisma.broadcast.findMany({ orderBy: { startsAt: 'desc' }, take: 200 });
    }),
  ),

  create: platformProcedure
    .input(broadcastCreateInput)
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const created = await prisma.broadcast.create({
          data: {
            title: input.title,
            message: input.message,
            variant: input.variant,
            target: input.target,
            targetPlans: input.targetPlans,
            targetTenantIds: input.targetTenantIds,
            startsAt: input.startsAt,
            endsAt: input.endsAt ?? null,
            actionLabel: input.actionLabel ?? null,
            actionUrl: input.actionUrl ?? null,
            dismissible: input.dismissible,
            createdById: ctx.platformUser.id,
          } as Prisma.BroadcastUncheckedCreateInput,
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.broadcasts.create',
          tableName: 'broadcasts',
          recordId: created.id,
          after: created,
        });
        return created;
      }),
    ),

  delete: platformProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        await prisma.broadcast.update({
          where: { id: input.id },
          data: { active: false },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.broadcasts.delete',
          tableName: 'broadcasts',
          recordId: input.id,
        });
        return { ok: true };
      }),
    ),

  targetingPreview: platformProcedure
    .input(
      z.object({
        target: z.nativeEnum(BroadcastTarget),
        targetPlans: z.array(z.string()).optional(),
        targetTenantIds: z.array(zUuid).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        return previewTargeting(input);
      }),
    ),
});

/**
 * broadcastsRouter — público para qualquer usuário autenticado de tenant.
 * AppShell consome `activeForCurrentUser`; usuário dispensa via `dismiss`.
 */
export const broadcastsRouter = router({
  activeForCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    return activeForUser({ tenantId: ctx.tenantId, userId: ctx.user.id });
  }),
  dismiss: protectedProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ ctx, input }) => {
      await dismissForUser({ broadcastId: input.id, userId: ctx.user.id });
      return { ok: true };
    }),
});
