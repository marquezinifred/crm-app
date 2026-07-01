# Sprint 15F — IA Multi-Provider por Feature + Fallback

**Estimativa:** 5–7 dias úteis
**Pré-requisito:** P-14 (per-tenant AI key) fechado
**Registrado em:** [docs/Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) P-18
**Data spec:** 2026-06-30

---

## 1. Contexto e motivação

Hoje o CRM Venzo tem 5 features de IA ativas — `communication-summary`, `conversion-rate-suggestion`, `email-routing`, `proposal-version-diff`, `semantic-search` — e cada uma deveria usar o modelo mais adequado ao seu caso de uso:

| Feature | Modelo ideal | Motivo |
|---|---|---|
| `communication-summary` | Claude Haiku 4.5 | Alto volume, baixa complexidade, custo baixo |
| `conversion-rate-suggestion` | Claude Sonnet 4.6 | Precisa raciocínio quantitativo sobre histórico |
| `email-routing` | Claude Haiku 4.5 ou GPT-4o mini | Classificação simples, latência baixa |
| `proposal-version-diff` | Claude Sonnet 4.6 ou Opus | Análise semântica de mudanças legais/comerciais |
| `semantic-search` | text-embedding-3-large (OpenAI) | Embeddings — task diferente do LLM chat |

**Estado atual:** `/admin/ai` cadastra 1 provider global (Anthropic ou OpenAI ou Google ou Perplexity) + 1 modelo + 1 chave. Todas as 5 features usam essa mesma configuração. Se o tenant escolhe Anthropic, `semantic-search` que precisa OpenAI embeddings simplesmente quebra.

**Zero fallback:** se Anthropic tem apagão (5xx, rate limit, credit low), todas as 5 features quebram simultaneamente. Não há retry com provider alternativo.

**Impacto no cliente:** operação depende de IA (Sprint 4 promete "IA extrai automaticamente 4 blocos"). Uptime da app fica atado ao uptime do único provider configurado. Além disso, cliente não consegue otimizar custo: Sonnet é 5x mais caro que Haiku, e resumo é 90% do volume — pagando 5x sem precisar.

**O que Fred quer** (transcrito da conversa 2026-06-30):
> "Pensamos em alguns aplicações de IA diferentes e diferentes IAs seriam as recomendadas para uso em cada caso. Porém a tela de IA permite cadastrar apenas um serviço de IA e o desenho que tínhamos era de várias IAs cada uma específica para cada serviço, e em caso de fallback entrava outra IA"

---

## 2. Estado atual vs. estado desejado

### 2.1. Schema (já existe parcialmente)

```prisma
enum AIProvider {
  ANTHROPIC
  OPENAI
  GOOGLE
  PERPLEXITY
}

enum AiFeatureCategory {
  SUMMARIZATION
  SCORING
  SEARCH
  CLASSIFICATION
  GENERATION
  EXTRACTION
}

enum AiFeatureStatus {
  DISABLED
  INCLUDED
  ADDON_ACTIVE
}

model AiFeature {
  id                   String            @id
  code                 String            @unique          // 'communication-summary' etc
  name                 String
  description          String
  category             AiFeatureCategory
  defaultInclusion     Json                                // { STARTER: 'disabled', PRO: 'included', ... }
  addonPriceBrlMonthly Decimal?
  addonPriceBrlPerUse  Decimal?
  defaultProvider      String                              // hoje é `String`, deveria ser `AIProvider`
  defaultModel         String
  active               Boolean           @default(true)
  createdAt            DateTime          @default(now())
}

model TenantAiFeature {
  tenantId           String
  featureId          String
  status             AiFeatureStatus                       // DISABLED / INCLUDED / ADDON_ACTIVE
  addonActivatedAt   DateTime?
  addonDeactivatedAt DateTime?
  enabledById        String?
  notes              String?

  @@id([tenantId, featureId])
}

model Tenant {
  // ...
  aiProvider           AIProvider          @default(ANTHROPIC)
  aiModel              String?
  aiApiKeyEncrypted    String?
  // ...
}
```

**Bom:** conceito de catálogo (`AiFeature`) + estado por tenant (`TenantAiFeature`) + campos `defaultProvider`/`defaultModel` na feature.

**Faltando:**

1. Override por (tenant, feature) — hoje `TenantAiFeature` só liga/desliga, não permite escolher provider/modelo diferente.
2. Chave criptografada por feature — hoje só há a chave global do tenant.
3. Fallback (provider secundário + credentials).
4. Tabela `ai_features` populada com os 5 codes já em uso.
5. `defaultProvider` no schema é `String` — deveria ser `AIProvider` enum.

### 2.2. Backend

**Estado atual:**
- `src/lib/ai/claude.ts` — `getAnthropic()` singleton global, ignora tenant e feature.
- `src/lib/ai/feature-gate.ts` — `callAiFeature(featureCode, {tenantId}, fn)` verifica se feature está ativa pro tenant, mas **passa a mesma configuração global** pra função `fn`.
- Cada consumidor (`communication-summary.service.ts` etc) chama `getAnthropic()` direto — não olha `AiFeature.defaultProvider`.

**Estado desejado:**
- `resolveAiConfig(featureCode, tenantId)` retorna `{primary, fallback?}` com `{provider, model, apiKey}` cada.
- `callAiWithFallback(featureCode, tenantId, params)` orquestra retry provider→fallback→erro.
- Cada provider tem wrapper adapter uniforme: `AnthropicAdapter`, `OpenAIAdapter`, `GoogleAdapter` implementando `interface LlmClient`.
- Circuit breaker por **(provider, tenant)** — não singleton global.

### 2.3. UI `/admin/ai`

**Estado atual:** 1 card com dropdown provider + input modelo + input chave.

**Estado desejado:**
- Card A: "Configuração padrão do tenant" (herança fallback pra features sem override).
- Card B: Tabela de features agrupada por categoria. Cada linha permite override por feature (provider, modelo, chave, fallback).
- Card C: Uso e custo por feature (últimos 7 e 30 dias) — reusa `ai_usage_logs`.
- Card D: Alertas — features rodando em fallback, sem chave configurada, com custo acima de threshold.

### 2.4. UI Platform `/platform/ai-marketplace`

**Estado atual:** listagem de `AiFeature` (feito no Sprint 15B).

**Estado desejado:** permite Platform Owner editar `defaultProvider`/`defaultModel` da feature globalmente (afeta tenants novos + tenants sem override).

---

## 3. Escopo detalhado (por fase)

O sprint tem 4 fases sequenciais. Cada fase termina com commit + testes verdes.

### Fase 1 — Schema e migration (~0.5 dia)

**Objetivo:** adicionar colunas de override em `TenantAiFeature` + trocar `defaultProvider` pra enum + popular catálogo `ai_features` com os 5 codes atuais.

#### 3.1.1. Migration `0028_ai_multi_provider`

```sql
-- 1. Trocar defaultProvider de String → AIProvider enum
ALTER TABLE ai_features
  ALTER COLUMN default_provider TYPE "AIProvider"
  USING default_provider::"AIProvider";

-- 2. Colunas de override + fallback em TenantAiFeature
ALTER TABLE tenant_ai_features
  ADD COLUMN provider_override "AIProvider",
  ADD COLUMN model_override TEXT,
  ADD COLUMN api_key_encrypted TEXT,
  ADD COLUMN fallback_provider "AIProvider",
  ADD COLUMN fallback_model TEXT,
  ADD COLUMN fallback_api_key_encrypted TEXT,
  ADD COLUMN cost_alert_brl_monthly DECIMAL(10, 2),
  ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Popular catálogo ai_features com os 5 codes existentes
INSERT INTO ai_features (
  id, code, name, description, category,
  default_inclusion, default_provider, default_model, active, created_at
) VALUES
  (gen_random_uuid(), 'communication-summary',
    'Resumo de comunicações',
    'Extrai temas, ajustes, decisões e próximos passos de e-mail/WhatsApp colado no CRM.',
    'SUMMARIZATION',
    '{"STARTER":"included","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'ANTHROPIC', 'claude-haiku-4-5-20251001', true, now()),

  (gen_random_uuid(), 'conversion-rate-suggestion',
    'Sugestão de taxas de conversão',
    'Analisa histórico do funil e sugere taxas realistas por estágio.',
    'SCORING',
    '{"STARTER":"addon_available","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'ANTHROPIC', 'claude-sonnet-4-6', true, now()),

  (gen_random_uuid(), 'email-routing',
    'Roteamento de e-mails inbound',
    'Classifica e-mails recebidos e vincula à oportunidade correta.',
    'CLASSIFICATION',
    '{"STARTER":"included","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'ANTHROPIC', 'claude-haiku-4-5-20251001', true, now()),

  (gen_random_uuid(), 'proposal-version-diff',
    'Comparação de versões de proposta',
    'Analisa diff entre versões de proposta e destaca mudanças materiais.',
    'GENERATION',
    '{"STARTER":"addon_available","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'ANTHROPIC', 'claude-sonnet-4-6', true, now()),

  (gen_random_uuid(), 'semantic-search',
    'Busca semântica em comunicações',
    'Encontra comunicações relevantes por significado, não só palavra-chave.',
    'SEARCH',
    '{"STARTER":"addon_available","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'OPENAI', 'text-embedding-3-large', true, now());

-- 4. Índice pra query de resolução em cascata
CREATE INDEX IF NOT EXISTS idx_tenant_ai_features_lookup
  ON tenant_ai_features (tenant_id, feature_id)
  WHERE status IN ('INCLUDED', 'ADDON_ACTIVE');

COMMENT ON COLUMN tenant_ai_features.provider_override IS
  'Override do provider por feature — null herda de ai_features.default_provider';
COMMENT ON COLUMN tenant_ai_features.fallback_provider IS
  'Provider de fallback quando primary falha (5xx/rate limit/credit low)';
```

#### 3.1.2. Atualização do `schema.prisma`

- `AiFeature.defaultProvider: AIProvider` (troca de String).
- `TenantAiFeature` ganha 7 campos novos (override + fallback + cost_alert + updated_at).

#### 3.1.3. Seed opcional

`prisma/seed-ai-features.ts` — script pra popular `ai_features` em ambientes que não rodaram a migration com o INSERT. Já executado em dev via SQL da migration, mas pode ser útil pra rebase futuro.

---

### Fase 2 — Backend: provider adapters + resolução em cascata (~2 dias)

**Objetivo:** abstrair Anthropic/OpenAI/Google atrás de interface comum + resolver config por (tenant, feature) + fallback.

#### 3.2.1. Interface unificada

```ts
// src/lib/ai/adapters/types.ts
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmChatParams {
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
}

export interface LlmChatResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown; // response bruta pra debug
}

export interface LlmClient {
  provider: AIProvider;
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  embed?(params: { model: string; input: string[] }): Promise<{ vectors: number[][]; usage: { inputTokens: number } }>;
}
```

#### 3.2.2. Adapters

```
src/lib/ai/adapters/
  anthropic.ts    — AnthropicAdapter (SDK @anthropic-ai/sdk)
  openai.ts       — OpenAIAdapter (SDK openai)
  google.ts       — GoogleAdapter (SDK @google/generative-ai)
  perplexity.ts   — PerplexityAdapter (fetch direto — SDK indispon.)
```

Cada adapter constrói client com `apiKey` recebido no construtor, expõe `chat()` traduzindo pro schema unificado. Falhas de provider viram `AiProviderError` (nova classe) com `.status`, `.provider`, `.retryable`.

#### 3.2.3. Registry

```ts
// src/lib/ai/adapters/registry.ts
export function createClient(provider: AIProvider, apiKey: string): LlmClient {
  switch (provider) {
    case 'ANTHROPIC': return new AnthropicAdapter(apiKey);
    case 'OPENAI':    return new OpenAIAdapter(apiKey);
    case 'GOOGLE':    return new GoogleAdapter(apiKey);
    case 'PERPLEXITY': return new PerplexityAdapter(apiKey);
  }
}
```

#### 3.2.4. Resolução em cascata

```ts
// src/lib/ai/resolve.ts
export interface ResolvedAiConfig {
  primary: {
    provider: AIProvider;
    model: string;
    apiKey: string;
    source: 'tenant_feature_override' | 'ai_feature_default' | 'tenant_global';
  };
  fallback?: {
    provider: AIProvider;
    model: string;
    apiKey: string;
    source: 'tenant_feature_override';
  };
  featureId: string;
  status: AiFeatureStatus;
}

export async function resolveAiConfig(
  featureCode: string,
  tenantId: string,
): Promise<ResolvedAiConfig> {
  const feature = await prisma.aiFeature.findUnique({ where: { code: featureCode } });
  if (!feature || !feature.active) {
    throw new FeatureNotAvailableError(`Feature "${featureCode}" não existe ou desabilitada globalmente.`);
  }

  const tenantFeature = await prisma.tenantAiFeature.findUnique({
    where: { tenantId_featureId: { tenantId, featureId: feature.id } },
  });

  if (tenantFeature?.status === 'DISABLED') {
    throw new FeatureNotAvailableError(`Feature "${featureCode}" desabilitada para este tenant.`);
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
  });

  // Cascata: TenantAiFeature.override → AiFeature.default → Tenant.global
  const provider = tenantFeature?.providerOverride ?? feature.defaultProvider;
  const model    = tenantFeature?.modelOverride    ?? feature.defaultModel;

  const rawKey =
    tenantFeature?.apiKeyEncrypted ??
    (provider === tenant.aiProvider ? tenant.aiApiKeyEncrypted : null);

  if (!rawKey) {
    throw new FeatureNotAvailableError(
      `Sem chave configurada para provider ${provider} nesta feature. Configure em /admin/ai.`,
    );
  }

  const apiKey = decryptField(rawKey);
  const source = tenantFeature?.providerOverride
    ? 'tenant_feature_override'
    : feature.defaultProvider
      ? 'ai_feature_default'
      : 'tenant_global';

  const primary = { provider, model, apiKey, source };

  const fallback = tenantFeature?.fallbackProvider
    ? {
        provider: tenantFeature.fallbackProvider,
        model:    tenantFeature.fallbackModel!,
        apiKey:   decryptField(tenantFeature.fallbackApiKeyEncrypted!),
        source:   'tenant_feature_override' as const,
      }
    : undefined;

  return { primary, fallback, featureId: feature.id, status: tenantFeature?.status ?? 'INCLUDED' };
}
```

#### 3.2.5. Circuit breaker por (provider, tenant)

```ts
// src/server/services/ai-circuit-breaker.ts (refactor do existente)
const breakers = new Map<string, CircuitBreaker>();

function key(provider: AIProvider, tenantId: string) {
  return `${provider}:${tenantId}`;
}

export function getBreaker(provider: AIProvider, tenantId: string): CircuitBreaker {
  const k = key(provider, tenantId);
  if (!breakers.has(k)) {
    breakers.set(k, new CircuitBreaker({ name: k, threshold: 3, cooldownMs: 5 * 60 * 1000 }));
  }
  return breakers.get(k)!;
}
```

TTL: manter no Map em memória (limpar breakers ociosos >1h). Não persistir — reset no restart é aceitável.

#### 3.2.6. Orquestração com fallback

```ts
// src/lib/ai/call.ts
export async function callAiWithFallback<T>(
  featureCode: string,
  tenantId: string,
  fn: (client: LlmClient, model: string) => Promise<T>,
): Promise<{ result: T; usedProvider: AIProvider; usedFallback: boolean }> {
  const config = await resolveAiConfig(featureCode, tenantId);
  const attempts: Array<{ provider: AIProvider; model: string; apiKey: string; isFallback: boolean }> = [
    { ...config.primary, isFallback: false },
  ];
  if (config.fallback) attempts.push({ ...config.fallback, isFallback: true });

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    const breaker = getBreaker(attempt.provider, tenantId);
    if (breaker.isOpen()) {
      lastError = new Error(`Circuit aberto para ${attempt.provider}`);
      continue;
    }

    try {
      const client = createClient(attempt.provider, attempt.apiKey);
      const result = await fn(client, attempt.model);
      breaker.recordSuccess();
      return { result, usedProvider: attempt.provider, usedFallback: attempt.isFallback };
    } catch (err) {
      lastError = err as Error;
      const providerErr = err as AiProviderError;
      if (providerErr.retryable !== false) {
        breaker.recordFailure();
      }
      // continua pro próximo attempt
    }
  }

  throw lastError ?? new Error('Todas as tentativas de IA falharam.');
}
```

**Regra de decisão retryable:**
- 5xx, timeout, connection reset → retryable=true
- 429 → retryable=true (fallback é justamente pra isso)
- 400 credit balance / 402 → retryable=true (fallback pode ter créditos)
- 401/403 → **retryable=false** (chave inválida — fallback tem chave diferente, tenta)
- Erros de código Anthropic específicos (context length, model not found) → retryable=false

#### 3.2.7. Refactor consumidores

Cada um dos 5 services (`communication-summary.service.ts`, `conversion-rate-suggestion.service.ts`, `email-link.service.ts`, `document-compare.service.ts`, `semantic-search.service.ts`) deixa de chamar `getAnthropic()` direto e passa a usar `callAiWithFallback(featureCode, tenantId, (client, model) => client.chat({...}))`.

`getAnthropic()` marcado `@deprecated` — remoção em Sprint futuro após migração completa.

#### 3.2.8. Logging enriquecido

`logAiUsage()` (função existente) ganha campos novos:
```ts
{
  usedProvider: AIProvider,      // qual efetivamente atendeu
  usedFallback: boolean,          // caiu no fallback?
  configuredProvider: AIProvider, // qual era primary
}
```

Novo migration `0029_ai_usage_fallback_tracking`:
```sql
ALTER TABLE ai_usage_logs
  ADD COLUMN used_fallback BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN configured_provider "AIProvider";
```

---

### Fase 3 — UI `/admin/ai` refactor (~2 dias)

Página fica dividida em 4 cards. Componentes reutilizados de `src/components/ui/*` (Modal, Table, Select, Input, Field).

#### 3.3.1. Card A — Configuração padrão do tenant

Igual ao atual, mas com contexto explícito:

> **Configuração padrão** — provider/modelo/chave usados quando uma feature não tem override específico. Também usado como fallback global.

Campos:
- Provider (Select: Anthropic / OpenAI / Google / Perplexity)
- Modelo (Select filtrado pelo provider)
- Chave API (Input password + botão "Testar chave" — faz uma chamada mínima e retorna sucesso/erro real do provider)
- Botão "Salvar" (audit obrigatório: `tenant.ai.updateGlobal`)

#### 3.3.2. Card B — Features por categoria

Tabela agrupada por `AiFeatureCategory` (headers colapsáveis: SUMMARIZATION, EXTRACTION, SEARCH, etc). Cada linha é uma feature:

| Feature | Status | Provider | Modelo | Chave | Fallback | Uso 30d |
|---|---|---|---|---|---|---|
| Resumo de comunicações | INCLUDED | Anthropic (padrão) | Haiku 4.5 (padrão) | Herdada | — | 234 chamadas |
| Roteamento de e-mails | INCLUDED | Anthropic (padrão) | Haiku 4.5 (padrão) | Herdada | — | 45 chamadas |
| Sugestão de taxas de conversão | ADDON_ACTIVE | **Anthropic** | **Sonnet 4.6** | Herdada | OpenAI GPT-4o | 12 chamadas (2 fallback) |
| Busca semântica | INCLUDED | **OpenAI** | text-embedding-3-large | **Custom** | — | 890 chamadas |

Clique na linha abre modal de edit:
- Provider (Select): "Usar padrão do tenant" | "Custom: Anthropic/OpenAI/…"
- Modelo (Select): filtrado por provider
- Chave: "Herdar" | "Definir chave própria" (Input password)
- Fallback: opcional, mesma trinca
- Alerta de custo: input R$ / mês (opcional) — sistema envia broadcast quando ultrapassar
- Botão "Salvar" (audit: `tenant.ai.updateFeature`)

#### 3.3.3. Card C — Uso e custo

Reusa dados de `ai_usage_logs` (Sprint 15B ai-ops-analytics.service já agrega).

Mostra:
- Total mês corrente (chamadas + tokens + custo R$)
- Breakdown por feature: barra empilhada primary vs fallback
- Alertas ativos (feature X excedeu threshold, feature Y sem chave, provider Z em circuit aberto)

#### 3.3.4. Card D — Alertas

Lista de alertas ativos:
- 🟡 Feature "conversion-rate-suggestion" caiu em fallback 3x nas últimas 24h
- 🔴 Feature "semantic-search" sem chave configurada — não vai funcionar
- 🔴 Provider Anthropic em circuit aberto (aberto há 8min)

Cada alerta tem CTA que abre o card relevante.

#### 3.3.5. Estados de erro / empty

- Sem provider padrão configurado → warning topo: "Configure ao menos um provider padrão pra IA funcionar."
- Chave inválida (validada via "Testar chave") → red-highlight no Card A.
- Feature ativa mas sem provider resolvido → red-highlight na linha.

#### 3.3.6. Roteadores tRPC novos/expandidos

```
tenant.aiConfig.updateGlobal({ provider, model, apiKey })       // Card A
tenant.aiConfig.updateFeature({ featureId, ... })               // Card B (edit)
tenant.aiConfig.testKey({ provider, apiKey })                   // Card A/B (botão testar)
tenant.aiConfig.listFeatures()                                   // Card B (populate)
tenant.aiConfig.usageAndCost({ range: '30d' | '7d' | 'mtd' })   // Card C
tenant.aiConfig.alerts()                                         // Card D
```

Todos com `withCapability('ai', 'configure')`.

---

### Fase 4 — UI Platform `/platform/ai-marketplace` enhancements (~0.5 dia)

Marketplace já lista `AiFeature`. Ampliação:

- Editar `defaultProvider`/`defaultModel` de cada feature (input Platform Owner only).
- Toggle `active` (desativar feature globalmente).
- Mostrar % de tenants em override vs padrão.
- Adicionar feature nova (form: code, name, description, category, defaults, inclusão por plano).

Router `platform.aiMarketplace.updateFeature({ featureId, ... })` — `platformProcedure`.

---

## 4. Feature flag e rollout

### 4.1. Flag `MULTI_AI_ENABLED`

Env global (`.env.local` + Vercel config). Padrão `false` no MVP.

- `false` (default): consumidores continuam usando `getAnthropic()` global. Nada muda em produção.
- `true`: consumidores usam `callAiWithFallback()`. Configuração vira per-feature.

Localização: `src/lib/env.ts` schema adiciona `MULTI_AI_ENABLED: z.coerce.boolean().default(false)`.

### 4.2. Rollout gradual

1. **Fase 1 (dev):** merge com flag `false`. Sem impacto. Testes unitários + integração com flag ativa cobrem code path novo.
2. **Fase 2 (interno):** tenant Fred (`marquezini`) recebe `MULTI_AI_ENABLED=true` via override por tenant (nova coluna `tenants.multi_ai_enabled BOOLEAN DEFAULT false`). Fred valida na prática 3–5 dias.
3. **Fase 3 (early adopters):** 2–3 tenants Enterprise convidados manualmente. Suporte acompanha ai_usage_logs pra ver se fallback dispara em produção.
4. **Fase 4 (geral):** flag global vira `true` no `.env` de produção após 30 dias sem regressão.

### 4.3. Migração de tenants existentes

Ao habilitar flag pra um tenant:
- Nenhuma migration de dado obrigatória.
- Ausência de override em `TenantAiFeature` = herda de `AiFeature.defaultProvider` (populado na migration 0028).
- Se tenant tem chave global só de Anthropic e uma feature (`semantic-search`) default OpenAI, essa feature vai lançar `FeatureNotAvailableError` até tenant configurar chave OpenAI. UI Card B destaca isso como alerta 🔴.

---

## 5. Testes obrigatórios

### 5.1. Unit

- `resolveAiConfig`:
  - Feature inexistente → `FeatureNotAvailableError`
  - Tenant sem override → herda `ai_features.default_provider`
  - Tenant com override → usa override
  - Tenant com fallback configurado → retorno inclui `fallback`
  - Feature default OpenAI + tenant só com key Anthropic → erro `sem chave`
- `callAiWithFallback`:
  - Primary sucede → não chama fallback
  - Primary 5xx → chama fallback → sucede → retorna `usedFallback=true`
  - Primary + fallback ambos falham → throw last error
  - Circuit aberto no primary → pula pro fallback
  - Retryable=false (401) → não pula pro fallback? **Decisão:** pula (fallback tem chave diferente)
- Adapters:
  - `AnthropicAdapter.chat` traduz corretamente pra schema unificado
  - Provider erros mapeados pra `AiProviderError` com `retryable` correto
- Circuit breaker:
  - Por-(provider, tenant): fail em (Anthropic, tenant A) não afeta (Anthropic, tenant B)
  - Cooldown expira corretamente

### 5.2. Integração

- Refactor de cada um dos 5 services: continua funcionando com flag `false` (path antigo) E com flag `true` (path novo).
- E2E `/admin/ai`: cadastra provider global → tabela features carrega → edit uma feature com override → salva → chamada real da feature usa override.

### 5.3. RBAC

- Usuário sem `ai:configure` não acessa `/admin/ai`.
- Usuário sem `ai:configure` chamando `tenant.aiConfig.updateFeature` → 403.
- Platform Owner acessa `/platform/ai-marketplace`, tenant admin não.

### 5.4. Segurança

- Chave criptografada nunca aparece em log/response tRPC.
- Chave editada por Platform Owner (impersonando) fica atribuída ao tenant, não ao Platform Owner.
- Race condition: 2 updates simultâneos na mesma feature → last write wins + audit registra ambos.

---

## 6. Riscos e decisões pendentes

### 6.1. Cache de resolução

`resolveAiConfig` faz 2 queries (AiFeature + TenantAiFeature + Tenant) por chamada. Em features de alto volume (`communication-summary`) isso adiciona ~30ms/chamada.

**Decisão pendente:** cache in-memory por `(tenantId, featureId)` com TTL 5 min? Invalidação em `tenant.aiConfig.updateFeature`? Ou aceitar 30ms overhead?

Recomendação: **cache** com invalidação por tenant (não por feature) — quando salva algo em `/admin/ai`, limpa todo o cache do tenant. Mais simples que invalidação granular.

### 6.2. Custo do fallback silencioso

Se primary Anthropic (barato: $1/M in) falha e fallback é OpenAI GPT-4 (caro: $10/M in), o tenant pode ter custo 10x sem notar. `ai_usage_logs` distingue (`used_fallback=true`) mas alerta ativo é opcional.

**Decisão pendente:** obrigar tenant a definir `cost_alert_brl_monthly` ao configurar fallback? Ou só warning na UI?

Recomendação: **warning + campo opcional**. Tenant Enterprise sabe o que faz; tenant Starter provavelmente nem usa fallback.

### 6.3. Provider embeddings vs chat

`semantic-search` usa embedding, não chat. `LlmClient.embed` é opcional. Nem todos os providers suportam embeddings (Anthropic não tem embedding endpoint próprio, usa Voyage AI parceiro).

**Decisão pendente:** modelar separado `EmbeddingClient` vs `ChatClient` ou manter `LlmClient` com métodos opcionais?

Recomendação: **métodos opcionais** por enquanto. Se semantic-search ganhar múltiplos provedores concorrentes (Cohere, Voyage), refatorar pra interfaces separadas.

### 6.4. Contexto legal (LGPD)

Cada provider processa dados do tenant (comunicações, propostas). Contratos com Anthropic/OpenAI/Google precisam DPA (Data Processing Agreement) explícito. Se tenant configura provider próprio (BYOK), responsabilidade fica com o tenant.

**Decisão pendente:** política padrão do Venzo é "usar Anthropic como sub-processor via DPA"? Ou "cliente responsável por escolher e assinar DPA"?

Recomendação: **cliente responsável** (BYOK). Venzo fornece 3 dias de trial com key Venzo (via ANTHROPIC_API_KEY global), depois cliente traz a própria.

### 6.5. Deprecar `getAnthropic()`

Marcar `@deprecated` no Sprint 15F. Remover em Sprint 15G+ após migração completa dos consumidores + prazo de safety window (~1 mês).

### 6.6. Rate limit management

Cada tenant tem N chaves com limits próprios. Hoje `TenantAiLimits` (Sprint 15B) tracka uso agregado. Com per-feature, o modelo precisa evoluir pra `TenantAiLimits(tenantId, provider, feature?)`.

**Decisão pendente:** escopo do Sprint 15F ou fica pra 15G?

Recomendação: **fora do escopo**. Sprint 15F já tem 5–7 dias. Rate limit granular vira 15G.

---

## 7. Estimativa dia-a-dia

| Dia | Fase | Entregas |
|---|---|---|
| 1 | Fase 1 | Migration 0028 + schema.prisma + prisma generate + seed populado |
| 2 | Fase 2.1–2.3 | LlmClient interface + AnthropicAdapter + OpenAIAdapter + tests unit |
| 3 | Fase 2.4–2.5 | GoogleAdapter + PerplexityAdapter + circuit breaker por-(provider, tenant) + tests |
| 4 | Fase 2.6–2.8 | resolveAiConfig + callAiWithFallback + refactor 5 services + tests integração |
| 5 | Fase 3.1–3.3 | Card A + Card B (UI + router tRPC + tests) |
| 6 | Fase 3.4–3.6 + Fase 4 | Card C + Card D + testKey + Platform Marketplace + tests |
| 7 | Rollout + Docs | Feature flag + rollout Fred + CLAUDE.md + smoke E2E |

Buffer: 1 dia (~15%) pra imprevistos = **8 dias com buffer**.

---

## 8. Referências

- Schema atual: [prisma/schema.prisma](../prisma/schema.prisma) linhas 44–65 (enums), 380–384 (Tenant), 1709–1744 (AiFeature/TenantAiFeature)
- Sprint 15B: [docs/Sprint_15B_AI_Ops_Platform.md](Sprint_15B_AI_Ops_Platform.md) — origem do AiFeature/TenantAiFeature
- P-14: [docs/Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — per-tenant AI key (pré-requisito)
- feature-gate atual: [src/lib/ai/feature-gate.ts](../src/lib/ai/feature-gate.ts)
- Consumidores de IA: `src/server/services/{communication-summary,conversion-rate-suggestion,email-link,document-compare,semantic-search}.service.ts`

---

## 9. Definição de pronto

- [ ] Todas as 4 fases mergeadas no main
- [ ] `npm test` verde (baseline + testes novos)
- [ ] `npx tsc --noEmit` verde
- [ ] `npm run lint` verde
- [ ] Migration aplicada em Neon (dev + staging)
- [ ] Feature flag `MULTI_AI_ENABLED=true` funciona pro tenant Fred sem regressão nos 5 services
- [ ] Fred configura provider OpenAI em `semantic-search` e chamada real usa OpenAI
- [ ] Fred configura fallback Anthropic→OpenAI em `communication-summary`, força primary a falhar (chave inválida temporária), vê fallback ativar em `ai_usage_logs`
- [ ] `/platform/ai-marketplace` permite Platform Owner editar defaults
- [ ] CLAUDE.md atualizado
- [ ] Backlog_Pos_MVP.md marca P-18 como ✅ FECHADO
- [ ] Nova entrada em MEMORY.md se houver aprendizado arquitetural notável
