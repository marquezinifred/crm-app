# Sprint 15B — AI Operations + Plataforma Estratégica

Pré-requisito de **escala** — necessário antes de lançar o segundo
ou terceiro serviço de IA como add-on pago. Dá pra ir a produção
sem 15B, mas não dá pra crescer sem ele.

**Pré-requisito:** Sprint 15A entregue (precisa do `/platform/*`
shell e do `PLATFORM_OWNER` operacional).

Esforço estimado: **4–5 dias**.

---

## 1. AI Operations Center

### Por que existe

Hoje o Venzo usa Anthropic SDK + pgvector + Perplexity sem
visibilidade centralizada. Cada chamada de IA grava em `ai_usage_logs`
(Sprint 4) mas:

- Não há limites configuráveis por tenant
- Não há toggle granular por feature de IA por tenant
- Não há alertas de anomalia (consumo 3x maior que ontem)
- Não dá pra pinar modelo (Haiku → Sonnet) por tenant
- Não dá pra ver custo agregado em R$ por tenant por provider

Resultado: quando um cliente Enterprise quer ligar busca semântica
mas Starter não, hoje é codificação manual. Quando um tenant bug
manda 100k requests, descobrimos pela fatura no fim do mês.

### Schema

Migration **0017_ai_ops**:

```sql
-- Limites de IA por tenant (configurável pelo Platform Owner)
CREATE TABLE tenant_ai_limits (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Limite de tokens por mês (input + output somados)
  monthly_token_limit bigint,
  -- Limite de requests por dia
  daily_request_limit int,
  -- Modelo pinado (override do default do plano)
  pinned_model_haiku text,    -- 'claude-haiku-4-5-20251001' ou null
  pinned_model_sonnet text,   -- override do sonnet também
  -- Alerta automático
  anomaly_threshold_multiplier numeric DEFAULT 3.0,
    -- 3x = se consumo de hoje > 3 × média 7d, dispara alerta
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz DEFAULT now()
);

-- Snapshot diário pra reduzir custo de query nos dashboards
CREATE TABLE ai_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,    -- 'anthropic', 'perplexity', 'openai'
  model text NOT NULL,
  date date NOT NULL,
  request_count int NOT NULL DEFAULT 0,
  tokens_input bigint NOT NULL DEFAULT 0,
  tokens_output bigint NOT NULL DEFAULT 0,
  cost_brl numeric(12,4) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, provider, model, date)
);
CREATE INDEX ai_usage_daily_tenant_date_idx ON ai_usage_daily (tenant_id, date DESC);

-- Alertas de anomalia disparados (timeline pro Platform Owner)
CREATE TYPE "AiAnomalyType" AS ENUM ('TOKEN_SPIKE', 'REQUEST_SPIKE', 'LIMIT_REACHED');

CREATE TABLE ai_anomaly_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type "AiAnomalyType" NOT NULL,
  detected_at timestamptz DEFAULT now(),
  details jsonb NOT NULL,    -- { yesterday: 1500, today: 8200, multiplier: 5.47 }
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id)
);
```

### Worker job — agregação diária

`src/jobs/ai-usage-rollup.worker.ts`:

```ts
// Roda 00:30 BRT todos os dias
// Pra cada (tenant, provider, model) do dia anterior:
//  - Soma request_count, tokens, cost_brl de ai_usage_logs
//  - Upsert em ai_usage_daily
//  - Checa anomalia vs média 7d → cria ai_anomaly_alert se necessário
//  - Notifica Platform Owner via email/in-app se anomaly
```

Custo R$ é calculado a partir da tabela de preços vigente (Anthropic
e Perplexity) hardcoded em `src/lib/ai/pricing.ts`, com dólar fixado
em env `USD_BRL_RATE` (default 5.10). Plataforma cobra +20% margin
quando rebill pro tenant.

### Telas

**`/platform/ai-ops`** — dashboard cross-tenant:

| Bloco | Conteúdo |
|---|---|
| Total mês | Tokens (input/output) + R$ + requests, breakdown por provider |
| Top 10 tenants | Por consumo de tokens / R$ (ordenado) |
| Anomalias ativas | Lista de `ai_anomaly_alerts` não-acknowledged |
| Trend 30d | Gráfico de linha tokens/R$ por dia |

**`/platform/tenants/[id]/ai`** — drilldown por tenant:

| Bloco | Conteúdo |
|---|---|
| Limites configurados | Form pra editar `tenant_ai_limits` |
| Uso vs limite | Barra de progresso (X tokens de Y limite) |
| Provider breakdown | Tabela: provider/model/requests/tokens/R$ no mês |
| Histórico | Gráfico 90d + tabela `ai_usage_daily` paginada |
| Modelos pinados | Toggle pra forçar Haiku ou Sonnet (override do plano) |
| Anomalias | Histórico de alerts deste tenant |

### Procedures tRPC

```ts
platform.aiOps.summary           // dashboard cross-tenant
platform.aiOps.byTenant(id)      // drilldown
platform.aiOps.setLimits(input)  // editar tenant_ai_limits
platform.aiOps.acknowledgeAlert(alertId)
platform.aiOps.listAnomalies(filters)
```

### Enforcement no app

`src/lib/ai/claude.ts` ganha **guard**:

```ts
async function callClaude(prompt: string, ctx: CallContext) {
  const limits = await getLimitsForTenant(ctx.tenantId);
  const usage = await getCurrentMonthUsage(ctx.tenantId);

  if (limits.monthly_token_limit && usage.tokens >= limits.monthly_token_limit) {
    throw new AiLimitExceededError('Monthly token limit reached');
  }
  if (limits.daily_request_limit && usage.todayRequests >= limits.daily_request_limit) {
    throw new AiLimitExceededError('Daily request limit reached');
  }

  // Usa modelo pinado se houver, senão default do plano
  const model = limits.pinned_model_haiku ?? defaultModelForPlan(ctx.plan);

  const result = await anthropic.messages.create({ model, ... });
  await logAiUsage({ ...ctx, model, tokens: result.usage });
  return result;
}
```

UI mostra "IA temporariamente indisponível — limite mensal atingido"
quando bate o limite. Banner no AppShell sugere upgrade.

---

## 2. AI Marketplace — Catálogo de serviços

### Por que existe

Hoje pra "lançar feature de IA paga" o caminho é: codar a feature
+ adicionar lógica de feature flag + decidir em código quem tem acesso
+ atualizar billing pra cobrar add-on. Isso é caro e burocrático.

**Com o catálogo:** lançar uma nova feature vira **uma linha** no
banco. Time comercial habilita/desabilita por tenant via UI sem
precisar de dev.

Diferença vs Unleash:
- Unleash = feature flags **técnicos** (release control, A/B test)
- AI Marketplace = **catálogo de produto** com pricing, descrição
  pro usuário final, default por plano

### Schema

Migration **0018_ai_marketplace**:

```sql
CREATE TYPE "AiFeatureCategory" AS ENUM ('SUMMARIZATION', 'SCORING',
  'SEARCH', 'CLASSIFICATION', 'GENERATION', 'EXTRACTION');

-- Catálogo de features de IA disponíveis na plataforma
CREATE TABLE ai_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,         -- 'lead-scoring', 'contract-analysis'
  name text NOT NULL,
  description text NOT NULL,         -- descrição pro usuário final
  category "AiFeatureCategory" NOT NULL,
  -- Default de inclusão por plano (JSON {plan: 'included' | 'addon' | 'disabled'})
  default_inclusion jsonb NOT NULL,
  -- Preço como add-on (R$/mês ou R$/uso)
  addon_price_brl_monthly numeric(10,2),
  addon_price_brl_per_use numeric(10,4),
  -- Modelo padrão usado pela feature
  default_provider text NOT NULL,
  default_model text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TYPE "AiFeatureStatus" AS ENUM ('DISABLED', 'INCLUDED', 'ADDON_ACTIVE');

-- Estado por tenant
CREATE TABLE tenant_ai_features (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_id uuid NOT NULL REFERENCES ai_features(id) ON DELETE CASCADE,
  status "AiFeatureStatus" NOT NULL,
  -- Quando addon foi ativado (pra billing pro-rata)
  addon_activated_at timestamptz,
  addon_deactivated_at timestamptz,
  -- Quem habilitou (rastreabilidade)
  enabled_by uuid REFERENCES users(id),
  notes text,
  PRIMARY KEY (tenant_id, feature_id)
);
```

### Seed inicial — features já existentes no Venzo

```sql
INSERT INTO ai_features (code, name, description, category, default_inclusion, default_provider, default_model) VALUES
('communication-summary', 'Resumo de comunicações',
 'Cole um e-mail ou WhatsApp; a IA gera resumo estruturado em 4 blocos + tarefas',
 'SUMMARIZATION',
 '{"STARTER": "disabled", "PRO": "included", "ENTERPRISE": "included"}',
 'anthropic', 'claude-haiku-4-5-20251001'),

('semantic-search', 'Busca semântica',
 'Busca por significado no histórico de comunicações (não só keyword)',
 'SEARCH',
 '{"STARTER": "disabled", "PRO": "addon", "ENTERPRISE": "included"}',
 'openai', 'text-embedding-3-small'),

('proposal-version-diff', 'Comparador de versões',
 'IA gera resumo de diferenças entre duas versões de proposta/contrato',
 'EXTRACTION',
 '{"STARTER": "disabled", "PRO": "included", "ENTERPRISE": "included"}',
 'anthropic', 'claude-sonnet-4-6'),

('email-routing', 'Roteamento de e-mail inbound',
 'IA decide qual oportunidade vincular ao e-mail recebido',
 'CLASSIFICATION',
 '{"STARTER": "disabled", "PRO": "included", "ENTERPRISE": "included"}',
 'anthropic', 'claude-haiku-4-5-20251001'),

('conversion-rate-suggestion', 'Sugestão de taxas de conversão',
 'IA sugere taxas de conversão por estágio baseado em histórico ou benchmark',
 'GENERATION',
 '{"STARTER": "disabled", "PRO": "included", "ENTERPRISE": "included"}',
 'anthropic', 'claude-haiku-4-5-20251001');

-- Futuros (lançamentos):
-- ('lead-scoring', 'Score de oportunidade com IA', ...)
-- ('contract-clause-analysis', 'Análise de cláusulas de contrato', ...)
-- ('next-best-action', 'Sugestão de próxima ação', ...)
```

### Telas

**`/platform/ai-marketplace`** — catálogo:

| Coluna | Conteúdo |
|---|---|
| Code / Nome | Identificador + label |
| Categoria | Badge |
| Provider/Model | Default |
| Plano default | Tabela compacta (STARTER ✗ / PRO ✓incluso / ENT ✓incluso) |
| Add-on R$/mês | Preço |
| Tenants ativos | Count com filter no click |
| Ações | Editar, Ativar/Desativar globalmente |

**`/platform/tenants/[id]/ai/features`** — gerenciamento por tenant:

Lista de features com **3 toggles** (disabled / included / addon_active)
+ data de ativação se addon. Botão "Aplicar default do plano" reseta.

### Guard no código

`callAiFeature(featureCode, ctx)` substitui chamadas diretas:

```ts
// src/lib/ai/feature-gate.ts
export async function callAiFeature<T>(
  featureCode: string,
  ctx: { tenantId: string },
  fn: (model: string) => Promise<T>,
): Promise<T> {
  const access = await getTenantFeatureAccess(ctx.tenantId, featureCode);
  if (access.status === 'DISABLED') {
    throw new FeatureNotAvailableError(`AI feature '${featureCode}' not available in your plan`);
  }
  const model = await resolveModel(ctx.tenantId, featureCode);
  return fn(model);
}
```

Cada chamada de IA existente (`communication-summary`, `semantic-search`,
etc) passa pelo `callAiFeature`. UI exibe upsell quando feature é
add-on não-ativo: "🔓 Disponível como add-on por R$ 89/mês — Ativar".

---

## 3. Tenant Health Score

### Schema

Migration **0019_tenant_health**:

```sql
-- Snapshot diário (worker calcula)
CREATE TABLE tenant_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  -- Sinais de uso (0-100 cada)
  signal_logins int,              -- logins últimos 30d / metric esperada por plano
  signal_opps_created int,        -- opps criadas no mês / metric esperada
  signal_features_used int,       -- # features de IA ativadas vs disponíveis
  signal_nps int,                 -- último NPS (opcional)
  signal_open_tickets int,        -- tickets de suporte abertos > 7d
  signal_trial_progress int,      -- só se TRIAL — % de setupCompleted
  signal_evaluations int,         -- avaliações registradas no mês
  signal_resource_usage int,      -- uso de recursos vs limite (users, storage, tokens IA)
  -- Score composto 0-100
  health_score int NOT NULL,
  -- Bucket pra dashboard
  bucket text NOT NULL,           -- 'GREEN' / 'YELLOW' / 'RED'
  -- Razão
  reasons jsonb,                  -- ['Sem login há 14d', 'Limite IA 95%']
  UNIQUE (tenant_id, date)
);

CREATE INDEX tenant_health_date_idx ON tenant_health_snapshots (date DESC);
CREATE INDEX tenant_health_bucket_idx ON tenant_health_snapshots (bucket) WHERE date = CURRENT_DATE;
```

### Worker — `health-score-rollup.worker.ts`

Roda 02:00 BRT. Pra cada tenant calcula 8 sinais + score composto +
bucket + reasons. Aplica regras:

```ts
function calculateHealthScore(tenant: Tenant): HealthSnapshot {
  const signals = {
    logins: scoreLogins(tenant),        // 100 se >= esperado, decresce
    oppsCreated: scoreOpps(tenant),
    featuresUsed: scoreFeatures(tenant),
    nps: scoreNps(tenant),
    openTickets: scoreTickets(tenant),
    trialProgress: scoreTrial(tenant),
    evaluations: scoreEvals(tenant),
    resourceUsage: scoreResources(tenant),
  };
  // Pesos definidos por plano (Enterprise dá mais peso pra features/NPS,
  // Starter dá mais peso pra logins/opps básicas)
  const weights = WEIGHTS_BY_PLAN[tenant.plan];
  const score = weighted_avg(signals, weights);
  const bucket = score >= 70 ? 'GREEN' : score >= 40 ? 'YELLOW' : 'RED';
  const reasons = collectReasons(signals);
  return { ...signals, health_score: score, bucket, reasons };
}
```

### Telas

**`/platform/health`** — visão CS/vendas:

| Bloco | Conteúdo |
|---|---|
| Tenants em risco (RED) | Lista priorizada pra contato CS |
| Tenants em alerta (YELLOW) | Lista |
| Prontos pra upsell | YELLOW/GREEN com uso > 80% do limite ou NPS > 8 |
| Tendência | Gráfico % de cada bucket nos últimos 90d |

Cada linha tem botões: "Ver tenant", "Marcar contato feito",
"Estender trial", "Oferecer upgrade" (gera link pro Customer Portal Stripe).

### Régua de incentivo de utilização

Bonus: notificações in-app pros admins dos tenants em YELLOW/RED:
- "Você não usou IA nos últimos 14 dias. Quer ver o que ela faz?"
  com link pra tour
- "Sua equipe pode estar perdendo tempo. Resumo de comunicações
  poupa ~3h/semana por vendedor."

Configurável em `/platform/health/regua` com targeting por bucket.

---

## 4. Pipeline de trials e onboarding próprio

### Schema

Reusa `tenants.trialEndsAt` (Sprint 12) + adiciona:

Migration **0020_trial_pipeline**:

```sql
ALTER TABLE tenants ADD COLUMN
  trial_source text,                  -- 'organic', 'referral', 'ad_campaign_X'
  trial_extended_count int DEFAULT 0, -- quantas vezes estendeu
  trial_conversion_at timestamptz,    -- quando virou ACTIVE
  trial_cancellation_at timestamptz,  -- quando cancelou
  trial_cancellation_reason text;     -- texto livre coletado no cancel

CREATE TABLE trial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,           -- 'STARTED', 'EXTENDED', 'CONVERTED',
                                      -- 'CANCELED', 'ABANDONED'
  created_at timestamptz DEFAULT now(),
  metadata jsonb                      -- { extended_days: 7, by_platform_user: X }
);
```

### Telas

**`/platform/trials`** — funil de trials:

| Coluna | Conteúdo |
|---|---|
| Tenant | Nome + slug |
| Source | Origem do trial |
| Início | Data |
| Dias restantes | + ⚠ se < 3d |
| Last login | Data |
| Setup % | Do onboarding-progress (Sprint 13) |
| Plano-alvo | (escolhido no signup) |
| Health | Bucket atual |
| Ações | Estender, Converter manualmente, Contatar |

Botão **+ Convert** abre fluxo manual de billing (pra cliente que
ligou pra "fechar offline" — Platform Owner cria sub na mão).

Botão **+ Extend** abre modal: +7d / +14d / +30d / custom. Atualiza
`trialEndsAt` + registra `trial_event`.

Coluna "Source" filtrable pra avaliar canais (organic vs paid).

### Métricas

`/platform/dashboard` ganha cards:
- Conversão trial → paid últimos 30d
- Tempo médio até conversão
- Top 3 sources de trial

---

## 5. Broadcast e comunicação com tenants

### Schema

Migration **0021_broadcast**:

```sql
CREATE TYPE "BroadcastVariant" AS ENUM ('INFO', 'WARNING', 'DANGER', 'SUCCESS');
CREATE TYPE "BroadcastTarget" AS ENUM ('ALL', 'BY_PLAN', 'MANUAL_LIST');

CREATE TABLE broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  variant "BroadcastVariant" NOT NULL DEFAULT 'INFO',
  -- Targeting
  target "BroadcastTarget" NOT NULL,
  target_plans text[],                -- se BY_PLAN: ['STARTER', 'PRO']
  target_tenant_ids uuid[],           -- se MANUAL_LIST
  -- Schedule
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  -- Action opcional
  action_label text,
  action_url text,
  -- Metadados
  dismissible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id),
  active boolean DEFAULT true
);

CREATE INDEX broadcasts_active_window_idx
  ON broadcasts (starts_at, ends_at)
  WHERE active = true;

-- Dismissals por user (pra "não mostrar de novo")
CREATE TABLE broadcast_dismissals (
  broadcast_id uuid REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at timestamptz DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);
```

### Telas

**`/platform/broadcasts`** — lista + create:

| Coluna | Conteúdo |
|---|---|
| Título | Link pro detail |
| Variant | Badge (info/warning/danger/success) |
| Target | "Todos" / "Plano: PRO, ENT" / "12 tenants" |
| Window | starts_at — ends_at |
| Status | ACTIVE / SCHEDULED / EXPIRED / DRAFT |
| Visualizações | Count de users que viram |
| Dismissals | Count de users que dispensaram |

Modal de criar/editar com:
- Título + Mensagem (textarea, suporta markdown leve)
- Variant (radio)
- Target (radio + condicional: plans multi-select OU tenants picker)
- Schedule (datetime-local start + end opcional)
- Action (opcional: label + URL)
- Dismissible (checkbox)
- Preview do banner como aparece no AppShell

### Render no app

Substitui `MaintenanceBanner` do Sprint 14.5 por componente genérico:

```tsx
// src/components/layout/BroadcastBanners.tsx — render no AppShell
function BroadcastBanners() {
  const broadcasts = trpc.broadcasts.activeForCurrentUser.useQuery();
  return broadcasts.data?.map(b => (
    <Banner
      key={b.id}
      variant={b.variant.toLowerCase()}
      dismissible={b.dismissible}
      onDismiss={() => trpc.broadcasts.dismiss.mutate({ id: b.id })}
      action={b.action_url && <a href={b.action_url}>{b.action_label}</a>}
    >
      <strong>{b.title}</strong> {b.message}
    </Banner>
  ));
}
```

Procedure `broadcasts.activeForCurrentUser` resolve targeting:
- ALL → todos veem
- BY_PLAN → match com tenant.plan
- MANUAL_LIST → match com tenant.id

`broadcast_dismissals` controla "não mostrar de novo".

### Casos de uso imediatos

1. **Manutenção programada** — variant DANGER, target ALL, com window
2. **Anúncio de nova feature** — variant SUCCESS, target BY_PLAN
   (mostrar só pra ENTERPRISE)
3. **Pesquisa NPS** — variant INFO, target MANUAL_LIST (Q&A acima),
   action_url = link Google Forms
4. **Upsell direcionado** — variant INFO, target = tenants com
   health_score YELLOW, action_url = Stripe checkout

---

## Procedures tRPC (Sprint 15B)

Continuação do `platformRouter` do Sprint 15A:

```ts
platform.aiOps.*                  // (descrito acima)
platform.aiMarketplace.list / set
platform.aiMarketplace.tenantAccess.list / set
platform.health.list / byTenant / setBucketRules
platform.regua.list / create / activate / deactivate
platform.trials.list / extend / convertManual / cancel
platform.broadcasts.list / create / update / delete
platform.broadcasts.tenantTargeting.preview  // mostra quantos tenants
broadcasts.activeForCurrentUser              // pra todos os users autenticados
broadcasts.dismiss
```

---

## Testes

- Unit: `health-score-math.test.ts` — composição dos 8 sinais
- Unit: `ai-feature-gate.test.ts` — guard de feature access
- Unit: `broadcast-targeting.test.ts` — resolver ALL/BY_PLAN/MANUAL_LIST
- Integration: `ai-usage-rollup.test.ts` — worker rola corretamente
- Integration: `tenant-ai-limits-enforcement.test.ts` — limite bate erro
- E2E: Platform Owner cria broadcast targeting Pro → admin Pro vê banner;
  Starter não vê

---

## Critérios de aceite

- ✅ 5 migrations aplicadas (0017–0021)
- ✅ Worker `ai-usage-rollup` rodando 00:30 BRT diariamente
- ✅ Worker `health-score-rollup` rodando 02:00 BRT
- ✅ `callAiFeature(code, ctx)` envelopa todas as chamadas IA
  existentes; chamadas a `anthropic.messages.create` diretas zeradas
- ✅ Catálogo de features seedado com as 5 features existentes do
  Venzo (communication-summary, semantic-search, proposal-version-diff,
  email-routing, conversion-rate-suggestion)
- ✅ 5 novas telas em `/platform/*`: ai-ops, ai-marketplace, health,
  trials, broadcasts
- ✅ `MaintenanceBanner` (Sprint 14.5) substituído por sistema de
  broadcasts genérico
- ✅ Anomaly detection grava `ai_anomaly_alerts` quando consumo > 3×
  média 7d
- ✅ ≥ 15 novos testes passando, lint zero, type-check zero

## NÃO fazer

- Mudanças no AppShell que não sejam o BroadcastBanners
- Novas integrações de IA (OpenAI Functions, etc) — só catalogar
  o que já existe
- Stripe Metered Billing (cobrança de add-ons usage-based) —
  Sprint 16+
- Customer Portal customizações — Sprint 16+
