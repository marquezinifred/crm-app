import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import {
  encryptField,
  maskApiKey,
  decryptField,
} from '@/lib/crypto/field-encryption';
import { getMonthlyUsage, AI_PRICING } from '@/server/services/ai-usage.service';
import { env } from '@/lib/env';
import { invalidateTenantClient } from '@/lib/ai/claude';
import { createClient } from '@/lib/ai/adapters/registry';
import { AiProviderError } from '@/lib/ai/adapters/types';
import { clearBreakers, snapshotBreakers } from '@/lib/ai/breakers';
import { AIProvider, AiFeatureStatus } from '@prisma/client';

/**
 * Sprint 15F — Router estendido para IA multi-provider por feature.
 *
 * Contratos importantes de segurança:
 *   - `updateConfig` / `updateFeature` recebem `apiKey` em plaintext no
 *     tRPC (dev). Servidor criptografa antes de gravar e NUNCA loga.
 *   - `testKey` chama o provider com min payload e retorna latency —
 *     não retorna nem loga a chave.
 *   - Todas as ações mutation registram audit_log.
 */

const providerEnum = z.nativeEnum(AIProvider);
const modelSchema = z.string().min(2).max(80);
const keySchema = z.string().min(10).max(500);

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
        provider: providerEnum,
        model: modelSchema,
        apiKey: keySchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data: {
        aiProvider: AIProvider;
        aiModel: string;
        aiApiKeyEncrypted?: string;
      } = { aiProvider: input.provider, aiModel: input.model };
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
        action: 'tenant.ai.updateGlobal',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        after: {
          provider: updated.aiProvider,
          model: updated.aiModel,
          apiKeyChanged: !!input.apiKey,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),

  // ─── Sprint 15F: listagem enriquecida com estados de tenant ─────
  listFeatures: adminOnlyProcedure.query(async ({ ctx }) => {
    const features = await prisma.aiFeature.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
    const states = await prisma.tenantAiFeature.findMany({
      where: { tenantId: ctx.tenantId },
    });
    const stateMap = new Map(states.map((s) => [s.featureId, s]));

    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { plan: true },
    });

    return features.map((f) => {
      const s = stateMap.get(f.id);
      const defaultPerPlan = (f.defaultInclusion as Record<string, string>) ?? {};
      const planDefault =
        defaultPerPlan[tenant?.plan ?? '']?.toUpperCase() ?? 'DISABLED';
      const effectiveStatus =
        s?.status ??
        (planDefault === 'INCLUDED' ? 'INCLUDED' : 'DISABLED');
      return {
        id: f.id,
        code: f.code,
        name: f.name,
        description: f.description,
        category: f.category,
        defaultProvider: f.defaultProvider,
        defaultModel: f.defaultModel,
        effectiveStatus,
        providerOverride: s?.providerOverride ?? null,
        modelOverride: s?.modelOverride ?? null,
        fallbackProvider: s?.fallbackProvider ?? null,
        fallbackModel: s?.fallbackModel ?? null,
        hasOwnKey: !!s?.apiKeyEncrypted,
        hasFallbackKey: !!s?.fallbackApiKeyEncrypted,
        costAlertBrlMonthly: s?.costAlertBrlMonthly
          ? Number(s.costAlertBrlMonthly)
          : null,
      };
    });
  }),

  updateFeature: adminOnlyProcedure
    .input(
      z.object({
        featureId: z.string().uuid(),
        providerOverride: providerEnum.nullable(),
        modelOverride: modelSchema.nullable(),
        apiKey: keySchema.nullable(),
        fallbackProvider: providerEnum.nullable(),
        fallbackModel: modelSchema.nullable(),
        fallbackApiKey: keySchema.nullable(),
        costAlertBrlMonthly: z.number().nonnegative().nullable(),
        enable: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const feature = await prisma.aiFeature.findUnique({
        where: { id: input.featureId },
      });
      if (!feature) throw new TRPCError({ code: 'NOT_FOUND' });

      // Validação: se há fallback provider, precisa ter model.
      if (input.fallbackProvider && !input.fallbackModel) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Fallback provider exige fallback model.',
        });
      }

      const data = {
        tenantId: ctx.tenantId,
        featureId: input.featureId,
        status: (input.enable ?? true)
          ? AiFeatureStatus.INCLUDED
          : AiFeatureStatus.DISABLED,
        providerOverride: input.providerOverride,
        modelOverride: input.modelOverride,
        apiKeyEncrypted: input.apiKey ? encryptField(input.apiKey) : null,
        fallbackProvider: input.fallbackProvider,
        fallbackModel: input.fallbackModel,
        fallbackApiKeyEncrypted: input.fallbackApiKey
          ? encryptField(input.fallbackApiKey)
          : null,
        costAlertBrlMonthly: input.costAlertBrlMonthly,
      };

      await prisma.tenantAiFeature.upsert({
        where: {
          tenantId_featureId: {
            tenantId: ctx.tenantId,
            featureId: input.featureId,
          },
        },
        create: data,
        update: {
          status: data.status,
          providerOverride: data.providerOverride,
          modelOverride: data.modelOverride,
          apiKeyEncrypted: data.apiKeyEncrypted,
          fallbackProvider: data.fallbackProvider,
          fallbackModel: data.fallbackModel,
          fallbackApiKeyEncrypted: data.fallbackApiKeyEncrypted,
          costAlertBrlMonthly: data.costAlertBrlMonthly,
        },
      });

      await audit({
        action: 'tenant.ai.updateFeature',
        tableName: 'tenant_ai_features',
        recordId: `${ctx.tenantId}:${input.featureId}`,
        after: {
          featureCode: feature.code,
          providerOverride: input.providerOverride,
          modelOverride: input.modelOverride,
          hasOwnKey: !!input.apiKey,
          fallbackProvider: input.fallbackProvider,
          fallbackModel: input.fallbackModel,
          hasFallbackKey: !!input.fallbackApiKey,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true };
    }),

  /**
   * Chama o provider com uma requisição mínima só pra validar a chave
   * e medir latência. NUNCA loga a chave (ela sai do escopo desta
   * função sem persistir e sem passar por logger).
   */
  testKey: adminOnlyProcedure
    .input(
      z.object({
        provider: providerEnum,
        model: modelSchema,
        apiKey: keySchema,
      }),
    )
    .mutation(async ({ input }) => {
      const client = createClient(input.provider, input.apiKey);
      const t0 = Date.now();
      try {
        await client.chat({
          model: input.model,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
        });
        return { ok: true, latencyMs: Date.now() - t0 };
      } catch (err) {
        if (err instanceof AiProviderError) {
          return {
            ok: false,
            latencyMs: Date.now() - t0,
            reason: err.kind,
            status: err.status,
          };
        }
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          reason: 'UNKNOWN',
          status: null,
        };
      }
    }),

  /**
   * Estado dos circuit breakers do tenant — Card D em /admin/ai.
   */
  breakerStatus: adminOnlyProcedure.query(({ ctx }) => {
    return snapshotBreakers().filter((b) => b.tenantId === ctx.tenantId);
  }),

  /**
   * Limpa manualmente um circuit breaker específico do tenant.
   */
  clearCircuitBreaker: adminOnlyProcedure
    .input(z.object({ provider: providerEnum }))
    .mutation(async ({ input, ctx }) => {
      const cleared = clearBreakers({
        provider: input.provider,
        tenantId: ctx.tenantId,
      });
      await audit({
        action: 'tenant.ai.clearCircuitBreaker',
        tableName: 'ai_circuit_breakers',
        recordId: `${ctx.tenantId}:${input.provider}`,
        after: { cleared },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true, cleared };
    }),

  // P-91 — gate admin: consumo mensal com custo por provider é config sensível.
  monthlyUsage: adminOnlyProcedure.query(({ ctx }) => getMonthlyUsage(ctx.tenantId)),

  /**
   * P-23 refino — dados por-feature pro Card D calcular alertas de
   * FALLBACK_FREQUENT e COST_ABOVE_THRESHOLD.
   *
   * Retorna por feature ativa:
   *   - fallbackCountLast24h: rows em ai_usage_logs com used_fallback=true
   *     nas últimas 24h
   *   - costBrlMtd: soma cost_usd do mês corrente × USD_BRL_RATE (sem
   *     margem — é o custo direto pro tenant, que traz sua própria
   *     chave)
   *   - costAlertBrlMonthly: threshold configurado (null = sem alerta)
   */
  featureUsageForAlerts: adminOnlyProcedure.query(async ({ ctx }) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [features, states, mtdRows, fallbackRows] = await Promise.all([
      prisma.aiFeature.findMany({ where: { active: true } }),
      prisma.tenantAiFeature.findMany({ where: { tenantId: ctx.tenantId } }),
      prisma.aIUsageLog.groupBy({
        by: ['requestType'],
        where: {
          tenantId: ctx.tenantId,
          createdAt: { gte: startOfMonth },
          success: true,
        },
        _sum: { costUsd: true },
      }),
      prisma.aIUsageLog.groupBy({
        by: ['requestType'],
        where: {
          tenantId: ctx.tenantId,
          createdAt: { gte: last24h },
          usedFallback: true,
        },
        _count: { _all: true },
      }),
    ]);

    const stateMap = new Map(states.map((s) => [s.featureId, s]));
    const mtdMap = new Map(
      mtdRows.map((r) => [r.requestType, Number(r._sum.costUsd ?? 0)]),
    );
    const fallbackMap = new Map(
      fallbackRows.map((r) => [r.requestType, r._count._all]),
    );

    return features.map((f) => {
      const requestType = FEATURE_CODE_TO_REQUEST_TYPE[f.code] ?? null;
      const costUsdMtd = requestType ? (mtdMap.get(requestType) ?? 0) : 0;
      const costBrlMtd = costUsdMtd * env.USD_BRL_RATE;
      const fallbackCountLast24h = requestType
        ? (fallbackMap.get(requestType) ?? 0)
        : 0;
      const s = stateMap.get(f.id);
      return {
        featureId: f.id,
        featureCode: f.code,
        featureName: f.name,
        costBrlMtd,
        fallbackCountLast24h,
        costAlertBrlMonthly: s?.costAlertBrlMonthly
          ? Number(s.costAlertBrlMonthly)
          : null,
      };
    });
  }),

  // P-91 — gate admin defensivo: tabela de preços por (provider, model)
  // expõe stack de IA em uso pelo tenant. Não referenciada pela UI mas
  // exposta via router.
  pricingTable: adminOnlyProcedure.query(() => AI_PRICING),
});

/**
 * P-23 refino — mapa feature.code → requestType logado por cada service.
 * Sem essa ponte, não conseguimos atribuir uso a uma feature. Cada nova
 * feature IA precisa registrar aqui o requestType usado no service dela.
 *
 * Débito residual: reverse mapping automático (via decorator ou registry
 * central) fica pra Sprint 15G — hoje mantido explícito pra ficar óbvio
 * quando um novo service esquecer de logar consistente.
 */
const FEATURE_CODE_TO_REQUEST_TYPE: Record<string, string> = {
  'communication-summary': 'communication_summary',
  'semantic-search': 'search_rerank',
  'proposal-version-diff': 'document_compare',
  'email-routing': 'email_link_rank',
  'conversion-rate-suggestion': 'conversion_rate_suggestion',
};
