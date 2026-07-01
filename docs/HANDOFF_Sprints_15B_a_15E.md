# Handoff — Sprints 15B → 15E + fixes corretivos + débitos P-XX

**Período:** 2026-06-30 → 2026-07-01
**Estado geral:** type-check zero, lint zero, **576/582 testes** (4 falhas + 2 skipped pré-existentes por env vars — sem regressão desde baseline 262 do Sprint 14.5)
**Branch:** `main` local — nada em produção ainda
**Última revisão:** 2026-07-01 pós-merge de 4 chips paralelos (P-02, P-06, P-21, P-23) + Sprint 15D (paterna) + Sprint 15E disparado

Este documento resume o que foi entregue nas últimas sessões, o que ainda precisa ser feito, e onde estão os pontos de risco pra próxima pessoa (ou próxima sessão) continuar.

**Contexto histórico:** o handoff original v1 (2026-06-30) cobria só 15B → 15F backend. Esta v2 (2026-07-01) incorpora Sprints 15D e 15E, débitos P-08 a P-26 fechados, e UI residual do Sprint 15F entregue.

---

## 1. Sprints entregues (na ordem)

### 1.1. Sprint 15B — AI Operations + Plataforma Estratégica

**Spec:** [`docs/Sprint_15B_AI_Ops_Platform.md`](Sprint_15B_AI_Ops_Platform.md).

5 áreas de plataforma: AI Ops Center, AI Marketplace, Tenant Health Score, Trial Pipeline, Broadcast.

**Entregue:**
- 5 migrations (0017–0021) + 9 modelos + 5 enums novos
  (`AiAnomalyType`, `AiFeatureCategory`, `AiFeatureStatus`, `BroadcastVariant`, `BroadcastTarget`)
- Tenant ganhou colunas de trial (`trialSource`, `trialExtendedCount`,
  `trialConversionAt`, `trialCancellationAt`, `trialCancellationReason`)
- Camada AI-cost: [`src/lib/ai/pricing.ts`](../src/lib/ai/pricing.ts) (PRICE_TABLE + `usdToBrlWithMargin`), [`src/lib/ai/usage.ts`](../src/lib/ai/usage.ts), [`src/lib/ai/feature-gate.ts`](../src/lib/ai/feature-gate.ts) — `callAiFeature<T>()` com `AiLimitExceededError`/`FeatureNotAvailableError`
- Serviços puros: [`health-score.service.ts`](../src/server/services/health-score.service.ts) (8 sinais + `WEIGHTS_BY_PLAN` + buckets RED/YELLOW/GREEN), [`broadcast.service.ts`](../src/server/services/broadcast.service.ts) (targeting ALL/BY_PLAN/MANUAL_LIST)
- 2 workers cron: `ai-usage-rollup` (00:30 BRT) + `health-score-rollup` (02:00 BRT)
- 5 sub-routers em `platformRouter`: `aiOps`, `aiMarketplace`, `health`, `trials`, `broadcasts` + `broadcastsRouter` público
- 5 telas em `/platform/*` + itens novos no `PlatformShell`
- `BroadcastBanners` substituindo `MaintenanceBanner` quando há broadcast ativo
- +19 testes

### 1.2. Sprint 15C — Usabilidade, Forms, Listas Configuráveis e QuickCreate

**Spec:** [`docs/Sprint_15C_Usabilidade_Forms.md`](Sprint_15C_Usabilidade_Forms.md).
**Auditoria:** [`docs/auditoria_forms_15C.md`](auditoria_forms_15C.md).

**Entregue:**
- Migration `0022_company_address` — CEP, logradouro, numero, complemento, bairro em `companies`
- Migration `0023_configurable_lists` — 3 tabelas novas (`lead_sources`, `industries`, `contact_roles`) com position + isActive + soft delete + RLS + FKs opcionais em `opportunities.lead_source_id`, `companies.industry_id`, `contacts.contact_role_id`
- [`src/lib/cep/lookup.ts`](../src/lib/cep/lookup.ts) — BrasilAPI v2, 5 estados (`ok/not-found/rate-limited/error`)
- [`src/lib/utils/format.ts`](../src/lib/utils/format.ts) — `formatCNPJ`/`unformatCNPJ`/`formatCEP`/`unformatCEP`
- [`src/lib/data/brasil.ts`](../src/lib/data/brasil.ts) — 27 UFs + `useCidadesByUF` (IBGE Localidades)
- 3 routers tRPC em [`catalog.ts`](../src/server/trpc/routers/catalog.ts): `leadSources`, `industries`, `contactRoles` — cada um com list/create/update/remove/reorder + proteção "em uso"
- [`quick-create-trigger.tsx`](../src/components/ui/quick-create-trigger.tsx) — Dialog inline pra company/contact/product com recursão 1 nível
- [`CompanyForm.tsx`](../src/components/companies/CompanyForm.tsx) refatorado: máscara visual CNPJ + CEP + auto-fill BrasilAPI CEP + Select UF + Combobox cidade IBGE + endereço completo + Setor
- [`/admin/listas`](../src/app/admin/listas/page.tsx) — 5 tabs (Territórios/Segmentos/Origens/Setores/Cargos) com drag-to-reorder + toggle ativo + AlertDialog
- [`alert-dialog.tsx`](../src/components/ui/alert-dialog.tsx) + hooks `useDirtyConfirm` + `useAutoFocus`
- `Modal` ganhou `max-h-[90vh] overflow-y-auto` por padrão
- Cross-form: toast Venzo em `/pipeline/new`, `/contacts`, `/admin/products` + QuickCreate Empresa inline em `/pipeline/new` e `/contacts`
- +32 testes

### 1.3. Fix corretivo — Migration 0026 `clerk_id_per_scope`

Fechou débito da Sprint 15A: `UNIQUE(clerk_id)` global bloqueava a mesma pessoa ter Admin de tenant + Platform Owner.

**Iteração importante:** primeira versão usava `NULLS NOT DISTINCT` (Postgres 15+). **Deploy falhou** em banco com seed (`Key (clerk_id, tenant_id)=(null, ...) is duplicated`) porque seed tem ~30 users com `clerk_id NULL` (10 × 3 tenants). Substituído por **partial unique index** `WHERE clerk_id IS NOT NULL`.

**Entregue:**
- Migration `0026_clerk_id_per_scope` — DROP index antigo + CREATE UNIQUE partial `(clerk_id, tenant_id) WHERE clerk_id IS NOT NULL`
- Schema atualizado com comentário explicando que constraint real é PARTIAL (Prisma não tem sintaxe pra isso, migration SQL é a fonte da verdade)
- 5 call sites de `findUnique({clerkId})` → `findFirst`/`updateMany` com filtro por contexto:
  - [`clerk-sync.service.ts`](../src/server/services/clerk-sync.service.ts) — webhook `updateMany` em todas as facetas
  - [`clerk-sync.service.ts:deactivateUserFromClerk`](../src/server/services/clerk-sync.service.ts) — desativa todas
  - [`access-log.service.ts`](../src/server/services/access-log.service.ts) — filtra `tenantId: { not: null }`
  - [`onboarding.service.ts:findLocalUserByClerkId`](../src/server/services/onboarding.service.ts) — `orderBy tenantId asc nulls last`
  - [`/api/v1/reports/export`](../src/app/api/v1/reports/export/route.ts) e [`/api/v1/imports/upload`](../src/app/api/v1/imports/upload/route.ts) — filtram pelo `tenantId` do contexto

### 1.4. Sprint 15F — IA Multi-Provider por Feature + Fallback (backend)

**Spec:** [`docs/Sprint_15F_IA_Multi_Provider.md`](Sprint_15F_IA_Multi_Provider.md).

Feature flag `MULTI_AI_ENABLED` (default `false`) — path legado permanece ativo; ativar por-tenant em staging antes de flag global.

**Entregue (Fases 1–4 backend, sem UI dos 4 cards):**

**Migrations:**
- `0027_ai_multi_provider` — `defaultProvider` de TEXT → `AIProvider` enum + colunas em `tenant_ai_features` (providerOverride, modelOverride, apiKeyEncrypted, fallbackProvider, fallbackModel, fallbackApiKeyEncrypted, costAlertBrlMonthly, updatedAt) + index parcial de resolução
- `0028_ai_usage_fallback_tracking` — `ai_usage_logs.used_fallback` + `configured_provider` pra medir fallback rate

**Adapters ([`src/lib/ai/adapters/`](../src/lib/ai/adapters)):**
- [`types.ts`](../src/lib/ai/adapters/types.ts) — `LlmClient` interface, `AiProviderError`, `classifyStatus` (mapping padronizado HTTP → kind/retryable)
- [`anthropic.ts`](../src/lib/ai/adapters/anthropic.ts) — `AnthropicAdapter` (chat only, `supportsEmbedding: false`)
- [`openai.ts`](../src/lib/ai/adapters/openai.ts) — `OpenAIAdapter` (chat + embed) + `PerplexityAdapter` (extends OpenAI, baseURL `api.perplexity.ai`, `supportsEmbedding: false`)
- [`google.ts`](../src/lib/ai/adapters/google.ts) — `GoogleAdapter` (Gemini via REST direto, sem dep nova). Chat + embed
- [`registry.ts`](../src/lib/ai/adapters/registry.ts) — `createClient(provider, apiKey)` + `providerSupportsEmbedding(provider)`

**Orquestração:**
- [`breakers.ts`](../src/lib/ai/breakers.ts) — Map por-`(provider, tenant)`, TTL 1h, cleanup automático, `clearBreakers` + `snapshotBreakers`. In-memory (aceitável no MVP)
- [`resolve.ts`](../src/lib/ai/resolve.ts) — `resolveAiConfig` cascata (override → default → global), curto-circuito same-key, validação `supportsEmbedding` pra features SEARCH
- [`call.ts`](../src/lib/ai/call.ts) — `callAiWithFallback` respeitando: circuit aberto pula, `retryable=false` não registra mas fallback tenta, `MODEL_NOT_FOUND`/`CONTEXT_LENGTH` abortam sem fallback
- [`dispatch.ts`](../src/lib/ai/dispatch.ts) — `dispatchChat`/`dispatchEmbed` roteiam pelo `MULTI_AI_ENABLED`. Interface uniforme

**Refactor de 5 services preservando DataMaskingService:**
- [`communication-summary.service.ts`](../src/server/services/communication-summary.service.ts)
- [`conversion-rate-suggestion.service.ts`](../src/server/services/conversion-rate-suggestion.service.ts)
- [`email-link.service.ts`](../src/server/services/email-link.service.ts)
- [`document-compare.service.ts`](../src/server/services/document-compare.service.ts)
- [`semantic-search.service.ts`](../src/server/services/semantic-search.service.ts)

Cada service passa `masked` (não texto raw) ao dispatcher. Teste estrutural [`ai-masking-preserved.test.ts`](../tests/unit/ai-masking-preserved.test.ts) faz grep no source (ordem `masking.mask` → `dispatchChat`) pra pegar regressão em code review futuro.

`getAnthropic()` re-deprecated com nota de remoção Sprint 15G.

**Routers estendidos:**
- [`aiConfig`](../src/server/trpc/routers/ai-config.ts) — `listFeatures`, `updateFeature` (fallback trinca), `testKey` (retorna `{ok, latencyMs, reason?}` — **nunca eco a chave**), `breakerStatus`, `clearCircuitBreaker`. Audit em todas mutations (`tenant.ai.updateGlobal/updateFeature/clearCircuitBreaker`)
- [`platform.aiMarketplace.setFeature`](../src/server/trpc/routers/platform-ai-marketplace.ts) — Platform Owner edita `defaultProvider`/`defaultModel`

Env novo: `MULTI_AI_ENABLED` (default `false`).

### 1.5. Sprint 15D — Inbound Marketing Pipeline

**Spec:** [`docs/Sprint_15D_Inbound_Marketing.md`](Sprint_15D_Inbound_Marketing.md).
**Entregue pela paterna em 2026-07-01, 6 commits, 3817 insertions.**

Pipeline de captação inbound com parser híbrido (regex + IA fallback via `callAiWithFallback`).

**Entregue:**
- Migration `0029_inbound_marketing` — modelos `Lead`, `LeadScore`, `InboundForm`, `InboundSource`; tabelas com RLS + soft delete
- Enum `UserRole` ganha `GESTOR_INBOUND` **temporário** (será removido pelo Sprint 15E — vira permission override)
- Parser híbrido em [`src/server/services/inbound-parser.service.ts`](../src/server/services/inbound-parser.service.ts) — regex primeiro (matchers Typeform/RD/key-value/HTML), IA fallback via `callAiWithFallback('inbound-lead-parser', tenantId, ...)`. Preserva DataMaskingService.
- Endpoint público `POST /api/v1/inbound/lead` — sem auth, resolve tenant via slug, valida via Zod, enfileira no worker
- Worker BullMQ [`src/jobs/inbound-lead-create.worker.ts`](../src/jobs/inbound-lead-create.worker.ts) — cria Lead assíncronamente + notifica GESTOR_INBOUND via broadcast
- Router tRPC [`inbound.ts`](../src/server/trpc/routers/inbound.ts) — `list`, `assign`, `dismiss`, `getById`, `stats`
- UI [`/inbox/prospects`](../src/app/inbox/prospects/page.tsx) — fila de leads aguardando alocação com modal Alocar (dropdown vendedores)
- UI [`/admin/email-inbound`](../src/app/admin/email-inbound/page.tsx) ganha 2 tabs (Forms de captura + Histórico)
- UI [`/reports/inbound-vs-outbound`](../src/app/reports/inbound-vs-outbound/page.tsx) — comparativo funil + conversion rate + cycle time
- +12 testes (parser +6 casos: Typeform/RD/HTML/key-value/regex/IA fallback; router +4 shape; analytics +2)

### 1.6. Sprint 15E — RBAC Granular (⚡ em execução na paterna)

**Spec v3:** [`docs/Sprint_15E_RBAC_Granular.md`](Sprint_15E_RBAC_Granular.md) — 1271 linhas.
**Matriz:** [`docs/permission-matrix.md`](permission-matrix.md) — 65 permissions × 7 roles, contagens validadas célula a célula.
**Chip disparado:** `task_7965b8c7` em 2026-07-01.

**Objetivo:** refactor do RBAC role-based pra permissions granulares configuráveis por user via overrides individuais. Remove `GESTOR_INBOUND` do enum (vira permission override); resolve proliferação de roles.

**Escopo (executor em andamento):**
- Migration 0030 — `user_permission_overrides` + `users.cached_permissions` (nullable) + backfill `GESTOR_INBOUND → ADMIN` + cast enum via text (pattern migration-pitfalls #1) + `ON CONFLICT DO NOTHING`
- `src/lib/auth/permissions-catalog.ts` novo com 65 permissions (35 atuais + 30 novas cobrindo Sprint 15D/15F/P-19/P-20)
- `ROLE_DEFAULT_PERMISSIONS` com contagens exatas: ADMIN=60, DIRETOR_C=39, DIRETOR_O=25, DIRETOR_F=18, GESTOR=31, ANALISTA=23, PARCEIRO=5
- `hasPermission(userId, perm)` async com cache + `hasPermissionByRole` síncrono
- Middleware `withPermission(perm)` tRPC
- Refactor de **47 procedures** de `withRoles`/`withCapability` pra `withPermission`
- UI `/admin/users/[id]/permissions` — 3 estados visuais (concedida/revogada/neutro) + histórico inline
- Router `permissions` (`listCatalog`, `forUser`, `grant`, `revoke`, `restore`, `whoHas`)
- `approval_rules.approver_permission` alternativa a `approver_roles` (backward compat via CHECK XOR)
- Script `scripts/rbac-backfill-cache.ts` idempotente pós-migration

**3 correções críticas destacadas no chip:**
- **§6.4** `opportunity:read_others` enforcement — ANALISTA passa a ver só as próprias opps (breaking change comunicado no CLAUDE.md)
- **§6.5** guard anti-escalada em `permissions.grant/revoke/restore` — só quem tem a permission pode delegá-la (Platform Owner isento)
- **§5.4** rollout ordenado obrigatório em produção (migrate → backfill script → deploy → monitorar) pra evitar `whoHas` vazio silenciosamente

Estimativa: 8–10 dias em 4 fases (Fundação → 47 procedures → UI + router → Compat + rollout).

**Estado atual:** chip trabalhando. Merges dos itens Sprint 15A backfill preservados; Sprint 15D fechou como pré-requisito de âncora. Sprint 15F fornece permissions granulares de AI já usadas na matriz.

---

## 1.7. Débitos P-XX fechados nesta série

Além dos sprints, foram fechados 20+ débitos identificados em uso real. Todos com commit + testes + docs.

**Alto impacto:**
- **P-04** `tenantIdOverride` em 55 audit() de 19 routers — silencing bug de audit
- **P-11** middleware inject headers Platform em dual identity — 403 no `/platform/dashboard` pra Fred
- **P-12** modal rouba foco a cada keystroke — 12 forms intestáveis
- **P-13** interceptor 401 tRPC — "Unable to transform response" virou reload gracioso
- **P-14** IA per-tenant key — `getAnthropicForTenant` substitui singleton global
- **P-15** msg erro IA real (400 credit low, 401, 429, 5xx) — antes engolia com "IA indisponível"
- **P-16** Command Palette ⌘K — botão morto virou busca global funcional
- **P-17** ordenamento clicável em 8 tabelas — infra + hook + rollout
- **P-19** upload real de documentos + templates — dropzone + SHA-256 client-side + tRPC proxy → S3
- **P-20** CRUD tarefas na oportunidade — criar/editar/deletar com modal design system
- **P-22** indicação de tenant destino no modal invite — badge impersonação
- **P-23** UI `/admin/ai` 4 Cards (Sprint 15F residual) + refino (Card C fallback breakdown + Card D alertas)
- **P-24** form "Adicionar Feature" em `/platform/ai-marketplace`
- **P-06** drilldowns AI por tenant `/platform/tenants/[id]/ai` (Sprint 15B residual)

**Menor impacto (cosmético/polimento):**
- **P-02** PageHeader consistente em 10 rotas /admin
- **P-08** logout do Clerk no Topbar
- **P-09** msg erro IA enganosa (pré-req do estágio antes de resumir)
- **P-10** rename "Campos do estágio atual" → nome semântico ("Agendamento de reunião")
- **P-21** erro Zod amigável (extrai `fieldErrors[0]` em vez de JSON.stringify raw)
- **P-26** PageHeader em 7 rotas fora de /admin (`/pipeline`, `/inbox`, `/contacts`, etc.)

**CSP fix:** BrasilAPI liberada em `connect-src` (CNPJ + CEP autofill do Sprint 15C estavam sendo bloqueados silenciosamente pelo CSP do Sprint 11).

---

## 2. Estado dos testes

| Suite | Contagem |
|---|---|
| Baseline pré-15B | 262 |
| +19 (Sprint 15B) | 281 |
| +32 (Sprint 15C) | 313 |
| +32 (fix migration 0026) | mantidos |
| +103 (Sprint 15F backend) | 491 |
| +38 (P-08 → P-13 + P-15) | 529 |
| +14 (P-16 + P-17) | 543 |
| +15 (Sprint 15D) | 558 |
| +18 (P-23 UI + refino + P-24) | **576** |
| Skipped pré-existentes | 2 |
| Falhas pré-existentes (env vars faltando: field-encryption / rate-limiter / ai-pricing / document-compare / summary-parser / communication-summary-errors) | 4 |

**Testes-chave adicionados:**
- `ai-adapters-classify.test.ts` — matrix HTTP → kind/retryable
- `ai-breakers.test.ts` — isolamento por-tenant / por-provider
- `ai-call-fallback.test.ts` — decision matrix do orquestrador
- `ai-masking-preserved.test.ts` — grep estrutural nos 5 services
- `format-masks.test.ts`, `cep-lookup.test.ts`, `brasil-data.test.ts`, `configurable-lists.test.ts`

Rodar: `npm test`.

---

## 3. Migrations por ordem cronológica

```
0017_ai_ops                       — Sprint 15B
0018_ai_marketplace               — Sprint 15B (seed de 5 features)
0019_tenant_health                — Sprint 15B
0020_trial_pipeline               — Sprint 15B
0021_broadcast                    — Sprint 15B
0022_company_address              — Sprint 15C
0023_configurable_lists           — Sprint 15C
0026_clerk_id_per_scope           — Fix débito Sprint 15A (partial index)
0027_ai_multi_provider            — Sprint 15F
0028_ai_usage_fallback_tracking   — Sprint 15F
0029_inbound_marketing            — Sprint 15D (leads, forms, sources)
0030_rbac_granular                — Sprint 15E (⚡ EM EXECUÇÃO — a paterna vai criar)
```

**Deploy em ordem:** `npx prisma migrate deploy`. Nenhuma migration é destrutiva. `0027` altera enum (`AIProvider`), `0030` altera enum (`UserRole` removendo `GESTOR_INBOUND`) — ambos exigem Postgres 16+ e aplicam pattern migration-pitfalls #1 (cast via text).

**Notas:** 0024 e 0025 ficaram como skips (nomes não usados na numeração).

---

## 4. Pendências operacionais (não bloqueiam merge, mas precisam entrar no plano)

### 4.1. Sprint 15F — UI + rollout
- ✅ **UI dos 4 Cards em `/admin/ai`** — entregue via chip P-23 + refino (Card C ganhou breakdown primary vs fallback, Card D ganhou alertas FALLBACK_FREQUENT e COST_ABOVE_THRESHOLD)
- ✅ **UI `/platform/ai-marketplace`** — form "+ Nova feature" entregue via chip P-24
- ✅ **Migrations 0027 + 0028 aplicadas em Neon dev** (2026-06-30)
- ✅ **`MULTI_AI_ENABLED=true` ativado no `.env.local`** do worktree main pro tenant Fred — path novo em uso desde 2026-06-30
- 🟡 **Rollout produção:** aplicar 0027 + 0028 em Neon prod → deploy código → monitorar `used_fallback` em `ai_usage_logs` 3–5 dias → expandir pra 2–3 early adopters Enterprise → 30d sem regressão → flag global. Registrado como **P-25** no backlog.

### 4.2. Sprint 15C — pontuais
- 🟡 Seed dos valores default das 3 listas novas (`lead_sources`, `industries`, `contact_roles`) em tenants existentes. UI permite criar manualmente; se quiser automatizar, fazer via migration de dados ou `db:seed --listas`.

### 4.3. Sprint 15B — pontuais
- ✅ **Drilldown `/platform/tenants/[id]/ai` e `/ai/features`** — entregue via chip P-06 (2 telas Platform Owner)

### 4.4. Sprint 15D — pontuais
- 🟡 Migration 0029 aplicada em Neon dev; produção pendente
- 🟡 Ativar feature `inbound-lead-parser` nas policies dos planos existentes (via `/platform/ai-marketplace`)
- 🟡 Comunicar tenants sobre `/inbox/prospects` no changelog do produto

### 4.5. Sprint 15E — pontuais (em execução)
- 🟡 **Chip disparado.** Estimativa 10 dias com buffer. Monitorar progresso do chip `task_7965b8c7`.
- 🟡 Após entrega: aplicar migration 0030 em Neon dev + rodar `scripts/rbac-backfill-cache.ts` obrigatoriamente antes de ativar feature flag `RBAC_GRANULAR_ENABLED=true` (ver §5.4 da spec 15E)
- 🟡 Comunicar breaking change no CLAUDE.md: ANALISTA passa a ver **só as próprias oportunidades** por default

### 4.6. Débitos remanescentes ainda abertos
- 🟡 **P-03** Visual baseline capture (bloqueado — depende de seed E2E + app rodando local)
- 🟡 **P-05** Lighthouse CI (bloqueado — depende de `vars.STAGING_URL` no GitHub)

---

## 5. Riscos e pontos de atenção

### 5.1. Circuit breaker in-memory em serverless
[`breakers.ts`](../src/lib/ai/breakers.ts) é `Map` in-memory. Em ambiente Vercel com múltiplos pods, o threshold de "3 falhas" acumula **por pod**, não globalmente. **Trade-off aceitável no MVP** — se serverless multi-pod virar gargalo real, migrar pra Redis (já disponível via BullMQ). Estado resetar no restart é intencional.

### 5.2. NULLS NOT DISTINCT vs partial index
Não repetir o erro: `NULLS NOT DISTINCT` bloqueia deploy em bancos com seed (NULL trata como duplicata). Preferir **partial index** `WHERE campo IS NOT NULL` — permite N registros de fixture sem violar unicidade real.

### 5.3. Prisma `@@unique` composto vs partial
Prisma não tem sintaxe pra partial unique. Quando a constraint real no banco é partial, o `@@unique` no schema é **declarativo** — a migration SQL é a fonte da verdade. O Prisma client gera `findUnique({clerkId_tenantId: ...})` que **não bate com clerkId NULL** (Prisma trata NULL como distinto). Regra prática: quando `clerkId` pode ser conhecido sem tenant, usar `findFirst({where: {clerkId}})`.

### 5.4. DataMaskingService — regra crítica preservada
**Nunca** passar texto raw pra IA. Todos os 5 services chamam `masking.mask` antes do dispatcher, `masking.unmask` no retorno. O teste [`ai-masking-preserved.test.ts`](../tests/unit/ai-masking-preserved.test.ts) faz grep no source (ordem física `masking.mask` → `dispatchChat`) — se alguém refatorar e quebrar essa ordem, o teste falha.

### 5.5. Chaves de IA — segurança
- `resolveAiConfig` decriptografa chave só no objeto retornado (não passa por logger, não vai pra Redis).
- `testKey` retorna `{ok, latencyMs, reason?}` — nunca eco a chave.
- Chaves criptografadas antes de `prisma.update`.
- `updateFeature` audita com `hasOwnKey`/`hasFallbackKey` booleanos, sem o valor.

### 5.6. `MULTI_AI_ENABLED` como kill-switch
Se um adapter novo (Perplexity/Google) dá bug em produção, virar `MULTI_AI_ENABLED=false` **restaura path legado** (Anthropic-only via `getAnthropicForTenant`). Nenhum service escolhe o path — `dispatchChat` faz a decisão.

### 5.7. `RBAC_GRANULAR_ENABLED` como kill-switch (Sprint 15E)
Mesma estratégia. Se após rollout do Sprint 15E aparecer problema com cache/overrides/query performance, virar `RBAC_GRANULAR_ENABLED=false` **restaura path legado** (`withRoles`/`withCapability` sync via `ROLE_PERMISSIONS`). Ver §5.3 rollback plan da spec 15E — enum já migrado (não pode reverter só via flag), mas comportamento run-time volta ao anterior.

### 5.8. GESTOR_INBOUND removido do enum (Sprint 15E)
Após Sprint 15E:
- Todos os users antigos migram pra `role = 'ADMIN'` + 4 overrides `inbound:*` (backfill idempotente)
- Enum `UserRole` fica sem `GESTOR_INBOUND`
- **Não desmontar** referências em código antes da migration rodar — script de rollback precisa das defaults do role antigo
- `approval_rules.approver_roles` sanitizado (remove `GESTOR_INBOUND` antes de castar)

### 5.9. Breaking change de comportamento — `opportunity:read_others` (Sprint 15E §6.4)
Após Sprint 15E, ANALISTA passa a ver **só as próprias oportunidades** por default. Antes, todo usuário do tenant via tudo (só PARCEIRO tinha filtro).

- Executor deve documentar EXPLICITAMENTE no CLAUDE.md changelog
- Admin pode reverter caso a caso concedendo `opportunity:read_others` via override — sem mudar role
- `opportunities.list`, `.count`, `.byId` (404 pra evitar enumeration), `.kanban`, `reports.performance`, `activities.list`, `tasks.list`, `documents.listByOpportunity` — todos passam a filtrar por `ownerId` condicional
- Comunicar tenants antes do deploy (release note)

### 5.10. Escalada de privilégio em `permissions.grant` (Sprint 15E §6.5)
Guard obrigatório em `grant`/`revoke`/`restore`: **você só delega o que você tem**. Sem esse guard, um user com `user:grant_permissions` (mesmo temporário) poderia conceder `audit:read` ou `ai:manage_breaker` a si mesmo. Platform Owner isento (bypass legítimo pra debug cross-tenant).

---

## 6. Arquivos-chave por área

**IA (Sprint 15F):**
- Adapters: [`src/lib/ai/adapters/`](../src/lib/ai/adapters)
- Orquestração: [`src/lib/ai/{breakers,resolve,call,dispatch}.ts`](../src/lib/ai)
- Router: [`src/server/trpc/routers/ai-config.ts`](../src/server/trpc/routers/ai-config.ts)

**Endereço BR (Sprint 15C):**
- [`src/lib/cep/lookup.ts`](../src/lib/cep/lookup.ts), [`src/lib/data/brasil.ts`](../src/lib/data/brasil.ts), [`src/lib/utils/format.ts`](../src/lib/utils/format.ts)
- [`src/components/companies/CompanyForm.tsx`](../src/components/companies/CompanyForm.tsx)

**Listas configuráveis (Sprint 15C):**
- Routers: [`src/server/trpc/routers/catalog.ts`](../src/server/trpc/routers/catalog.ts)
- UI: [`src/app/admin/listas/page.tsx`](../src/app/admin/listas/page.tsx)

**QuickCreate (Sprint 15C):**
- [`src/components/ui/quick-create-trigger.tsx`](../src/components/ui/quick-create-trigger.tsx)

**Platform Console (Sprint 15B):**
- Routers: [`src/server/trpc/routers/platform*.ts`](../src/server/trpc/routers)
- Telas: [`src/app/platform/`](../src/app/platform)
- BroadcastBanners: [`src/components/layout/BroadcastBanners.tsx`](../src/components/layout/BroadcastBanners.tsx)

**Auth dual identity (fix 0026):**
- [`src/server/services/{clerk-sync,access-log,onboarding}.service.ts`](../src/server/services)

**Inbound Marketing (Sprint 15D):**
- Parser: [`src/server/services/inbound-parser.service.ts`](../src/server/services/inbound-parser.service.ts)
- Analytics: [`src/server/services/inbound-analytics.service.ts`](../src/server/services/inbound-analytics.service.ts)
- Router: [`src/server/trpc/routers/inbound.ts`](../src/server/trpc/routers/inbound.ts)
- Worker: [`src/jobs/inbound-lead-create.worker.ts`](../src/jobs/inbound-lead-create.worker.ts)
- Endpoint público: [`src/app/api/v1/inbound/lead/route.ts`](../src/app/api/v1/inbound/lead/route.ts)
- Telas: [`src/app/inbox/prospects/page.tsx`](../src/app/inbox/prospects/page.tsx), [`src/app/reports/inbound-vs-outbound/page.tsx`](../src/app/reports/inbound-vs-outbound/page.tsx)

**RBAC Granular (Sprint 15E — em execução, serão criados pelo chip):**
- Catálogo: `src/lib/auth/permissions-catalog.ts` (novo)
- Refactor: `src/lib/auth/rbac.ts` + `src/server/trpc/middlewares.ts`
- Router: `src/server/trpc/routers/permissions.ts` (novo)
- UI: `src/app/admin/users/[id]/permissions/page.tsx` (novo)
- Migration + backfill script: `prisma/migrations/0030_rbac_granular/` + `scripts/rbac-backfill-cache.ts`

**Débitos fechados P-XX — arquivos:**
- Interceptor 401 (P-13): [`src/lib/trpc/session-guard.ts`](../src/lib/trpc/session-guard.ts)
- Zod amigável (P-21): [`src/lib/trpc/error-format.ts`](../src/lib/trpc/error-format.ts)
- FileDropzone (P-19): [`src/components/ui/file-dropzone.tsx`](../src/components/ui/file-dropzone.tsx)
- TasksSection (P-20): [`src/components/pipeline/TasksSection.tsx`](../src/components/pipeline/TasksSection.tsx)
- Command Palette (P-16): [`src/components/search/CommandPalette.tsx`](../src/components/search/CommandPalette.tsx)
- Sort tabelas (P-17): [`src/lib/hooks/useTableSort.ts`](../src/lib/hooks/useTableSort.ts)
- AI admin alerts (P-23 refino): [`src/lib/ai/admin-alerts.ts`](../src/lib/ai/admin-alerts.ts)
- Tenants current (P-22): [`src/server/trpc/routers/tenants.ts`](../src/server/trpc/routers/tenants.ts)

---

## 7. Comandos úteis

```bash
# Deploy migrations no ambiente
npx prisma migrate deploy

# Regen client (após schema edit)
npx prisma generate

# Suite
npm test           # 491 passing
npm run lint       # zero
npm run type-check # zero

# Ativar 15F pro tenant Fred (em staging)
# .env.local:
MULTI_AI_ENABLED=true

# Reverter Sprint 15F em runtime (kill-switch)
MULTI_AI_ENABLED=false   # services voltam pro path legado sem redeploy de código
```

---

## 8. Definição de pronto — Sprint 15F

- [x] Backend das 4 fases mergeado
- [x] `npm test` verde
- [x] `npm run type-check` verde
- [x] `npm run lint` verde
- [x] Migrations 0027 + 0028 aplicadas em Neon dev
- [ ] Migrations 0027 + 0028 aplicadas em Neon **prod**
- [x] `MULTI_AI_ENABLED=true` no `.env.local` do worktree main
- [ ] `MULTI_AI_ENABLED=true` no Vercel prod (rollout gradual)
- [x] DataMaskingService chamado em todos os 5 services (validado por teste estrutural)
- [ ] Fred configura OpenAI em `semantic-search` → chamada real usa OpenAI (**smoke test manual**)
- [ ] Fred configura fallback Anthropic→OpenAI em `communication-summary`, força primary a falhar → fallback ativa em `ai_usage_logs` (**smoke test manual**)
- [ ] `testKey` testado em ambiente com Axiom: chave **não aparece** nos logs
- [x] UI dos 4 Cards em `/admin/ai` — P-23 + refino
- [x] UI `/platform/ai-marketplace` com "+ Nova feature" — P-24
- [x] `getAnthropic()` marcado `@deprecated` com nota de remoção
- [x] CLAUDE.md atualizado

## 9. Definição de pronto — Sprint 15E (em execução)

- [ ] Chip `task_7965b8c7` conclui as 4 fases
- [ ] Migration 0030 aplicada em Neon dev
- [ ] `scripts/rbac-backfill-cache.ts` executado com sucesso (obrigatório antes de ativar flag)
- [ ] `RBAC_GRANULAR_ENABLED=true` em worktree main sem regressão em nenhuma das 47 procedures migradas
- [ ] UI `/admin/users/[id]/permissions` funcional com 3 estados
- [ ] Guard anti-escalada validado por teste
- [ ] Breaking change (`opportunity:read_others`) comunicado no CLAUDE.md
- [ ] ANALISTA continua vendo suas opps; ADMIN concede override → ANALISTA passa a ver tudo
- [ ] `permissions.whoHas('inbound:assign_prospects')` retorna users corretos após backfill
- [ ] Memory `rbac-granular-pattern.md` criada
- [ ] Testes: baseline 576 + ≥25 novos
- [ ] Rollout produção: aplicar 0030 → rodar backfill script → deploy código → ativar flag → monitorar 24h
