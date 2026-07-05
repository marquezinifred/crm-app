import { z } from 'zod';

// P-60 — z.coerce.boolean() usa Boolean(value), que trata qualquer string
// não-vazia como `true` (`Boolean("false") === true`). Isso silenciosamente
// LIGAVA flags como `MULTI_AI_ENABLED=false` no .env em vez de desligar.
// Este helper interpreta o texto literalmente: "true|1|yes|on" → true;
// "false|0|no|off|"" → false; ausente → default.
const envBoolean = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (v === undefined || v === null) return defaultValue;
      const s = v.trim().toLowerCase();
      if (s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off')
        return false;
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      return defaultValue;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Redis (BullMQ)
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL_HAIKU: z.string().default('claude-haiku-4-5-20251001'),
  ANTHROPIC_MODEL_SONNET: z.string().default('claude-sonnet-4-6'),

  // Perplexity (benchmarks)
  PERPLEXITY_API_KEY: z.string().optional(),

  // OpenAI — embeddings (text-embedding-3-small). Sem isto, busca cai para
  // Postgres tsvector full-text português (sem semântica, só palavras-chave).
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Webhook inbound de e-mail — segredo via querystring ?secret=...
  INBOUND_WEBHOOK_SECRET: z.string().optional(),

  // Web Push (VAPID) — gerar com `npx web-push generate-vapid-keys`
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:noreply@crm.local'),

  // Resend (email)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().default('noreply@crm.local'),

  // Storage (S3/R2)
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Stripe (billing)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),

  // Observabilidade — Sentry (error tracking + performance).
  // NEXT_PUBLIC_SENTRY_DSN é o mesmo DSN exposto ao browser; se ausente,
  // o wrapper é no-op tanto server quanto client. SENTRY_ORG/PROJECT/
  // AUTH_TOKEN são usados só no build (sourcemap upload); vazio pula
  // upload sem quebrar o build.
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  // Observabilidade — Axiom (structured logs).
  // Sem AXIOM_TOKEN + AXIOM_DATASET, o logger é no-op.
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),
  // Trace inclusion — quando false (default), só mutations tRPC são
  // logadas; queries só quando falham. `true` loga todas as procedures.
  AXIOM_LOG_QUERIES: envBoolean(false),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  TENANT_FIELD_ENCRYPTION_KEY: z.string().min(32).optional(),

  // Banner de manutenção (Sprint 14.5) — DEPRECADO em Sprint 15B.
  // Fallback: se nenhum broadcast ativo, o env ainda é honrado até cliente
  // adotar broadcasts. Limpar pra string vazia depois do go-live.
  NEXT_PUBLIC_MAINTENANCE_MESSAGE: z.string().default(''),

  // Sprint 15B — câmbio USD→BRL para precificar tokens de IA em R$.
  // Mantenha conservador (default 5.10) ou recalibre por ambiente.
  USD_BRL_RATE: z.coerce.number().positive().default(5.1),

  // Margem da Plataforma sobre o custo bruto (0.20 = +20%).
  AI_PLATFORM_MARGIN: z.coerce.number().min(0).max(2).default(0.20),

  // Sprint 15F — Feature flag do multi-provider por feature + fallback.
  // false (default): 5 services usam getAnthropicForTenant() (path legado).
  // true: consumidores usam callAiWithFallback() (path novo).
  // Ver docs/Sprint_15F_IA_Multi_Provider.md.
  MULTI_AI_ENABLED: envBoolean(false),

  // Sprint 15E — Feature flag do RBAC granular (permissions individuais).
  // false (default): procedures antigas seguem usando `withCapability`
  // legado (ROLE_CAPABILITIES). Novas UIs de admin (/admin/users/[id]/
  // permissions) ficam desabilitadas.
  // true: procedures novas com `withPermission` respeitam grants/revokes
  // individuais; UI de permissions granulares acessível ao Admin.
  // Ver docs/Sprint_15E_RBAC_Granular.md — §5.4 rollout ordenado.
  RBAC_GRANULAR_ENABLED: envBoolean(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
