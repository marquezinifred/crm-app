import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { getCurrentMonthUsage, getTodayRequests } from './usage';

/**
 * Feature gate de IA — Sprint 15B.
 *
 * Todo call site que chama Anthropic/OpenAI/Perplexity deve passar por
 * `callAiFeature(code, ctx, fn)`. O gate resolve:
 *   1. Acesso (DISABLED → FeatureNotAvailableError; INCLUDED/ADDON_ACTIVE → ok)
 *   2. Limites do tenant (tokens mês / requests dia → AiLimitExceededError)
 *   3. Modelo efetivo (pinned no tenant > default da feature)
 *
 * Sai do gate com `model` resolvido + função recebe esse model para
 * chamar o SDK. Atualização de `ai_usage_logs` continua sendo
 * responsabilidade do caller (mantém compatibilidade Sprint 4).
 */

export class FeatureNotAvailableError extends Error {
  constructor(message = 'Recurso de IA indisponível no seu plano.') {
    super(message);
    this.name = 'FeatureNotAvailableError';
  }
}

export class AiLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly kind: 'MONTHLY_TOKENS' | 'DAILY_REQUESTS',
  ) {
    super(message);
    this.name = 'AiLimitExceededError';
  }
}

interface CallContext {
  tenantId: string;
  /** Override opcional pra forçar um modelo (não recomendado em produção). */
  forceModel?: string;
}

interface ResolvedAccess {
  status: 'DISABLED' | 'INCLUDED' | 'ADDON_ACTIVE';
  model: string;
  provider: string;
}

async function resolveAccess(
  tenantId: string,
  featureCode: string,
): Promise<ResolvedAccess> {
  return runAsSystem(async () => {
    const feature = await prisma.aiFeature.findUnique({
      where: { code: featureCode },
    });
    if (!feature) {
      throw new FeatureNotAvailableError(
        `Feature de IA "${featureCode}" não existe no catálogo.`,
      );
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, aiLimits: true },
    });
    if (!tenant) {
      throw new FeatureNotAvailableError('Tenant não encontrado.');
    }

    const override = await prisma.tenantAiFeature.findUnique({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
    });
    const defaultPerPlan = (feature.defaultInclusion as Record<string, string>) ?? {};
    const planDefault =
      defaultPerPlan[tenant.plan]?.toUpperCase() ?? 'DISABLED';

    const status =
      override?.status ??
      (planDefault === 'INCLUDED'
        ? 'INCLUDED'
        : planDefault === 'ADDON'
          ? 'DISABLED' // plano-default ADDON requer ativação manual
          : 'DISABLED');

    if (status === 'DISABLED') {
      throw new FeatureNotAvailableError(
        `${feature.name} está disponível como add-on. Habilite em /admin/billing.`,
      );
    }

    // Modelo: tenant pinned (haiku/sonnet) overrideia default da feature
    const limits = tenant.aiLimits;
    let model = feature.defaultModel;
    if (feature.defaultProvider === 'anthropic') {
      if (feature.defaultModel.includes('haiku') && limits?.pinnedModelHaiku) {
        model = limits.pinnedModelHaiku;
      } else if (
        feature.defaultModel.includes('sonnet') &&
        limits?.pinnedModelSonnet
      ) {
        model = limits.pinnedModelSonnet;
      }
    }

    return { status, model, provider: feature.defaultProvider };
  });
}

async function assertWithinLimits(tenantId: string): Promise<void> {
  const limits = await runAsSystem(() =>
    prisma.tenantAiLimits.findUnique({ where: { tenantId } }),
  );
  if (!limits) return;

  if (limits.monthlyTokenLimit !== null) {
    const monthly = await getCurrentMonthUsage(tenantId);
    if (monthly.tokens >= Number(limits.monthlyTokenLimit)) {
      throw new AiLimitExceededError(
        'Limite mensal de tokens de IA atingido. Ajuste em /admin/billing ou aguarde o próximo ciclo.',
        'MONTHLY_TOKENS',
      );
    }
  }

  if (limits.dailyRequestLimit !== null) {
    const today = await getTodayRequests(tenantId);
    if (today >= limits.dailyRequestLimit) {
      throw new AiLimitExceededError(
        'Limite diário de requests de IA atingido. Tente novamente amanhã.',
        'DAILY_REQUESTS',
      );
    }
  }
}

export async function callAiFeature<T>(
  featureCode: string,
  ctx: CallContext,
  fn: (resolved: { model: string; provider: string }) => Promise<T>,
): Promise<T> {
  const access = await resolveAccess(ctx.tenantId, featureCode);
  await assertWithinLimits(ctx.tenantId);
  const model = ctx.forceModel ?? access.model;
  return fn({ model, provider: access.provider });
}
