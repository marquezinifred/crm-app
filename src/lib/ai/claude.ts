import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { decryptField } from '@/lib/crypto/field-encryption';

/**
 * Wrapper do Anthropic SDK.
 *
 * Sprint 4: cliente global singleton (env-based).
 * Sprint P-14: cliente resolvido por tenant a partir de
 * `tenants.ai_api_key_encrypted` (AES-256-GCM). Cada tenant que cadastra
 * chave em `/admin/ai` passa a consumir a própria conta Anthropic —
 * evita mistura de custo/rate-limit entre tenants.
 *
 * Cache: Map por tenantId com TTL curto (10min). Limita memória e
 * garante que troca de key no admin propaga rápido (Admin pode rotacionar
 * a qualquer momento). NUNCA cacheamos sem TTL — leak de memória +
 * risco cross-tenant se um tenant for movido de conta.
 */

const TENANT_CLIENT_TTL_MS = 10 * 60 * 1000;
const tenantClientCache = new Map<
  string,
  { client: Anthropic; keyFingerprint: string; expiresAt: number }
>();

/**
 * @deprecated Sprint 15F — usar `callAiWithFallback` via
 * `dispatchChat`/`dispatchEmbed` de `@/lib/ai/dispatch`. Remoção
 * planejada no Sprint 15G após MULTI_AI_ENABLED estar ligado 30d
 * sem regressão.
 *
 * Cliente global (consome env ANTHROPIC_API_KEY) — só sobrevive por
 * call sites sem tenant, nenhum previsto em produção.
 */
let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (_client) return _client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Resolve o cliente Anthropic para um tenant específico.
 *
 * Ordem:
 *   1. Se o tenant tem `aiApiKeyEncrypted` → decripta e cria client.
 *   2. Fallback pra `env.ANTHROPIC_API_KEY` global (com warn).
 *   3. Sem nenhum dos dois → throw com mensagem clara pro Admin.
 */
export async function getAnthropicForTenant(tenantId: string): Promise<Anthropic> {
  const now = Date.now();
  const cached = tenantClientCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.client;
  }

  const tenant = await runAsSystem(() =>
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiApiKeyEncrypted: true },
    }),
  );

  let apiKey: string | null = null;
  let source: 'tenant' | 'env' = 'env';
  if (tenant?.aiApiKeyEncrypted) {
    try {
      apiKey = decryptField(tenant.aiApiKeyEncrypted);
      source = 'tenant';
    } catch (err) {
      console.error(
        `[claude] Falha ao decriptar aiApiKeyEncrypted do tenant %s: %s`,
        tenantId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (!apiKey && env.ANTHROPIC_API_KEY) {
    console.warn(
      '[claude] Fallback pra ANTHROPIC_API_KEY global — tenant %s sem key própria',
      tenantId,
    );
    apiKey = env.ANTHROPIC_API_KEY;
    source = 'env';
  }

  if (!apiKey) {
    throw new Error(
      `Tenant ${tenantId} sem chave Anthropic. Cadastre em /admin/ai.`,
    );
  }

  const fingerprint = `${source}:${apiKey.slice(-6)}`;
  if (cached && cached.keyFingerprint === fingerprint) {
    cached.expiresAt = now + TENANT_CLIENT_TTL_MS;
    return cached.client;
  }

  const client = new Anthropic({ apiKey });
  tenantClientCache.set(tenantId, {
    client,
    keyFingerprint: fingerprint,
    expiresAt: now + TENANT_CLIENT_TTL_MS,
  });
  return client;
}

/** Invalida o cache de um tenant — útil quando Admin troca a key. */
export function invalidateTenantClient(tenantId: string): void {
  tenantClientCache.delete(tenantId);
}

/** Exposto pra testes. */
export const __test = {
  clearCache: () => tenantClientCache.clear(),
  cacheSize: () => tenantClientCache.size,
};

export const MODELS = {
  HAIKU: env.ANTHROPIC_MODEL_HAIKU,
  SONNET: env.ANTHROPIC_MODEL_SONNET,
} as const;
