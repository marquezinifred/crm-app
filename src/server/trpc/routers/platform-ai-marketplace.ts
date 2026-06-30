import { z } from 'zod';
import { router, platformProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { platformAudit } from '@/server/services/audit-platform.service';
import { zUuid } from '@/lib/validators';
import { AiFeatureStatus } from '@prisma/client';

export const platformAiMarketplaceRouter = router({
  list: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      const features = await prisma.aiFeature.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { tenantStates: true } } },
      });
      return features;
    }),
  ),

  setFeature: platformProcedure
    .input(
      z.object({
        id: zUuid,
        active: z.boolean(),
        addonPriceBrlMonthly: z.number().min(0).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const updated = await prisma.aiFeature.update({
          where: { id: input.id },
          data: {
            active: input.active,
            ...(input.addonPriceBrlMonthly !== undefined
              ? { addonPriceBrlMonthly: input.addonPriceBrlMonthly }
              : {}),
          },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.aiMarketplace.setFeature',
          tableName: 'ai_features',
          recordId: input.id,
          after: updated,
        });
        return updated;
      }),
    ),

  tenantAccessList: platformProcedure
    .input(z.object({ tenantId: zUuid }))
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const [features, states] = await Promise.all([
          prisma.aiFeature.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
          prisma.tenantAiFeature.findMany({ where: { tenantId: input.tenantId } }),
        ]);
        const stateMap = new Map(states.map((s) => [s.featureId, s]));
        return features.map((f) => ({
          feature: f,
          state: stateMap.get(f.id) ?? null,
        }));
      }),
    ),

  tenantAccessSet: platformProcedure
    .input(
      z.object({
        tenantId: zUuid,
        featureId: zUuid,
        status: z.nativeEnum(AiFeatureStatus),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const existing = await prisma.tenantAiFeature.findUnique({
          where: { tenantId_featureId: { tenantId: input.tenantId, featureId: input.featureId } },
        });
        const now = new Date();
        const wasAddon = existing?.status === 'ADDON_ACTIVE';
        const willBeAddon = input.status === 'ADDON_ACTIVE';

        const upserted = await prisma.tenantAiFeature.upsert({
          where: { tenantId_featureId: { tenantId: input.tenantId, featureId: input.featureId } },
          create: {
            tenantId: input.tenantId,
            featureId: input.featureId,
            status: input.status,
            enabledById: ctx.platformUser.id,
            notes: input.notes ?? null,
            ...(willBeAddon ? { addonActivatedAt: now } : {}),
          },
          update: {
            status: input.status,
            enabledById: ctx.platformUser.id,
            notes: input.notes ?? null,
            ...(willBeAddon && !wasAddon ? { addonActivatedAt: now, addonDeactivatedAt: null } : {}),
            ...(wasAddon && !willBeAddon ? { addonDeactivatedAt: now } : {}),
          },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.aiMarketplace.tenantAccessSet',
          tableName: 'tenant_ai_features',
          recordId: `${input.tenantId}:${input.featureId}`,
          tenantIdOverride: input.tenantId,
          before: existing,
          after: upserted,
        });
        return upserted;
      }),
    ),
});
