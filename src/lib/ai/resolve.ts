import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { decryptField } from '@/lib/crypto/field-encryption';
import { FeatureNotAvailableError } from './feature-gate';
import { providerSupportsEmbedding } from './adapters/registry';
import type { AIProvider, AiFeatureStatus } from '@prisma/client';

/**
 * Sprint 15F — Resolução em cascata de configuração de IA.
 *
 * Precedência (mais específico → menos):
 *   1. TenantAiFeature.providerOverride / modelOverride / apiKey
 *   2. AiFeature.defaultProvider / defaultModel
 *   3. Tenant.aiProvider / aiApiKeyEncrypted (quando provider bate)
 *
 * Retorna primary + fallback opcional. Chave em plaintext SÓ neste
 * objeto in-memory — NUNCA cachear em Redis, nunca logar.
 */

export interface ResolvedLeg {
  provider: AIProvider;
  model: string;
  /** plaintext — NÃO cachear em Redis, NÃO logar */
  apiKey: string;
  source:
    | 'tenant_feature_override'
    | 'ai_feature_default'
    | 'tenant_global';
}

export interface ResolvedAiConfig {
  primary: ResolvedLeg;
  fallback?: ResolvedLeg;
  featureId: string;
  status: AiFeatureStatus;
}

export async function resolveAiConfig(
  featureCode: string,
  tenantId: string,
): Promise<ResolvedAiConfig> {
  return runAsSystem(async () => {
    const feature = await prisma.aiFeature.findUnique({
      where: { code: featureCode },
    });
    if (!feature || !feature.active) {
      throw new FeatureNotAvailableError(
        `Feature "${featureCode}" não existe ou está desabilitada globalmente.`,
      );
    }

    const tenantFeature = await prisma.tenantAiFeature.findUnique({
      where: { tenantId_featureId: { tenantId, featureId: feature.id } },
    });

    if (tenantFeature?.status === 'DISABLED') {
      throw new FeatureNotAvailableError(
        `Feature "${featureCode}" desabilitada para este tenant.`,
      );
    }

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        aiProvider: true,
        aiModel: true,
        aiApiKeyEncrypted: true,
      },
    });

    const provider = tenantFeature?.providerOverride ?? feature.defaultProvider;
    const model = tenantFeature?.modelOverride ?? feature.defaultModel;

    // Validar suporte a embedding antes de sair — evita erro opaco
    // dentro do callback quando a feature é SEARCH.
    if (feature.category === 'SEARCH' && !providerSupportsEmbedding(provider)) {
      throw new FeatureNotAvailableError(
        `Provider ${provider} não suporta embeddings. Feature "${featureCode}" requer OpenAI ou Google.`,
      );
    }

    // Encontrar a chave: override da feature > global do tenant (se provider bate)
    let rawKey: string | null = tenantFeature?.apiKeyEncrypted ?? null;
    let source: ResolvedLeg['source'] = tenantFeature?.providerOverride
      ? 'tenant_feature_override'
      : 'ai_feature_default';

    if (!rawKey && provider === tenant.aiProvider) {
      rawKey = tenant.aiApiKeyEncrypted;
      source = 'tenant_global';
    }

    if (!rawKey) {
      throw new FeatureNotAvailableError(
        `Sem chave configurada para provider ${provider} na feature "${featureCode}". Configure em /admin/ai.`,
      );
    }

    const apiKey = decryptField(rawKey);
    const primary: ResolvedLeg = { provider, model, apiKey, source };

    // Fallback opcional. Curto-circuito: se a chave é IGUAL à primary,
    // fallback é inútil (mesma auth = mesma falha 401).
    let fallback: ResolvedLeg | undefined;
    if (
      tenantFeature?.fallbackProvider &&
      tenantFeature.fallbackModel &&
      tenantFeature.fallbackApiKeyEncrypted
    ) {
      const fallbackKey = decryptField(tenantFeature.fallbackApiKeyEncrypted);
      if (fallbackKey !== apiKey) {
        fallback = {
          provider: tenantFeature.fallbackProvider,
          model: tenantFeature.fallbackModel,
          apiKey: fallbackKey,
          source: 'tenant_feature_override',
        };
      }
    }

    return {
      primary,
      fallback,
      featureId: feature.id,
      status: tenantFeature?.status ?? 'INCLUDED',
    };
  });
}
