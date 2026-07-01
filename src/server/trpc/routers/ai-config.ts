import { z } from 'zod';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { encryptField, maskApiKey, decryptField } from '@/lib/crypto/field-encryption';
import { getMonthlyUsage, AI_PRICING } from '@/server/services/ai-usage.service';
import { invalidateTenantClient } from '@/lib/ai/claude';
import { AIProvider } from '@prisma/client';

export const aiConfigRouter = router({
  getConfig: adminOnlyProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
    });
    if (!t) return null;
    let apiKeyMasked: string | null = null;
    if (t.aiApiKeyEncrypted) {
      try {
        apiKeyMasked = maskApiKey(decryptField(t.aiApiKeyEncrypted));
      } catch {
        apiKeyMasked = '****(corrompida)';
      }
    }
    return {
      provider: t.aiProvider,
      model: t.aiModel,
      apiKeyMasked,
      hasApiKey: !!t.aiApiKeyEncrypted,
    };
  }),

  updateConfig: adminOnlyProcedure
    .input(
      z.object({
        provider: z.nativeEnum(AIProvider),
        model: z.string().min(2).max(80),
        apiKey: z.string().min(10).max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data: { aiProvider: AIProvider; aiModel: string; aiApiKeyEncrypted?: string } = {
        aiProvider: input.provider,
        aiModel: input.model,
      };
      if (input.apiKey) {
        data.aiApiKeyEncrypted = encryptField(input.apiKey);
      }
      const updated = await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data,
      });
      if (input.apiKey) {
        invalidateTenantClient(ctx.tenantId);
      }
      await audit({
        action: 'tenant.update_ai_config',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        after: {
          provider: updated.aiProvider,
          model: updated.aiModel,
          apiKeyChanged: !!input.apiKey,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true };
    }),

  monthlyUsage: protectedProcedure.query(({ ctx }) => getMonthlyUsage(ctx.tenantId)),

  pricingTable: protectedProcedure.query(() => AI_PRICING),
});
