# Sprint 15F — IA Multi-Provider por Feature + Fallback (v2)

**Estimativa:** 6–8 dias úteis (revisado)
**Pré-requisito:** P-14 (per-tenant AI key) fechado
**Registrado em:** [docs/Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) P-18
**Data spec:** 2026-06-30
**Revisão v2:** 2026-06-30 — incorpora validação arquitetural (DataMaskingService, testKey, circuit breaker multi-pod, de-para tipo→modelo)

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

**Estado atual:** `/admin/ai` cadastra 1 provider global + 1 modelo + 1 chave. Todas as 5 features usam essa mesma configuração.

**Impacto no cliente:** operação depende de IA. Uptime fica atado ao uptime do único provider. Cliente não consegue otimizar custo.

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

model AiFeature {
  id                   String            @id
  code                 String            @unique
  name                 String
  description          String
  category             AiFeatureCategory
  defaultInclusion     Json
  defaultProvider      AIProvider        // era String — migração 0028 converte
  defaultModel         String
  active               Boolean           @default(true)
  createdAt            DateTime          @default(now())
}

model TenantAiFeature {
  tenantId              String
  featureId             String
  status                AiFeatureStatus
  providerOverride      AIProvider?       // NOVO
  modelOverride         String?           // NOVO
  apiKeyEncrypted       String?           // NOVO
  fallbackProvider      AIProvider?       // NOVO
  fallbackModel         String?           // NOVO
  fallbackApiKeyEncrypted String?         // NOVO
  costAlertBrlMonthly   Decimal?          // NOVO
  updatedAt             DateTime          // NOVO

  @@id([tenantId, featureId])
}
```

**Faltando em relação ao v1:**
1. Override por (tenant, feature).
2. Chave criptografada por feature.
3. Fallback (provider secundário + credentials).
4. Tabela `ai_features` populada com os 5 codes já em uso.
5. `defaultProvider` como enum (era String).

---

### 2.2. De-para: Tipo de Operação → Provider/Modelo Recomendado

> **Esta seção é referência permanente.** Ao abrir um PR com nova feature de IA, o author deve registrar no PR description: *"Tipo de operação: [linha abaixo]. Provider escolhido: X. Motivo de divergência (se aplicável): …"* — evita que todo feature novo herde o default Anthropic Sonnet por omissão.

| Tipo de operação | Provider | Modelo | Justificativa |
|---|---|---|---|
| **Sumarização / extração** (alto volume, baixa complexidade) | Anthropic | claude-haiku-4-5-20251001 | Custo baixo (~$0.25/M in), latência < 2s, suficiente para resumo estruturado |
| **Raciocínio quantitativo / scoring** (análise de histórico, forecasting) | Anthropic | claude-sonnet-4-6 | Reasoning profundo; volume baixo justifica custo maior (~$3/M in) |
| **Classificação / roteamento** (label de e-mail, categorização simples) | Anthropic ou OpenAI | claude-haiku-4-5 ou gpt-4o-mini | Tarefa simples; latência crítica; custo deve ser mínimo |
| **Geração complexa / diff semântico** (proposta, contrato, redação longa) | Anthropic | claude-sonnet-4-6 (ou Opus para enterprise) | Qualidade > custo; volume geralmente baixo |
| **Embeddings / busca semântica** | OpenAI | text-embedding-3-large | Anthropic não tem embedding nativo; alternativa: Voyage AI (parceiro Anthropic) |
| **Pesquisa com contexto web** (benchmarks, dados públicos externos) | Perplexity | sonar-pro | Único provider com retrieval web nativo; Gemini como fallback |
| **Extração estruturada de dados** (JSON de NF, formulários, tabelas) | Anthropic | claude-haiku-4-5 com tool_use | tool_use do Haiku é preciso e rápido |
| **Análise de imagem / documento PDF** (contratos escaneados) | Anthropic ou OpenAI | claude-sonnet-4-6 ou gpt-4o | Multimodal — verificar se caso exige OCR prévio ou visão direta |

**Regra de fallback por tipo:**
- Sumarização/classificação: fallback = gpt-4o-mini (custo similar)
- Scoring/geração complexa: fallback = gpt-4o (custo maior, aceito pela raridade)
- Embeddings: fallback = Voyage AI (via HTTP direto) ou text-embedding-ada-002 (menor qualidade)
- Pesquisa web: fallback = Gemini 1.5 Flash com grounding

---

### 2.3. Backend

**Estado desejado:**
- `resolveAiConfig(featureCode, tenantId)` retorna `{primary, fallback?}`.
- `callAiWithFallback(featureCode, tenantId, fn)` orquestra retry.
- Adapters uniformes: `AnthropicAdapter`, `OpenAIAdapter`, `GoogleAdapter`, `PerplexityAdapter` implementando `LlmClient`.
- Circuit breaker por **(provider, tenant)** — não singleton global.

---

### 2.4. UI `/admin/ai`

- **Card A:** Configuração padrão do tenant.
- **Card B:** Tabela de features com override por feature.
- **Card C:** Uso e custo por feature (últimos 7 e 30 dias).
- **Card D:** Alertas ativos (fallback ativo, sem chave, circuit aberto).

---

## 3. Escopo detalhado (por fase)

### Fase 1 — Schema e migration (~0.5 dia)

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
    'Extrai temas, ajustes, decisões e próximos passos de e-mail/WhatsApp.',
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
    'Analisa diff entre versões e destaca mudanças materiais.',
    'GENERATION',
    '{"STARTER":"addon_available","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'ANTHROPIC', 'claude-sonnet-4-6', true, now()),

  (gen_random_uuid(), 'semantic-search',
    'Busca semântica em comunicações',
    'Encontra comunicações relevantes por significado.',
    'SEARCH',
    '{"STARTER":"addon_available","PRO":"included","ENTERPRISE":"included"}'::jsonb,
    'OPENAI', 'text-embedding-3-large', true, now());

-- 4. Índice para query de resolução
CREATE INDEX IF NOT EXISTS idx_tenant_ai_features_lookup
  ON tenant_ai_features (tenant_id, feature_id)
  WHERE status IN ('INCLUDED', 'ADDON_ACTIVE');

COMMENT ON COLUMN tenant_ai_features.provider_override IS
  'Override do provider por feature — null herda de ai_features.default_provider';
COMMENT ON COLUMN tenant_ai_features.fallback_provider IS
  'Provider de fallback quando primary falha (5xx/rate limit/credit low)';
```

---

### Fase 2 — Backend: adapters + resolução + fallback (~2 dias)

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
  raw: unknown;
}

export interface LlmEmbedResult {
  vectors: number[][];
  usage: { inputTokens: number };
}

export interface LlmClient {
  provider: AIProvider;
  supportsEmbedding: boolean; // flag explícito — evita runtime surprise
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  embed?(params: { model: string; input: string[] }): Promise<LlmEmbedResult>;
}
```

> **Por que `supportsEmbedding` explícito:** `resolveAiConfig` valida na resolução — se feature.category === 'SEARCH' e o provider não tem `supportsEmbedding`, lança `FeatureNotAvailableError` antes de chegar ao callback. Evita erro de runtime opaco dentro da `fn`.

#### 3.2.2. Adapters

```
src/lib/ai/adapters/
  anthropic.ts    — AnthropicAdapter  (supportsEmbedding: false)
  openai.ts       — OpenAIAdapter     (supportsEmbedding: true)
  google.ts       — GoogleAdapter     (supportsEmbedding: true — Gemini embed)
  perplexity.ts   — PerplexityAdapter (supportsEmbedding: false)
```

Cada adapter constrói client com `apiKey` recebido no construtor. Falhas de provider viram `AiProviderError` com `.status`, `.provider`, `.retryable`.

**Mapeamento de `retryable` por status HTTP:**

| Código / condição | retryable | Efeito no circuit breaker | Tenta fallback? |
|---|---|---|---|
| 5xx, timeout, connection reset | `true` | Registra falha | Sim |
| 429 rate limit | `true` | Registra falha | Sim |
| 400 credit balance / 402 | `true` | Registra falha | Sim |
| 401 / 403 chave inválida | `false` | **Não** registra falha | **Sim** (fallback tem chave diferente) |
| Context length / model not found | `false` | Não registra falha | Não (fallback teria mesmo problema) |

> **Importante:** `retryable` governa **apenas** se o circuit breaker registra a falha. O fallback **sempre é tentado** se configurado, exceto nos casos marcados "Não" acima. Não confundir os dois conceitos.

#### 3.2.3. Registry

```ts
// src/lib/ai/adapters/registry.ts
export function createClient(provider: AIProvider, apiKey: string): LlmClient {
  switch (provider) {
    case 'ANTHROPIC':  return new AnthropicAdapter(apiKey);
    case 'OPENAI':     return new OpenAIAdapter(apiKey);
    case 'GOOGLE':     return new GoogleAdapter(apiKey);
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
    apiKey: string; // plaintext — NÃO cachear em Redis, apenas in-memory
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
      `Sem chave configurada para provider ${provider} na feature "${featureCode}". Configure em /admin/ai.`,
    );
  }

  // Validar suporte a embedding antes de sair do resolver
  if (feature.category === 'SEARCH') {
    const testClient = createClient(provider, 'test');
    if (!testClient.supportsEmbedding) {
      throw new FeatureNotAvailableError(
        `Provider ${provider} não suporta embeddings. Feature "${featureCode}" requer OpenAI ou Google.`,
      );
    }
  }

  const apiKey = decryptField(rawKey);
  const source = tenantFeature?.providerOverride
    ? 'tenant_feature_override'
    : feature.defaultProvider
      ? 'ai_feature_default'
      : 'tenant_global';

  const primary = { provider, model, apiKey, source };

  // Curto-circuito: fallback com a mesma chave que o primary é inútil (mesma chave = mesma falha 401)
  let fallback: ResolvedAiConfig['fallback'] = undefined;
  if (tenantFeature?.fallbackProvider && tenantFeature.fallbackApiKeyEncrypted) {
    const fallbackKey = decryptField(tenantFeature.fallbackApiKeyEncrypted);
    if (fallbackKey !== apiKey) { // chaves diferentes = fallback útil
      fallback = {
        provider: tenantFeature.fallbackProvider,
        model:    tenantFeature.fallbackModel!,
        apiKey:   fallbackKey,
        source:   'tenant_feature_override',
      };
    }
  }

  return { primary, fallback, featureId: feature.id, status: tenantFeature?.status ?? 'INCLUDED' };
}
```

#### 3.2.5. Circuit breaker por (provider, tenant)

```ts
// src/server/services/ai-circuit-breaker.ts
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

> **⚠️ Limitação em ambiente serverless (Vercel):** o Map é in-memory por pod. Com múltiplos pods simultâneos, o estado do breaker não é compartilhado — o threshold de "3 falhas" nunca acumula de forma global. Isso é aceitável no MVP: o circuit breaker protege por pod, não globalmente. Para proteção global real, migrar o estado para Redis (já disponível via BullMQ) em sprint futuro. Reset no restart é intencional e aceitável.

TTL: limpar breakers ociosos >1h para evitar memory leak.

#### 3.2.6. Orquestração com fallback

```ts
// src/lib/ai/call.ts
export async function callAiWithFallback<T>(
  featureCode: string,
  tenantId: string,
  fn: (client: LlmClient, model: string) => Promise<T>,
): Promise<{ result: T; usedProvider: AIProvider; usedFallback: boolean }> {
  const config = await resolveAiConfig(featureCode, tenantId);
  const attempts = [
    { ...config.primary, isFallback: false },
    ...(config.fallback ? [{ ...config.fallback, isFallback: true }] : []),
  ];

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
      // retryable controla APENAS o circuit breaker — não impede tentar o fallback
      if (providerErr.retryable !== false) {
        breaker.recordFailure();
      }
      // loop continua para o próximo attempt independente do retryable
    }
  }

  throw lastError ?? new Error('Todas as tentativas de IA falharam.');
}
```

#### 3.2.7. Refactor consumidores — DataMaskingService obrigatório

> **🔴 Regra crítica:** cada service deve continuar passando pelo `DataMaskingService` antes de chamar `callAiWithFallback`. O refactor substitui `getAnthropic()` por `callAiWithFallback`, mas o fluxo de masking **não muda**.

Padrão obrigatório para todos os 5 services:

```ts
// PADRÃO CORRETO — DataMaskingService preservado
async summarizeCommunication(tenantId: string, rawText: string) {
  const { masked, map } = this.masking.mask(rawText); // 1. mascara PII

  const { result, usedProvider, usedFallback } = await callAiWithFallback(
    'communication-summary',
    tenantId,
    (client, model) =>
      client.chat({
        model,
        messages: [{ role: 'user', content: masked }], // 2. envia mascarado
        maxTokens: 1024,
      }),
  );

  const unmasked = this.masking.unmask(result.text, map); // 3. restaura PII
  await logAiUsage({ tenantId, featureCode: 'communication-summary', usedProvider, usedFallback, ... });
  return unmasked;
}
```

Services a refatorar (todos com o mesmo padrão):
- `communication-summary.service.ts`
- `conversion-rate-suggestion.service.ts`
- `email-link.service.ts`
- `document-compare.service.ts`
- `semantic-search.service.ts` — usa `client.embed()` em vez de `client.chat()`

`getAnthropic()` marcado `/** @deprecated — usar callAiWithFallback(). Remoção Sprint 15G. */`

#### 3.2.8. Logging enriquecido

`logAiUsage()` ganha campos novos. Migration `0029_ai_usage_fallback_tracking`:

```sql
ALTER TABLE ai_usage_logs
  ADD COLUMN used_fallback BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN configured_provider "AIProvider";
```

---

### Fase 3 — UI `/admin/ai` refactor (~2.5 dias)

> Estimativa aumentada de 2 para 2.5 dias — Card D (alertas) tem mais estados do que aparenta.

#### 3.3.1. Card A — Configuração padrão do tenant

Campos: Provider · Modelo · Chave API (input password).

Botão "Testar chave":
- Chama `tenant.aiConfig.testKey({ provider, apiKeyEncrypted })` — **a chave é criptografada no frontend antes de sair** (usando a public key do Venzo) e descriptografada só no servidor.
- Nunca passar chave em plaintext como parâmetro tRPC (risco de log).
- O servidor faz uma chamada mínima ao provider e retorna `{ ok: boolean, latencyMs: number }`.
- Servidor garante que a chave **não aparece em nenhum log** (Axiom/Sentry) — usar `scrubFields: ['apiKey', 'apiKeyEncrypted']` no logger.

Audit obrigatório: `tenant.ai.updateGlobal`.

#### 3.3.2. Card B — Features por categoria

Tabela agrupada por `AiFeatureCategory`. Exemplo de linha:

| Feature | Status | Provider | Modelo | Chave | Fallback | Uso 30d |
|---|---|---|---|---|---|---|
| Resumo de comunicações | INCLUDED | Anthropic (padrão) | Haiku 4.5 (padrão) | Herdada | — | 234 chamadas |
| Busca semântica | INCLUDED | **OpenAI** | text-embedding-3-large | **Custom** | — | 890 chamadas |
| Sugestão de taxas | ADDON_ACTIVE | Anthropic | Sonnet 4.6 | Herdada | OpenAI GPT-4o | 12 chamadas (2 fallback) |

Modal de edit por feature:
- Provider: "Usar padrão do tenant" | "Custom: Anthropic/OpenAI/…"
- Modelo: Select filtrado por provider
- Chave: "Herdar" | "Definir chave própria" (com botão Testar — mesma regra de segurança do Card A)
- Fallback: trinca opcional (provider + modelo + chave)
- Alerta de custo: R$/mês opcional — envia broadcast quando ultrapassar
- Audit: `tenant.ai.updateFeature`

#### 3.3.3. Card C — Uso e custo

Reusa `ai_usage_logs`. Mostra:
- Total mês corrente: chamadas + tokens + custo R$
- Breakdown por feature: barra empilhada primary vs fallback
- Alertas ativos

#### 3.3.4. Card D — Alertas

Lista de alertas ativos com CTAs:
- 🟡 Feature X caiu em fallback N vezes nas últimas 24h
- 🔴 Feature Y sem chave configurada (não vai funcionar)
- 🔴 Provider Z em circuit aberto (aberto há Xmin) — **[limpar manualmente]** (ação de ADMIN)
- 🟡 Feature W com custo acima de R$ threshold definido

#### 3.3.5. Roteadores tRPC

```
tenant.aiConfig.updateGlobal({ provider, model, apiKeyEncrypted })
tenant.aiConfig.updateFeature({ featureId, ... })
tenant.aiConfig.testKey({ provider, apiKeyEncrypted })   // chave NUNCA em plaintext
tenant.aiConfig.listFeatures()
tenant.aiConfig.usageAndCost({ range: '30d' | '7d' | 'mtd' })
tenant.aiConfig.alerts()
tenant.aiConfig.clearCircuitBreaker({ provider })        // ADMIN only
```

Todos com `withCapability('ai', 'configure')`.

---

### Fase 4 — UI Platform `/platform/ai-marketplace` (~1 dia)

> Estimativa revisada de 0.5 para 1 dia — form de nova feature + % override não são triviais.

- Editar `defaultProvider`/`defaultModel` de cada feature (Platform Owner only).
- Toggle `active` (desativar feature globalmente).
- Mostrar % de tenants em override vs padrão.
- Adicionar feature nova (form: code, name, description, category, defaults, inclusão por plano).

Router `platform.aiMarketplace.updateFeature({ featureId, ... })` — `platformProcedure`.

---

## 4. Feature flag e rollout

### 4.1. Flag `MULTI_AI_ENABLED`

Env global (`.env.local` + Vercel config). Padrão `false` no MVP.

- `false` (default): consumidores continuam usando `getAnthropic()`. Sem impacto.
- `true`: consumidores usam `callAiWithFallback()`. Configuração vira per-feature.

`src/lib/env.ts`: `MULTI_AI_ENABLED: z.coerce.boolean().default(false)`.

### 4.2. Rollout gradual

| Fase | Ação |
|---|---|
| **1 (dev)** | Merge com flag `false`. Testes cobrem ambos os code paths. |
| **2 (interno — tenant Fred)** | `tenants.multi_ai_enabled = true` para marquezini. Validar 3–5 dias. |
| **3 (early adopters)** | 2–3 tenants Enterprise convidados. Acompanhar `ai_usage_logs` e fallback rate. |
| **4 (geral)** | Flag global `MULTI_AI_ENABLED=true` em produção após 30 dias sem regressão. |

### 4.3. Migração de tenants existentes

Ausência de override em `TenantAiFeature` = herda `AiFeature.defaultProvider` (populado em 0028). Features cuja default requer chave de outro provider (ex: `semantic-search` → OpenAI) aparecem como 🔴 alerta no Card D até o tenant configurar a chave.

---

## 5. Testes obrigatórios

### 5.1. Unit

- `resolveAiConfig`:
  - Feature inexistente → `FeatureNotAvailableError`
  - Tenant sem override → herda `ai_features.default_provider`
  - Tenant com override → usa override
  - Tenant com fallback configurado → retorno inclui `fallback`
  - Feature default OpenAI + tenant sem key OpenAI → erro "sem chave"
  - Feature SEARCH + provider sem `supportsEmbedding` → `FeatureNotAvailableError` em resolve time (não em runtime)
  - Fallback com mesma chave que primary → `fallback: undefined` (curto-circuito)
- `callAiWithFallback`:
  - Primary sucede → não chama fallback
  - Primary 5xx → fallback sucede → `usedFallback=true`
  - Primary + fallback ambos falham → throw last error
  - Circuit aberto no primary → pula pro fallback
  - Primary 401 (retryable=false) → circuit breaker **não** registra falha, mas fallback **é tentado**
  - `retryable=false` com model not found → fallback **não** tentado (mesma falha esperada)
- Adapters:
  - `AnthropicAdapter.chat` mapeia corretamente para `LlmChatResult`
  - `OpenAIAdapter.embed` retorna vetores no formato esperado
  - Erros de provider mapeados para `AiProviderError` com `retryable` correto
- Circuit breaker:
  - Isolamento por tenant: falha em (Anthropic, tenantA) não afeta (Anthropic, tenantB)
  - Cooldown expira corretamente
  - Limpeza de breakers ociosos >1h
- DataMaskingService preservado:
  - Cada service refatorado: PII mascarado antes de `callAiWithFallback`, desmascarado depois
  - Nenhum dos 5 services passa texto raw diretamente ao adapter

### 5.2. Integração

- Refactor dos 5 services: funciona com flag `false` (path antigo) E flag `true` (path novo).
- E2E `/admin/ai`: cadastra provider → features carregam → edita override → salva → chamada real usa override.
- `testKey`: chave não aparece em logs do servidor (verificar Axiom dev).

### 5.3. RBAC

- Sem `ai:configure` → 403 em todos os endpoints de `/admin/ai`.
- Platform Owner acessa `/platform/ai-marketplace`, tenant admin não.

### 5.4. Segurança

- Chave criptografada nunca aparece em log/response tRPC.
- Chave editada por Platform Owner impersonando → auditada com `actorUserId`.
- Race condition em updates simultâneos → last write wins + ambos registrados em `audit_logs`.

---

## 6. Riscos e decisões

### 6.1. Cache de resolução

`resolveAiConfig` faz 3 queries por chamada (~30ms). Em features de alto volume recomenda-se cache in-memory por `(tenantId, featureCode)` com TTL 5 min.

**Regra crítica:** o cache guarda apenas metadata (provider, model, source) — **nunca a `apiKey` em plaintext**. Invalidar todo o cache do tenant quando `/admin/ai` salva qualquer alteração.

**Decisão:** implementar no Sprint 15F.

### 6.2. Custo do fallback silencioso

Se Anthropic (barato) falha e fallback é GPT-4 (5–10x mais caro), custo aumenta sem aviso. Campo `cost_alert_brl_monthly` em `TenantAiFeature` é opcional, mas UI deve mostrar warning ao configurar fallback.

**Decisão:** warning + campo opcional. Tenant sabe o que faz.

### 6.3. Provider embeddings vs chat

`LlmClient.embed` é opcional com flag `supportsEmbedding` explícito. Anthropic não tem embedding nativo (usa Voyage AI como parceiro). Manter métodos opcionais por agora; separar interfaces quando semantic-search ganhar múltiplos provedores concorrentes.

### 6.4. LGPD — BYOK

Cada provider processa dados do tenant. Política Venzo: **cliente responsável** (BYOK). Venzo fornece key própria para trial; depois cliente traz a própria e assina DPA com o provider escolhido.

### 6.5. Deprecação de `getAnthropic()`

Marcado `@deprecated` no Sprint 15F. Removido no Sprint 15G após migração completa e safety window de ~30 dias.

### 6.6. Rate limit granular

`TenantAiLimits` atual é por tenant/global. Com per-feature, evolui para `TenantAiLimits(tenantId, provider, feature?)`. **Fora do escopo do Sprint 15F** — Sprint 15G.

### 6.7. Circuit breaker multi-pod (serverless)

Estado in-memory não compartilhado entre pods Vercel. Threshold de "3 falhas" acumula por pod. Aceitável no MVP. Migrar estado para Redis (já disponível via BullMQ) em sprint futuro se proteção global for necessária.

---

## 7. Estimativa dia-a-dia (revisada)

| Dia | Fase | Entregas |
|---|---|---|
| 1 | Fase 1 | Migration 0028 + schema.prisma + prisma generate + seed |
| 2 | Fase 2.1–2.3 | `LlmClient` interface + `supportsEmbedding` flag + AnthropicAdapter + OpenAIAdapter + tests unit |
| 3 | Fase 2.4–2.5 | GoogleAdapter + PerplexityAdapter + circuit breaker por-(provider, tenant) + tests |
| 4 | Fase 2.6–2.7 | `resolveAiConfig` (com curto-circuito same-key + embedding validation) + `callAiWithFallback` + tests |
| 5 | Fase 2.7–2.8 | Refactor 5 services (DataMaskingService preservado) + migration 0029 + logging enriquecido |
| 6 | Fase 3.1–3.3 | Card A (+ testKey seguro) + Card B (modal edit) + tRPC routers |
| 7 | Fase 3.4–3.6 + Fase 4 | Card C + Card D + clearCircuitBreaker + Platform Marketplace |
| 8 | Rollout + Docs | Feature flag + rollout Fred + smoke E2E + CLAUDE.md |

Buffer embutido nos dias 7–8. Estimativa total: **8 dias**.

---

## 8. Referências

- Schema atual: `prisma/schema.prisma` linhas 44–65 (enums), 380–384 (Tenant), 1709–1744 (AiFeature/TenantAiFeature)
- Sprint 15B: `docs/Sprint_15B_AI_Ops_Platform.md` — origem do AiFeature/TenantAiFeature
- P-14: `docs/Backlog_Pos_MVP.md` — per-tenant AI key (pré-requisito)
- feature-gate atual: `src/lib/ai/feature-gate.ts`
- DataMaskingService: `src/lib/ai/masking.ts`
- Consumidores: `src/server/services/{communication-summary,conversion-rate-suggestion,email-link,document-compare,semantic-search}.service.ts`

---

## 9. Definição de pronto (revisada)

- [ ] Todas as 4 fases mergeadas no main
- [ ] `npm test` verde (baseline + testes novos)
- [ ] `npx tsc --noEmit` verde
- [ ] `npm run lint` verde
- [ ] Migration 0028 e 0029 aplicadas em Neon (dev + staging)
- [ ] `MULTI_AI_ENABLED=true` funciona pro tenant Fred sem regressão nos 5 services
- [ ] Verificado: DataMaskingService chamado em todos os 5 services refatorados (grep: `masking.mask` em cada service)
- [ ] Fred configura OpenAI em `semantic-search` → chamada real usa OpenAI
- [ ] Fred configura fallback Anthropic→OpenAI em `communication-summary`, força primary a falhar → fallback ativa em `ai_usage_logs`
- [ ] `testKey` testado: chave **não aparece** nos logs Axiom de dev
- [ ] `/platform/ai-marketplace` permite Platform Owner editar defaults
- [ ] `getAnthropic()` marcado `@deprecated` com nota de remoção no Sprint 15G
- [ ] CLAUDE.md atualizado com seção "IA — de-para tipo de operação → provider"
- [ ] Backlog_Pos_MVP.md marca P-18 como ✅ FECHADO
