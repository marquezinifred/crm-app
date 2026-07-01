import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, platformProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { platformAudit } from '@/server/services/audit-platform.service';
import { zUuid } from '@/lib/validators';
import { AiFeatureCategory, AiFeatureStatus, AIProvider } from '@prisma/client';

// P-24 — inclusão por plano no defaultInclusion JSON.
// Alinhado ao seed da migration 0018 (values lowercase: disabled|included|addon).
// `ai-config.ts` faz toUpperCase() e usa apenas 'INCLUDED' pra ativar por default,
// então 'addon' aqui apenas sinaliza que o Platform Owner deve ligar manualmente
// (via tenantAccessSet) — não vira ADDON_ACTIVE automático.
const zPlanInclusion = z.enum(['disabled', 'included', 'addon']);

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

  createFeature: platformProcedure
    .input(
      z.object({
        code: z
          .string()
          .min(3)
          .max(64)
          .regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífens (ex: email-classify).'),
        name: z.string().min(3).max(100),
        description: z.string().min(10).max(500),
        category: z.nativeEnum(AiFeatureCategory),
        defaultProvider: z.nativeEnum(AIProvider),
        defaultModel: z.string().min(2).max(80),
        defaultInclusion: z.object({
          TRIAL: zPlanInclusion,
          STARTER: zPlanInclusion,
          PRO: zPlanInclusion,
          ENTERPRISE: zPlanInclusion,
        }),
        addonPriceBrlMonthly: z.number().nonnegative().finite().nullable().optional(),
        addonPriceBrlPerUse: z.number().nonnegative().finite().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const existing = await prisma.aiFeature.findUnique({
          where: { code: input.code },
          select: { id: true },
        });
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Feature com esse code já existe.',
          });
        }

        const created = await prisma.aiFeature.create({
          data: {
            code: input.code,
            name: input.name,
            description: input.description,
            category: input.category,
            defaultProvider: input.defaultProvider,
            defaultModel: input.defaultModel,
            defaultInclusion: input.defaultInclusion,
            addonPriceBrlMonthly: input.addonPriceBrlMonthly ?? null,
            addonPriceBrlPerUse: input.addonPriceBrlPerUse ?? null,
            active: true,
          },
        });

        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.aiMarketplace.createFeature',
          tableName: 'ai_features',
          recordId: created.id,
          after: created,
        });

        return created;
      }),
    ),

  setFeature: platformProcedure
    .input(
      z.object({
        id: zUuid,
        active: z.boolean().optional(),
        addonPriceBrlMonthly: z.number().min(0).nullable().optional(),
        // Sprint 15F — Platform Owner ajusta defaults de provider/model
        defaultProvider: z.nativeEnum(AIProvider).optional(),
        defaultModel: z.string().min(2).max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const updated = await prisma.aiFeature.update({
          where: { id: input.id },
          data: {
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.addonPriceBrlMonthly !== undefined
              ? { addonPriceBrlMonthly: input.addonPriceBrlMonthly }
              : {}),
            ...(input.defaultProvider !== undefined
              ? { defaultProvider: input.defaultProvider }
              : {}),
            ...(input.defaultModel !== undefined
              ? { defaultModel: input.defaultModel }
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
