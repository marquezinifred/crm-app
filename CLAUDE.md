# CRM Comercial — Instruções para Claude Code

## Sobre este projeto
Estou construindo um CRM B2B multi-tenant completo. A especificação funcional e o plano de implementação estão em `docs/CRM_Especificacao_e_Implementacao.docx`.

Leia esse documento antes de qualquer tarefa. Ele tem duas partes:
- **PARTE I** — O que construir (módulos, campos, regras de negócio, 19 seções)
- **PARTE II** — Como construir (arquitetura, sprints, testes, segurança, infraestrutura)

---

## Sprint atual

> **Sprint 15E — RBAC Granular (Permissões Configuráveis):
> ✅ CONCLUÍDO em 2026-07-01**
>
> Spec: `docs/Sprint_15E_RBAC_Granular.md` v3 + `docs/permission-matrix.md`
> (validada célula a célula). Refactor estrutural — roles como perfis
> padrão + overrides individuais de permission por user. Resolve a
> proliferação de roles (Sprint 15D `GESTOR_INBOUND` virou permission
> override neste sprint).
>
> **Entregue em 4 fases (commits `c91ff3e` → Fase 4):**
>
> **Fase 1 — Fundação** (commit `c91ff3e`):
>  - `src/lib/auth/permissions-catalog.ts` — **61 permissions** distintas
>    em 17 categorias (spec header mencionou "65"; contagem real é 61 e
>    per-role counts batem célula a célula na matrix).
>  - `src/lib/auth/rbac.ts` com dupla API:
>    * Nova: `ROLE_DEFAULT_PERMISSIONS`, `hasPermissionByRole` (sync UI),
>      `computeEffectivePermissions` (puro).
>    * Legada: `ACTIONS`, `ROLE_CAPABILITIES`, `hasCapability`,
>      `requireCapability` (compat pra `withCapability` seguir funcionando).
>    Contagens: ADMIN=60, DIRETOR_C=39, DIRETOR_O=25, DIRETOR_F=18,
>    GESTOR=31, ANALISTA=23, PARCEIRO=5.
>  - `src/server/services/permissions.service.ts` com `hasPermission`
>    async (cache-aware, Platform Owner bypass),
>    `computeAndCacheUserPermissions`, `invalidateUserPermissionsCache`.
>  - `withPermission(permission)` middleware tRPC.
>  - Migration 0030 (pattern migration-pitfalls #1 cast enum via text
>    intermediário + #3 sanitizar approver_roles + CHECK XOR):
>    `user_permission_overrides` tabela + colunas `cached_permissions`
>    (default `{}`) + `cached_permissions_at` (nullable — a distinção
>    NULL vs `[]` evita loop de recompute pra PARCEIRO com todas revogadas).
>    Backfill `GESTOR_INBOUND` → `ADMIN` + 4 overrides inbound
>    (ON CONFLICT DO NOTHING). Enum `UserRole` sem `GESTOR_INBOUND`.
>  - `env.ts` ganha `RBAC_GRANULAR_ENABLED=false` default.
>  - Referências residuais de `GESTOR_INBOUND` limpas em 8 arquivos.
>    Worker de notificação inbound migrou de `role: 'GESTOR_INBOUND'`
>    pra filtro por `cachedPermissions: { has: 'inbound:view_queue' }`
>    com fallback ADMIN/DIRETOR_COMERCIAL enquanto cache não populado.
>
> **Fase 2 — Refactor 34 procedures** (commit `8ca438b`):
>  - Todas as 34 declarações `withCapability(resource, action)` +
>    `withRoles(...)` em 13 router files migradas pra
>    `withPermission('resource:action')`. Baseline "47" mencionado na
>    spec era grep bruto (13 imports + 34 usos).
>  - 13 rename mecânico puro (companies/contacts/contracts/proposals
>    core, opps core, inbox, partners.registerTcAcceptance, partner-engagements.request,
>    inbound.getConfig+queueList).
>  - 7 semantic splits — permissions mais estreitas:
>    * `tasks.create/update/delete`: `task:*` (antes proxy via
>      `opportunity:update`). Matrix concede a DIRETOR_OPERACOES tasks
>      mas não `opportunity:update` — padrão "handoff/pós-venda gerencia
>      tarefas mas não edita pipeline".
>    * `documents`: `document:read/upload` (antes `opportunity:read/update`).
>    * `imports`: `import:run` (antes proxy via `company:create`).
>    * `reports`: `reports:read` (antes `opportunity:read`).
>    * `inbound.assignInbound`: `inbound:assign_prospects` (antes
>      `opportunity:set_inbound_owner`).
>    * `partner-engagements.decide`: `partner:approve_engagement`
>      (antes `withRoles`).
>  - 2 procedures com enforcement adicional via `hasPermission` async:
>    * `opportunities.list/kanban/byId` — `visibilityWhere()` virou async
>      e chama `hasPermission(userId, 'opportunity:read_others')` pra
>      decidir se retorna `{}` ou `OR: [ownerId, team.some]`. PARCEIRO
>      segue com row-level filter.
>    * `reports.*` — mesma lógica em `visibility()` dentro de `loadOpps`
>      + `loadInboundOpps`. ANALISTA vê só própria linha em
>      `performanceByOwner` (Sprint 5 preservado).
>  - 🔴 **Breaking change consciente**:
>    - ANALISTA perde `opportunity:read_others` — passa a ver **só as
>      próprias opps**. Admin pode conceder override individual sem
>      mudar role.
>    - GESTOR perde `partner:approve_engagement` — antes `withRoles`
>      incluía ele, matrix agora só ADMIN/DIRETOR_C/DIRETOR_O. Override
>      também disponível caso a caso.
>    - DIRETOR_OPERACOES ganha `task:*` explícito (antes precisava de
>      `opportunity:update` que ele não tem).
>  - Compat preservado: `adminOnlyProcedure` (74 usos) segue com
>    `withRoles('ADMIN')`. ADMIN tem todas permissions do catálogo por
>    default (exceto `audit:read_platform` Platform Owner only). Débito
>    Sprint 15G.
>  - Mapping doc `docs/rbac-migration-map.md` novo — tabela old→new
>    por router destacando os 7 semantic splits.
>
> **Fase 3 — Permissions router + UI** (commit `174bc5d`):
>  - `src/server/trpc/routers/permissions.ts` com 5 procedures:
>    * `listCatalog` (protected) — 61 permissions + labels PT-BR + ordem
>      de categoria.
>    * `forUser` (user:read) — defaults do role + overrides individuais
>      (com quem/quando/por quê) + array efetivo final + counts.
>    * `grant`/`revoke`/`restore` (user:grant_permissions) — mutations
>      com **guard anti-escalada §6.5**: caller (não-Platform Owner)
>      só delega o que ele próprio tem, senão 403. Aplica em grant,
>      revoke E restore. Platform Owner é exceção legítima. Audit em
>      cada mudança com `tenantIdOverride`.
>    * `whoHas` (user:read) — lista users do tenant com permission no
>      cache. ⚠️ Depende de cache populado — se cache NULL, retorna [].
>  - `_app.ts` registra `permissions: permissionsRouter`.
>  - `src/app/admin/users/[id]/permissions/page.tsx` — UI conforme §7:
>    * PageHeader (nome/role/email do target)
>    * Card com contagem transparente (efetivo = defaults + granted −
>      revoked)
>    * Campo texto pra motivo opcional aplicado à próxima ação
>    * Permissions agrupadas por categoria em `<details>` colapsáveis
>      (todas abertas por default)
>    * Cada linha: emoji (✅/❌/☐) + badge (Padrão/Concedida/Revogada)
>      + histórico inline "concedida em DD/MM por Fulano — motivo"
>    * 3 botões contextuais (Conceder/Revogar/Restaurar padrão). Revogar
>      dispara `AlertDialog` do design system (P-12 pattern, não
>      `confirm()` nativo).
>  - `/admin/users` — link "Permissões" em cada linha da tabela.
>  - Sidebar (§9.2 spec): items ganham campo `permission?` opcional.
>    3 items gated: `/inbox/prospects` (inbound:view_queue),
>    `/admin/email-inbound` (inbound:configure), `/imports` (import:run).
>    `useMemo` + `trpc.users.me` + `hasPermissionByRole` filtram
>    SECTIONS. Hooks colocados ANTES do early return (`HIDDEN_ON`) pra
>    respeitar rules-of-hooks.
>
> **Fase 4 — Compat + rollout + validation**:
>  - `approval-engine.service.ts` refatorado: dual approver spec.
>    `RuleMatch` agora tem `approverRoles: UserRole[]` OU
>    `approverPermission: string | null` (CHECK XOR em SQL).
>    `createApprovalsForProposalVersion` consulta `cachedPermissions:
>    { has: rule.approverPermission }` quando permission-based; fallback
>    pra pattern antigo com `approverRoles` mantido. Rules existentes
>    seguem funcionando (backward compat).
>  - `scripts/rbac-backfill-cache.ts` novo + `npm run rbac:backfill-cache`
>    no `package.json`. Idempotente, ~30s pra 1000 users. Roda
>    `computeAndCacheUserPermissions` pra todos users ativos.
>    ⚠️ **OBRIGATÓRIO no rollout** — sem isso `whoHas` retorna [].
>  - Memory `rbac-granular-pattern.md` salva no MEMORY index —
>    regras "permission nova > role nova", pattern `X:read_others`,
>    guard anti-escalada, cache 2 colunas, backfill obrigatório.
>
> **Rollout ordenado em produção (spec §5.4):**
>  1. Deploy código com `RBAC_GRANULAR_ENABLED=false`
>  2. `npx prisma migrate deploy` (0030)
>  3. `npm run rbac:backfill-cache` (**obrigatório**)
>  4. Ativar `RBAC_GRANULAR_ENABLED=true`
>  5. Monitorar `audit_logs` 24h
>
> **Rollback rápido:** setar `RBAC_GRANULAR_ENABLED=false` volta pro
> path legado. Tabela `user_permission_overrides` fica no banco.
>
> **Testes:** 27 novos (permissions-catalog +7, role-default-permissions
> +21, permissions-router +11, approval-rules-by-permission +4,
> tasks-router mock ajustado). Total 615/621 passing (baseline
> preservado — 4 falhas + 6 file-import env-vars pré-existentes + 2
> skipped). Type-check zero. Lint zero.
>
> **Segurança validada:**
>  - Guard anti-escalada em grant/revoke/restore — testes cobrindo
>    ADMIN sem `audit:read` NÃO consegue conceder `audit:read` a outro
>    user (retorna 403).
>  - Platform Owner bypass total mesmo sem permission — testes cobrindo.
>  - Audit log preservado com `tenantIdOverride` em toda mutation.
>  - Same-tenant guard em `forUser`/`grant`/`revoke`/`restore` (404 em
>    cross-tenant, não 403 — evita enumeration).
>
> 🎉 Sprint 15E fechado — RBAC granular com breaking changes documentadas.
> Próximo: Sprint 15G (hardening + audit UI + custom roles + delegação
> temporária + row-level permissions), ou hardening produção (Sentry+Axiom).
>
> **Sprint 15D — Inbound Marketing Pipeline:
> ✅ CONCLUÍDO em 2026-07-01**
>
> Spec: `docs/Sprint_15D_Inbound_Marketing.md`. Captura automática de
> leads inbound via formulário público e webhook custom + qualificação
> assistida por IA. Cada lead vira Opportunity `is_inbound=true` em
> `PROSPECT` sem owner; Gestor de Inbound aloca em `/inbox/prospects`.
>
> **Entregue em 6 fases (commits `87f5a1b` → `1747f30`):**
>
> **Fase 1 — Schema + migration 0029** (commit `87f5a1b`):
>  - `UserRole` enum ganha `GESTOR_INBOUND` (role temporária — Sprint
>    15E migra pra permission granular). Recria enum pelo pattern
>    RENAME_old + cast todas colunas escalares e array de UserRole.
>  - `opportunities` ganha 7 campos novos: `is_inbound`, `inbound_source`,
>    `inbound_form_id`, `inbound_payload jsonb`, `inbound_received_at`,
>    `inbound_parsed_by`, `inbound_confidence numeric(3,2)`.
>  - `opportunities.owner_id` vira nullable — leads inbound aguardam
>    alocação. Manuais continuam com owner obrigatório (enforce em
>    código). Índice parcial pra fila (WHERE is_inbound AND
>    owner_id IS NULL AND stage='PROSPECT' AND deleted_at IS NULL).
>  - Nova tabela `inbound_capture_config` (1:1 com tenant): webhook_secret
>    com partial UNIQUE index, notify_user_ids, blacklist_domains,
>    auto_assign_by_territory. RLS padrão.
>  - Nova tabela `inbound_leads_rejected` (confidence < 0.4 / blacklisted
>    / rate_limited vão pra revisão manual). RLS padrão.
>  - Feature `inbound-lead-parser` seedada em `ai_features` (Haiku 4.5,
>    ADDON R$ 49/mês STARTER, INCLUDED TRIAL/PRO/ENTERPRISE).
>  - RBAC: novas actions `opportunity:assign`, `opportunity:set_inbound_owner`,
>    `inbound:view_queue`, `inbound:configure`. GESTOR_INBOUND lê +
>    aloca inbound. ADMIN e DIRETOR_COMERCIAL veem a fila.
>
> **Fase 2 — Parser híbrido** (commit `968f1ca`):
>  - `src/server/services/inbound-parser.service.ts` com 5 matchers
>    regex por ordem de especificidade:
>    1. `webhook-custom-json` (JSON estruturado, confidence 0.99)
>    2. `typeform-v1` (detecta "typeform", confidence 0.95)
>    3. `rd-station-v1` (detecta "RD Station" / "resultados digitais", 0.9)
>    4. `html-table-form` (Contact Form 7 / Cal.com <tr><td>, 0.9)
>    5. `plain-key-value` (genérico "Campo: Valor", 0.85)
>  - Fallback IA via `dispatchChat('inbound-lead-parser', tenantId,
>    ...)` quando nenhum regex bate ≥ 0.85. Confidence 0.65 no fallback.
>  - **DataMaskingService preservado** — regra crítica: `masking.mask()`
>    ANTES de dispatchChat + `masking.unmask()` DEPOIS. Provider nunca
>    vê PII em texto claro (tokens `[EMAIL_1]` / `[CNPJ_1]` etc).
>  - `logAiUsage` grava consumo com feature=`inbound_lead_parse`,
>    `used_fallback` e `configured_provider` (Sprint 15F).
>  - Utilities exportados: `extractKeyValuePairs`, `buildFromKeyValueDict`
>    (com KEY_ALIASES mapeando "nome"/"empresa"/"telefone"/etc),
>    `parseCurrencyBrl` (heurística "R$ 12.000" thousands vs "12.50"
>    decimal), `normalizeCnpj`, `parseIsoDate`.
>  - 14 testes puros: cada matcher com contract shape + PII masking
>    verificado (email real não aparece no payload que chega ao provider).
>
> **Fase 3 — Worker + endpoint público + router tRPC** (commit `a7e0803`):
>  - `src/server/services/inbound-lead-creator.service.ts`:
>    - `createInboundLead` orquestra parser → dedup company/contact →
>      criar opp OR rejected. Sempre em `runAsSystem` (worker não tem
>      userId autenticado).
>    - `findOrCreateCompany` dedup por CNPJ senão razaoSocial/nomeFantasia
>      case-insensitive; cria como CLIENT type.
>    - `findOrCreateContact` dedup por email dentro da company; vincula
>      contato órfão se existente; placeholder email em caso raro sem email.
>    - `isBlacklisted` suporta 3 formatos: domínio exato ("spam.com"),
>      sufixo @ ("@evil.com"), endereço completo ("abuse@x.com").
>    - `deriveOpportunityTitle` usa mensagem truncada 60 chars OU
>      contact.name OU placeholder "Empresa (inbound)".
>    - **Audit com tenantIdOverride obrigatório** — worker fora do tRPC
>      não tem AsyncLocalStorage do tRPC context (bug audit-trpc-context-loss).
>  - `src/jobs/inbound-lead-create.worker.ts` + queue
>    `QUEUE_NAMES.inboundLeadCreate` + payload
>    `InboundLeadCreateJobData`. Registrado no `jobs/index.ts` com
>    listener .on('failed', ...) e close no shutdown gracioso.
>    `notifyInboundManagers` best-effort — push falha não falha o job.
>  - Endpoint POST `/api/v1/inbound/lead?secret=<x>` (ou header
>    X-Webhook-Secret). Rate limit por IP via `PUBLIC_FORM_LIMIT`
>    (Sprint 11 — 10 req/min). Lookup config pelo webhook_secret
>    (partial UNIQUE index). 401 se inválido, 403 se webhookEnabled=false.
>    Retorna 202 { status: 'queued' }.
>  - Router `inbound.ts`:
>    - `getConfig` — lazy defaults se ainda não persistido.
>    - `updateConfig` (canConfigure) — upsert com whitelist Zod, redact
>      `webhook_secret` no audit log.
>    - `regenerateWebhookSecret` — `randomBytes(32).toString('hex')` com
>      prefixo 'whs_'. NUNCA loga secret real no audit — só "rotatedAt".
>    - `queueList` / `queueCount` — feed de `/inbox/prospects` com
>      filtros opcionais (source, minConfidence).
>    - `sellersWithLoad` — ADMIN/DIRETOR_COMERCIAL/GESTOR/ANALISTA
>      ordenados por opps ativas asc. `groupBy` em batch pra evitar N+1.
>    - `assignInbound` (canAssignInbound) — mutation dedicada, valida
>      opp isInbound=true + ownerId=null antes de alocar.
>    - `historyList`, `rejectedList`, `rejectedDiscard` pra tab histórico.
>  - Testes puros: `isBlacklisted` (6 casos), `deriveOpportunityTitle`
>    (4 casos), MIN_CONFIDENCE = 0.4.
>
> **Fase 4 — UI `/inbox/prospects`** (commit `0e04b67`):
>  - PageHeader dinâmico "Prospects inbound (N)". Filtros: source
>    dropdown dinâmico + confiança (alta ≥ 0.8 / média 0.4-0.79).
>  - Cards por lead: razão social + contato + tempo relativo (`há
>    12min`), badge IA (primary) ou regex (success) + confidence %,
>    valor estimado em gold/tabular-nums com tooltip completo, data
>    prev., email clicável, source pill.
>  - Botão "Alocar" abre Popover Radix com vendedores ordenados por
>    carga asc. Cada linha mostra role + count de opps ativas.
>  - `?highlight={id}` na URL destaca o card (push notification landing).
>  - Toasts Venzo em success/error usando `useToast` (kind: success/error).
>  - Empty state Venzo: "Sem leads aguardando alocação. Bom trabalho,
>    fila zerada."
>  - Sidebar ganha item "Fila inbound" na seção Operação (IconInbox).
>  - Testes shape do router (3 casos).
>
> **Fase 5 — Tabs em `/admin/email-inbound`** (commit `a7f3ef1`):
>  - Refactor com Tabs Radix — 3 tabs:
>    - "E-mail inbound" (Sprint 6 preservado + AlertDialog do design
>      system substituindo `confirm()` nativo).
>    - "Forms de captura" (Sprint 15D novo) — 3 cards: Webhook (URL
>      completa + Copiar + AlertDialog danger pra Regenerar secret),
>      Notificação (toggle + UserPicker multi-select — sem seleção
>      default GESTOR_INBOUND), Blacklist (textarea 1 domínio por linha
>      com formatos documentados em `<code>`).
>    - "Histórico" — lista unificada de leads created + rejected com
>      Badge success/danger e confidence %.
>  - Componente auxiliar `UserPicker` estilo checklist.
>
> **Fase 6 — Relatório inbound × outbound + testes** (commit `1747f30`):
>  - `src/server/services/inbound-analytics.service.ts` puro:
>    - `computeInboundFunnel` — funil comparativo por estágio (só
>      ACTIVE).
>    - `compareConversionRates` — winRate = won / (won + lost) por
>      origem; 0 se nada decidido.
>    - `averageTicketByOrigin` — média de closedValue OR estimatedValue
>      só das ganhas (WON).
>    - `averageCycleTime` — dias entre createdAt e actualCloseDate;
>      retorna null quando sem opps fechadas (evita "0 dias" enganoso).
>  - `reports.inboundVsOutbound` no router com `loadInboundOpps`
>    dedicado (só campos do `InboundOpSnap`).
>  - UI `/reports/inbound-vs-outbound`:
>    - PageHeader + filtros de período.
>    - 3 KPI cards comparativos side-by-side (conversion, ticket,
>      cycle time). Inbound em brand-primary, outbound em text-1.
>    - Funis lado a lado (2 colunas). Barras proporcionais ao maior
>      count. Valor em BRL compacto com tooltip.
>    - Alternativa textual em `<dl class="sr-only">` pra a11y.
>  - Link "Inbound × Outbound →" adicionado em `/reports` topo.
>  - 10 testes puros pro analytics service.
>
> **Testes:** 619/627 passing (baseline 581 + 38 novos do Sprint 15D).
> 6 falhas pré-existentes em communication-summary-errors por env
> vars — não regridem. Type-check zero. Lint zero.
>
> **Segurança validada:**
>  - Endpoint público rate-limitado por IP (`PUBLIC_FORM_LIMIT` — Sprint 11)
>  - Secret rotacionável via UI; audit log grava apenas "rotatedAt",
>    nunca o valor
>  - `updateConfig` audit redacta `webhookSecret` como 'REDACTED'
>  - Blacklist domain bloqueia lead antes de criar opp
>  - Confidence < 0.4 vai pra `inbound_leads_rejected` (não vira opp)
>
> **Pendências residuais (P-27 a P-31 no backlog):**
>  - P-27: `/api/v1/inbound/email` estender pra criar Lead novo (Sprint 6
>    preservado — Sprint 15D só cobre webhook explícito)
>  - P-28: Integrações OAuth nativas (RD Station / HubSpot / Typeform /
>    LinkedIn / Pipedrive / Mautic) — só quando cliente pedir
>  - P-29: Rate limit por sender (não só por IP)
>  - P-30: UI dedicada de revisão de rejected (tab histórico já mostra)
>  - P-31: Push nativo pro vendedor quando alocado (best-effort worker
>    notifica gestores; vendedor alocado precisa de push extra)
>
> 🎉 Sprint 15D fechado — inbound marketing pipeline funcional.
> Próximo: Sprint 15E (RBAC granular — migra GESTOR_INBOUND pra
> permission `inbound.assign_prospects`).

> **Sprint 15F — IA Multi-Provider por Feature + Fallback:
> ✅ BACKEND CONCLUÍDO em 2026-06-30**
>
> Spec: `docs/Sprint_15F_IA_Multi_Provider.md`. Feature flag
> `MULTI_AI_ENABLED` (default `false`) — path legado permanece ativo;
> ativar por-tenant em staging antes de flag global.
>
> **Entregue (Fases 1–4 backend):**
>  - ✅ Migration `0027_ai_multi_provider` — `defaultProvider` de TEXT
>    → `AIProvider` enum + colunas em `tenant_ai_features`
>    (providerOverride/modelOverride/apiKeyEncrypted, fallbackProvider/
>    fallbackModel/fallbackApiKeyEncrypted, costAlertBrlMonthly,
>    updatedAt) + index parcial de resolução
>  - ✅ Migration `0028_ai_usage_fallback_tracking` —
>    `ai_usage_logs.used_fallback` + `configured_provider` pra medir
>    fallback rate por feature
>  - ✅ `src/lib/ai/adapters/` — `LlmClient` + `AiProviderError` +
>    `classifyStatus` (mapping padronizado HTTP → kind/retryable).
>    4 adapters: `AnthropicAdapter` (chat), `OpenAIAdapter`
>    (chat + embed), `PerplexityAdapter` (extends OpenAI, baseURL
>    perplexity.ai), `GoogleAdapter` (Gemini via REST direto — sem
>    dep nova). `registry.ts` com `createClient` +
>    `providerSupportsEmbedding`
>  - ✅ `src/lib/ai/breakers.ts` — Map por-`(provider, tenant)` com
>    TTL 1h + cleanup + `clearBreakers` + `snapshotBreakers`.
>    In-memory (aceitável no MVP; migrar pra Redis se serverless
>    multi-pod virar gargalo)
>  - ✅ `src/lib/ai/resolve.ts` — `resolveAiConfig` cascata
>    (override → default → global). Curto-circuito same-key.
>    Validação `supportsEmbedding` pra features SEARCH.
>    Chave sai como plaintext SÓ no objeto retornado
>  - ✅ `src/lib/ai/call.ts` — `callAiWithFallback`:
>    (1) circuit aberto pula pro próximo attempt;
>    (2) `retryable=false` NÃO registra no breaker mas fallback é
>    tentado (chave diferente pode funcionar);
>    (3) `MODEL_NOT_FOUND` e `CONTEXT_LENGTH` abortam sem fallback
>  - ✅ `src/lib/ai/dispatch.ts` — `dispatchChat`/`dispatchEmbed`
>    roteiam pelo `MULTI_AI_ENABLED`: false → legado
>    (`callAiFeature` + `getAnthropicForTenant`); true →
>    `callAiWithFallback`. Interface uniforme retorna
>    `{text, tokens, usedProvider, configuredProvider, usedFallback}`
>  - ✅ **5 services refatorados preservando DataMaskingService**:
>    `communication-summary`, `conversion-rate-suggestion`,
>    `email-link`, `document-compare`, `semantic-search`. Teste
>    estrutural `ai-masking-preserved.test.ts` faz grep no source
>    (ordem `masking.mask` → `dispatchChat`) pra pegar regressão
>  - ✅ `getAnthropic()` re-deprecated com nota de remoção Sprint 15G
>  - ✅ Router tRPC `aiConfig` estendido: `listFeatures`,
>    `updateFeature` (fallback trinca), `testKey` (retorna
>    `{ok, latencyMs, reason?}` — nunca eco a chave),
>    `breakerStatus`, `clearCircuitBreaker`. Audit em todas as
>    mutations (`tenant.ai.updateGlobal/updateFeature/clearCircuitBreaker`)
>  - ✅ Router `platform.aiMarketplace.setFeature` estendido pra
>    editar `defaultProvider`/`defaultModel` (Platform Owner only)
>  - ✅ Env: `MULTI_AI_ENABLED` (default `false`)
>  - ✅ Testes: 103 novos. Total **491/493** (2 skipped
>    pré-existentes). Type-check zero. Lint zero
>
> **Pendências operacionais (UI polish + rollout):**
>  - 🟡 UI dos 4 Cards em `/admin/ai` (spec §3.3) — backend expõe
>    tudo; UI atual pré-15F ainda funciona mas não mostra overrides
>    por feature nem fallback. Trabalho mecânico ~2 dias
>  - 🟡 UI `/platform/ai-marketplace` — form Adicionar Feature nova
>    e edit inline de `defaultProvider`/`defaultModel`.
>    Router pronto, UI atual pré-15F só lê
>  - 🟡 Rollout: aplicar migrations 0027 + 0028 no Neon dev; ativar
>    `MULTI_AI_ENABLED=true` só pro tenant Fred; monitorar 3–5 dias;
>    depois early adopters; depois flag global
>
> **Segurança validada:**
>  - ✅ `resolveAiConfig` decriptografa chave só no objeto retornado
>    (não passa por logger, não vai pra Redis)
>  - ✅ `testKey` retorna `{ok, latencyMs, reason?}` — nunca eco a chave
>  - ✅ Chaves são criptografadas antes de `prisma.update`
>  - ✅ `updateFeature` audita com `hasOwnKey`/`hasFallbackKey`
>    booleanos, sem o valor
>
> **Compat com legado:**
>  - Flag `false` mantém 100% comportamento pré-15F
>    (services chamam `dispatchChat` que delega pro
>    `callAiFeature`+`getAnthropicForTenant`)
>
> 🎉 Backend completo. Falta UI polish + rollout gradual.

> **Fix corretivo — IA per-tenant + erros estruturados (P-14/P-15):
> ✅ CONCLUÍDO em 2026-06-30**
>
> Dois fixes na camada de consumo de IA descobertos em teste real
> com a conta Anthropic sem créditos.
>
> Entregue:
>  - ✅ **P-14 — `src/lib/ai/claude.ts`**: novo
>    `getAnthropicForTenant(tenantId)` decripta `aiApiKeyEncrypted`
>    e retorna client dedicado. Cache Map com TTL 10min +
>    invalidação automática quando `ai-config.updateConfig` troca a
>    key. Fallback pra `env.ANTHROPIC_API_KEY` com warn; throw
>    apontando `/admin/ai` quando ambos ausentes. Consumidores
>    migrados (5): communication-summary, document-compare,
>    conversion-rate-suggestion, semantic-search, email-link.
>    `getAnthropic()` legacy mantido como `@deprecated`. Commit
>    `a80564f`
>  - ✅ **P-15 — `src/lib/ai/anthropic-errors.ts` novo**: helper
>    `mapAnthropicError(err)` traduz `Anthropic.APIError` em
>    `TRPCError` acionável — 400 credit balance vira
>    PRECONDITION_FAILED com link do billing; 401/403 vira
>    UNAUTHORIZED apontando /admin/ai; 429 vira TOO_MANY_REQUESTS
>    honrando `retry-after`; 5xx retorna null → caller mantém
>    fallback silencioso com circuit breaker. Aplicado nos 3
>    serviços user-facing (communication-summary, document-compare,
>    conversion-rate-suggestion). email-link/semantic-search seguem
>    silenciosos (background/degrade). Commit `be5f244`
>  - ✅ Testes: `tests/unit/claude-per-tenant.test.ts` novo com 6
>    casos (per-tenant, cache, fallback+warn, throw, invalidate);
>    +5 casos em `communication-summary-errors.test.ts` (400 credit,
>    401, 429 sem/com retry-after, 5xx silencioso). Total
>    **392/398** passing (4 pré-existentes field-encryption + 2
>    skipped). Type-check zero. Lint zero
>
> 🎉 Débitos P-14 e P-15 do `Backlog_Pos_MVP.md` fechados.

> **Fix corretivo — Modal rouba foco (P-12):
> ✅ CONCLUÍDO em 2026-06-30**
>
> Bug bash em sessão real revelou que TODOS os 12 modais do app
> (`/platform/tenants` "+ Novo tenant", `/companies` "+ Nova
> empresa", `/admin/users` "+ Convidar", etc.) tinham o cursor
> pulando pro primeiro input a cada keystroke. Forms intestáveis.
>
> Entregue:
>  - ✅ **`src/components/ui/modal.tsx`**: `onClose` capturado em
>    `onCloseRef` e removido das deps do `useEffect` de focus
>    inicial / listener de ESC + Tab trap. Effect roda 1× ao
>    montar (`open` true) e cleanup 1× ao desmontar. Callers
>    passam `onClose={() => setOpen(false)}` inline — cada render
>    do parent (disparado por `setForm` a cada keystroke) criava
>    nova closure, mudando a identidade de `onClose`, disparando
>    o cleanup+setup por completo, com `focusables[0].focus()`
>    roubando o foco pro primeiro input do modal
>  - ✅ **Escopo cirúrgico**: só o Modal muda. Nenhum dos 12
>    callers (`/platform/tenants` +2, `/platform/broadcasts`,
>    `/platform/trials` +2, `/platform/tenants/[id]`,
>    `/admin/users` +N, `/companies`, `/contacts`, etc.) foi
>    tocado — o fix propaga por serem consumidores da mesma
>    função `<Modal>`
>  - ✅ **ESC + Tab trap preservados**: ESC continua fechando
>    via `onCloseRef.current()`; Tab cicla dentro do modal
>    (Shift+Tab no primeiro → último; Tab no último → primeiro)
>  - ✅ `eslint-disable-next-line react-hooks/exhaustive-deps`
>    com comentário justificando o `onClose` intencional via ref
>  - ✅ Testes: `tests/unit/modal.test.tsx` novo com 3 casos
>    (re-render não rouba foco / ESC fecha / Tab cicla). Baseline
>    378 → 381 passing (4 falhas pré-existentes por env vars
>    ausentes em field-encryption/rate-limiter/ai-pricing/
>    document-compare/summary-parser + 2 skipped seguem iguais).
>    Verificação cruzada: reverter só o modal.tsx faz o teste (1)
>    falhar, confirmando que ele captura o bug real
>  - ✅ Type-check zero. Lint zero
>
> 🎉 Débito P-12 do `Backlog_Pos_MVP.md` fechado.

> **Fix corretivo — 3 UX gaps de uso manual (P-08/P-09/P-10):
> ✅ CONCLUÍDO em 2026-06-30**
>
> Bug bash em sessão real revelou 3 atritos que dão impressão de bug
> em vez de feature em andamento. Todos atacados num único chip pra
> evitar context-switch.
>
> Entregue:
>  - ✅ **P-08 — Logout no AppShell**
>    (`src/components/layout/Topbar.tsx`):
>    `<UserButton afterSignOutUrl="/sign-in" />` do Clerk inserido
>    no canto superior direito da topbar (ao lado do ThemeToggle).
>    Avatar 28×28 via `appearance.elements.avatarBox` pra casar com
>    o size do toggle. Disponível em todas as rotas autenticadas;
>    rotas `HIDDEN_ON` (sign-in/onboarding/políticas) continuam sem
>    topbar como antes
>  - ✅ **P-09 — Mensagem de erro IA realista**
>    (`src/server/services/communication-summary.service.ts` +
>    `src/server/trpc/routers/activities.ts` +
>    `src/components/pipeline/CommunicationIntake.tsx`):
>    - Backend: `summarizeCommunication` distingue
>      `FeatureNotAvailableError`/`AiLimitExceededError` (re-throw)
>      de falhas reais de provider (mantém o caminho
>      `aiGenerated: false` pra Claude 5xx/timeout). Procedure
>      `activities.summarize` carrega a oportunidade primeiro e
>      lança `NOT_FOUND` ou `PRECONDITION_FAILED` quando status
>      não é ACTIVE; traduz erros de feature gate pra
>      `PRECONDITION_FAILED` (mensagem clara em vez de "IA
>      indisponível") e limite para `TOO_MANY_REQUESTS`
>    - Frontend: `CommunicationIntake` aceita prop
>      `stageHasDirtyChanges`; quando true, botão fica desabilitado
>      com `title` + alerta inline "Salve a reunião antes de
>      resumir com IA." (intercepta antes de chamar tRPC).
>      `/pipeline/[id]` passa
>      `Object.keys(editStageFields).length > 0` como prop
>  - ✅ **P-10 — Rótulos semânticos de estágio**
>    (`src/lib/constants/pipeline-stages.ts` novo +
>    `src/app/pipeline/[id]/page.tsx`):
>    Mapa `STAGE_INTENT_LABEL` para os 7 valores reais do enum
>    `OpportunityStage` (Captação de origem / Agendamento de
>    reunião / Briefing e qualificação / Apresentação da proposta
>    / Negociação final / Aceite do cliente / Contrato ativo).
>    Título do card mudou de "CAMPOS DO ESTÁGIO ATUAL (LEAD)"
>    pra "Agendamento de reunião" com sub-rótulo discreto
>    "Estágio: Lead". `STAGE_LABELS` antigo continua sendo a fonte
>    da verdade para chips, breadcrumbs e headers de coluna do
>    kanban — os dois mapas são intencionalmente separados
>  - ✅ Testes: 6 novos (communication-summary-errors +3,
>    pipeline-stage-intent +3). Total **394/396** (2 skipped
>    pré-existentes). Type-check zero. Lint zero
>
> 🎉 Débitos P-08/P-09/P-10 do `Backlog_Pos_MVP.md` fechados.

> **Fix corretivo — Migration 0026 `clerk_id_per_scope`:
> ✅ CONCLUÍDO em 2026-06-30**
>
> Fecha débito da Sprint 15A: `UNIQUE(clerk_id)` global em `users`
> impedia a MESMA pessoa real (mesmo Clerk ID) ter as duas identidades
> em paralelo — Admin de tenant **e** Platform Owner. O CHECK XOR
> de 0016 já separava corretamente os papéis dentro de uma row; só
> faltava destravar 2 rows com mesmo `clerk_id`.
>
> Sintoma original: `npx tsx prisma/seed-platform.ts` com
> `PLATFORM_OWNER_CLERK_ID` igual ao de um admin existente falhava
> com `Unique constraint failed on the fields: ('clerk_id')`.
>
> Iteração: a primeira versão da migration usava `NULLS NOT DISTINCT`
> (Postgres 15+). Deploy falhou em banco com seed:
> `Key (clerk_id, tenant_id)=(null, ...) is duplicated` porque seeds
> têm ~30 users com `clerk_id NULL` (10 × 3 tenants) e
> `NULLS NOT DISTINCT` os trata como duplicatas entre si. Substituído
> por **partial unique index** `WHERE clerk_id IS NOT NULL`.
>
> Entregue:
>  - ✅ Migration `0026_clerk_id_per_scope` — `DROP INDEX
>    users_clerk_id_key` + `CREATE UNIQUE INDEX users_clerk_id_tenant_id_key
>    ON users (clerk_id, tenant_id) WHERE clerk_id IS NOT NULL`.
>    COMMENT ON INDEX documenta a regra. Seeds sem `clerk_id`
>    preservados; unicidade só vale pra logins Clerk reais (Admin
>    de tenant + Platform Owner)
>  - ✅ `schema.prisma`: trocado `@unique` simples do `clerkId` por
>    `@@unique([clerkId, tenantId], name: "clerk_id_per_scope",
>    map: "users_clerk_id_tenant_id_key")` com comentário explicando
>    que constraint real é PARTIAL (Prisma não tem sintaxe para
>    partial unique — migration SQL é a fonte da verdade). Prisma
>    `validate` + `generate` passam limpos
>  - ✅ 5 call sites ajustados (`findUnique` → `findFirst`/`updateMany`):
>    - `clerk-sync.service.ts` — webhook user.updated propaga
>      email/fullName a TODAS as facetas (`updateMany`); criação só
>      ocorre se nenhuma row pré-existe
>    - `clerk-sync.service.ts` deactivate — desativa TODAS as facetas
>      via `updateMany`
>    - `access-log.service.ts` — busca faceta tenant (filtro
>      `tenantId: { not: null }`) porque UserAccessLog é por-tenant
>    - `onboarding.service.ts findLocalUserByClerkId` —
>      `findFirst` com `orderBy tenantId asc nulls last` (prioriza
>      faceta tenant)
>    - `/api/v1/reports/export` e `/api/v1/imports/upload` —
>      `findFirst` filtra `(clerkId, tenantId)` do contexto atual
>  - ✅ Verificação no DB (esperado pós-aplicação):
>    - SELECT count(*) ... WHERE clerk_id IS NULL GROUP BY tenant_id
>      → seeds preservados (count > 1 ok)
>    - INSERT duplicado `(clerkId, tenantId)` mesmo tenant → ERROR
>    - INSERT Platform Owner com mesmo clerkId → sucesso
>    - INSERT 2º Platform Owner mesmo clerkId → ERROR
>      (partial cobre pois clerk_id IS NOT NULL nos 2)
>  - ✅ Testes: 388/390 mantidos (2 skipped pré-existentes). Lint
>    zero. Type-check zero. `grep "findUnique.*clerkId" src/` zero
>
> Compatibilidade:
>  - Routers `/platform/*`: comportamento idêntico
>  - Middleware `/platform/*`: continua decidindo contexto pelo
>    `public.platformRole` do JWT — não precisou mudar
>  - CHECK XOR da migration 0016 preservada
>
> 🎉 Débitos Sprint 15A zerados.

> **Sprint 15C — Usabilidade: Forms, Listas Configuráveis e
> QuickCreate: ✅ CONCLUÍDO em 2026-06-30**
>
> Spec: `docs/Sprint_15C_Usabilidade_Forms.md`. Auditoria do Passo 0
> salva em `docs/auditoria_forms_15C.md` (scroll quebrado deu zero —
> Modal Sprint 14.5 já trata; voz Venzo deu zero — Sprint 14.5 limpou
> tudo; CNPJ auto-fill já entregue no fix /companies).
>
> Entregue:
>  - ✅ Migration `0022_company_address` — campos endereço completo:
>    cep, logradouro, numero, complemento, bairro + index
>    `(tenant_id, cep) WHERE cep IS NOT NULL`
>  - ✅ Migration `0023_configurable_lists` — 3 tabelas novas
>    (`lead_sources`, `industries`, `contact_roles`) com position
>    + isActive + soft delete + RLS + UNIQUE (tenant, name) WHERE
>    deleted_at IS NULL. FKs opcionais em opportunities.lead_source_id,
>    companies.industry_id, contacts.contact_role_id. Mantém o enum
>    `OpportunitySource` e o campo `position` em Contact como fallback
>  - ✅ `src/lib/cep/lookup.ts` — BrasilAPI v2 com mesmo padrão do
>    CNPJ (5 estados: ok/not-found/rate-limited/error + AbortController)
>  - ✅ `src/lib/utils/format.ts` ganhou `formatCNPJ`/`unformatCNPJ`/
>    `formatCEP`/`unformatCEP` — máscaras progressivas que mantêm
>    estado canônico em dígitos
>  - ✅ `src/lib/data/brasil.ts` — `ESTADOS_BR` (27 UFs) + `PAISES`
>    (25 países) + `useCidadesByUF` (IBGE Localidades, cache
>    perpétuo via TanStack v4 `staleTime: Infinity` + `cacheTime: Infinity`)
>  - ✅ `catalog.ts` estendido com `leadSourcesRouter` +
>    `industriesRouter` + `contactRolesRouter`. Cada um expõe
>    list (com filtro `includeInactive`)/create/update/remove (soft +
>    bloqueia se em uso com mensagem que sugere desativar)/reorder
>    (transação que escreve position por índice). Registrados em
>    `_app.ts` como `leadSources`, `industries`, `contactRoles`
>  - ✅ `quick-create-trigger.tsx` — componente reutilizável com 3
>    dialogs (company/contact/product). Cada dialog usa as APIs de
>    criação existentes e dispara toast Venzo. Contato suporta
>    QuickCreate recursivo de empresa (1 nível, com breadcrumb
>    "Novo contato › Nova empresa")
>  - ✅ `CompanyForm.tsx` refatorado: máscara visual CNPJ + CEP +
>    auto-fill BrasilAPI por CEP (não sobrescreve campos preenchidos),
>    País como Select (default BR), UF como Select estático dos 27,
>    Cidade como Input + datalist IBGE, campos novos
>    (cep/logradouro/numero/complemento/bairro) + Setor (industries) +
>    toast de sucesso + footer sticky bottom-0
>  - ✅ `/admin/listas` — página unificada com 5 tabs (Territórios,
>    Segmentos, Origens, Setores, Cargos). Reorder via
>    `@dnd-kit/sortable` com handle visível, toggle Switch ativo/
>    inativo, edição inline do nome via clique, exclusão com
>    `AlertDialog`. Adicionado no Sidebar admin
>  - ✅ `src/components/ui/alert-dialog.tsx` — wrapper sobre `Modal`
>    com tom danger/primary. Substitui `confirm()` nativo
>  - ✅ `src/lib/hooks/use-dirty-confirm.ts` + `use-auto-focus.ts` —
>    helpers prontos para forms com unsaved-changes
>  - ✅ `Modal` ganhou `max-h-[90vh] overflow-y-auto` por padrão
>    (consertando proativamente formulários altos)
>  - ✅ Aplicado cross-form: `/pipeline/new` (toast + QuickCreate
>    Empresa + select Origem detalhada se há lead_sources),
>    `/contacts` (toast em create/update/remove + QuickCreate Empresa
>    inline), `/admin/products` (toast). `platform/*` mantido sem
>    alterações (escopo Sprint 15A separado)
>  - ✅ Testes: 32 novos. format-masks +9, cep-lookup +6,
>    brasil-data +5, dirty-confirm +4, quick-create-shape +2,
>    configurable-lists +8 (soft delete em uso + reorder). Total
>    **388/390** (2 skipped pré-existentes). Type-check zero. Lint zero
>
> Pendências operacionais (sem bloqueio):
>  - Seed dos valores default das 3 listas novas em tenants existentes:
>    fazer via migration de dados ou script `db:seed --listas`
>    (não obrigatório — UI permite criar à vontade)
>  - Drilldown `/platform/tenants/[id]/ai` (Sprint 15B) ainda pendente
>    (~2h de tela mecânica)
>
> 🎉 18 sprints (0–15C) sem débitos abertos.

> **Sprint 15B — AI Operations + Plataforma Estratégica:
> ✅ CONCLUÍDO em 2026-06-30**
>
> 5 áreas entregues: AI Ops Center, AI Marketplace, Tenant Health Score,
> Trial Pipeline e Broadcast genérico. Spec:
> `docs/Sprint_15B_AI_Ops_Platform.md`.
>
> Entregue:
>  - ✅ 5 migrations (0017 AI ops, 0018 marketplace + seed de 5 features,
>    0019 health snapshots, 0020 trial pipeline, 0021 broadcasts)
>  - ✅ 9 modelos novos no schema + 5 enums novos
>    (AiAnomalyType, AiFeatureCategory, AiFeatureStatus,
>    BroadcastVariant, BroadcastTarget)
>  - ✅ Tenant ganhou colunas trial (trialSource, trialExtendedCount,
>    trialConversionAt, trialCancellationAt, trialCancellationReason)
>  - ✅ `src/lib/ai/pricing.ts` — PRICE_TABLE por (provider, model),
>    `costUsd`, `priceBrl`, `usdToBrlWithMargin` aplica
>    USD_BRL_RATE × (1 + AI_PLATFORM_MARGIN)
>  - ✅ `src/lib/ai/usage.ts` — `getCurrentMonthUsage` +
>    `getTodayRequests` consultando `ai_usage_daily`
>  - ✅ `src/lib/ai/feature-gate.ts` — `callAiFeature<T>()` resolve
>    acesso (DISABLED → FeatureNotAvailableError), checa limites
>    (AiLimitExceededError com kind MONTHLY_TOKENS/MONTHLY_COST/
>    DAILY_REQUESTS), respeita pinned model. 5 services
>    refatorados (communication-summary, document-compare,
>    email-link, semantic-search, conversion-rate-suggestion)
>  - ✅ `health-score.service.ts` — 8 funções de scoring puras
>    (logins/opps/features/nps/tickets/trial/evaluations/resources),
>    `WEIGHTS_BY_PLAN`, `bucketFor` (GREEN ≥70, YELLOW 40-69, RED <40),
>    `computeHealthScore` async
>  - ✅ `broadcast.service.ts` — `matchesTargeting` puro
>    (ALL/BY_PLAN/MANUAL_LIST), `isWithinWindow`,
>    `activeForUser` filtra dismissals
>  - ✅ Workers BullMQ novos: `ai-usage-rollup` (00:30 BRT, agrega
>    `ai_usage_logs` em `ai_usage_daily`, detecta anomalia vs 7d avg
>    via `anomalyThresholdMultiplier`), `health-score-rollup`
>    (02:00 BRT, snapshot por tenant em `tenant_health_snapshots`)
>  - ✅ `platformRouter` estendido com 5 sub-routers: `aiOps`
>    (summary/byTenant/setLimits/acknowledgeAlert), `aiMarketplace`
>    (list/setFeature/tenantAccessList/tenantAccessSet),
>    `health` (today/byTenant), `trials` (list/extend/convertManual),
>    `broadcasts` (list/create/delete/targetingPreview)
>  - ✅ `broadcastsRouter` público (não-platform) com
>    `activeForCurrentUser` + `dismiss` consumido pelo AppShell
>  - ✅ 5 telas: `/platform/ai-ops` (cards por provider + anomalias
>    + top 10 tenants), `/platform/ai-marketplace` (catálogo com
>    contagem de tenants ativos), `/platform/health` (3 buckets
>    RED/YELLOW/GREEN), `/platform/trials` (lista com botões
>    Estender/Converter manual), `/platform/broadcasts` (criar +
>    listar + desligar). `PlatformShell` ganhou 5 itens no nav
>  - ✅ `BroadcastBanners` no `AppShell` (substitui `MaintenanceBanner`
>    quando há broadcasts ativos via `useHasActiveBroadcasts`)
>  - ✅ env: `USD_BRL_RATE` (5.1 default), `AI_PLATFORM_MARGIN` (0.20)
>  - ✅ Testes: 19 novos (ai-pricing +5, health-score-math +13,
>    broadcast-targeting +7, feature-gate +4). Total **356/358**
>    (2 skipped pré-existentes). Type-check zero. Lint zero
>
> Pendências operacionais (sem bloqueio):
>  - Drilldown `/platform/tenants/[id]/ai` e `/ai/features` —
>    routers `byTenant` + `tenantAccessSet` já prontos, falta a
>    casca de tela (mecânico ~2h)
>  - Linkar Sentry/Axiom nos workers (Sprint 16 hardening)
>
> 🎉 17 sprints (0–15B) sem débitos abertos.

> **Sprint 15A — Platform Console: ✅ CONCLUÍDO em 2026-06-29**
>
> Backend de plataforma + 7 telas em `/platform/*` + seed script.
> `SUPER_ADMIN` saiu do enum tenant-side e virou `PLATFORM_OWNER`
> em enum separado (`PlatformRole`), coluna `users.platform_role`,
> com CHECK constraint garantindo XOR `tenantId / platformRole`.
> Adicionado `DIRETOR_OPERACOES` (3 diretores agora: Comercial /
> Operações / Financeiro), com permissões focadas em pós-venda
> (cria/edita contratos mas não aprova propostas).
>
> Entregue:
>  - ✅ Migration `0016_platform_owner` — enum `PlatformRole`,
>    `users.tenant_id` nullable, `users.platform_role`, CHECK XOR,
>    índice parcial, `audit_logs.tenant_id` nullable + coluna
>    `metadata JSONB`, índice por `impersonated_by`
>  - ✅ Enum `UserRole` enxuto (sem SUPER_ADMIN, com DIRETOR_OPERACOES)
>  - ✅ `runAsPlatform(userId, fn)` + `PLATFORM_TENANT_SENTINEL` +
>    `isPrivilegedContext` em `tenant-context.ts`. Prisma extension
>    reconhece os dois sentinels e bypassa injeção de tenant
>  - ✅ Middleware Next.js: `/platform/*` exige
>    `public.platformRole === 'PLATFORM_OWNER'`. Platform Owner
>    tentando navegar fora cai em `/platform/dashboard` automaticamente
>  - ✅ tRPC context resolve `platformUser` (tenantId NULL +
>    platformRole obrigatório); novo `platformProcedure` enforça via
>    middleware dedicado
>  - ✅ `platformAudit` service grava `metadata.platform_user_id` e,
>    em impersonação, `metadata.impersonated_by` +
>    `impersonation_session_id`
>  - ✅ `platformRouter` com 12 procedures: `me`, `dashboard`,
>    `tenantsList`, `tenantById`, `tenantCreate` (com invite Clerk
>    do primeiro admin), `tenantSuspend`, `tenantUnsuspend`,
>    `impersonateStart`, `impersonateEnd`, `auditList`, `privacyList`,
>    `featureFlagsList`
>  - ✅ 7 telas: `/platform/dashboard` (5 KPI cards + sugestões),
>    `/platform/tenants` (lista + modal criar), `/platform/tenants/[id]`
>    (4 tabs: Overview / Members / Billing / Config), `/platform/impersonate`
>    (fluxo Tenant → User), `/platform/audit` (lista + filtros), `/platform/privacy`
>    (fila LGPD cross-tenant), `/platform/feature-flags`
>  - ✅ `PlatformShell` com banner vermelho persistente "Console da
>    Plataforma" + sidebar dedicada de 6 itens
>  - ✅ `prisma/seed-platform.ts` idempotente — env
>    `PLATFORM_OWNER_EMAIL` + opcionais `PLATFORM_OWNER_FULL_NAME` +
>    `PLATFORM_OWNER_CLERK_ID`
>  - ✅ rbac.ts: `DIRETOR_OPERACOES` adicionado (gerencia contratos,
>    aprova engajamento de parceiros, sem aprovar proposta);
>    `hasPermission()` sem mais bypass por SUPER_ADMIN
>  - ✅ Testes: 38 novos esperados — entregamos 38+ (platform-rbac +4,
>    run-as-platform +5, impersonation-audit +3, rbac atualizado +9,
>    users-role-guard reescrito +4, etc). Total **300/300** passando
>  - ✅ Lint zero, type-check zero
>
> Notas operacionais:
>  - Geração real de cookie Clerk para impersonação fica para sub-sprint
>    de staging quando o setup Clerk estiver pronto. O endpoint já
>    grava audit corretamente; o front recebe `sessionId` para vincular
>  - Para promover `PLATFORM_SUPPORT` no futuro (lista no enum mas
>    `enforcePlatform` bloqueia): ajustar policy no middleware tRPC
>
> 🎉 16 sprints (0–15A) sem débitos abertos.

> **Fix corretivo — /companies + /contacts ghost routes:
> ✅ CONCLUÍDO em 2026-06-29**
>
> Fecha 404 em `/companies/new` (botão "+ Nova empresa") e
> `/companies/[id]` (clique numa linha). Aplica os 2 padrões já
> estabelecidos: Modal inline (Sprint 13) para criar/editar e
> DetailSheet via intercepting routes (Sprint 14) para detalhe.
> Mesmo padrão replicado em `/contacts`.
>
> Entregue:
>  - ✅ `CompanyForm` (`src/components/companies/CompanyForm.tsx`)
>    com Field/Input/Select do design system, carrega via
>    `companies.byId` se editingId, usa `companies.create/update`
>    existentes
>  - ✅ `/companies/page.tsx` — botão Nova empresa abre `Modal`;
>    linha da tabela é `role="button"` que navega para
>    `/companies/[id]`
>  - ✅ `/companies/layout.tsx` com slot `{modal}`
>  - ✅ `/companies/@modal/default.tsx` retorna null
>  - ✅ `/companies/@modal/(.)[id]/page.tsx` renderiza `Sheet` com
>    `CompanyDetailContent`
>  - ✅ `/companies/[id]/page.tsx` full-page fallback (deep link, F5)
>  - ✅ `CompanyDetailContent` reusado pelos dois — 3 tabs
>    (Visão geral / Contatos / Histórico), botão Editar abre Modal,
>    Desativar abre confirm Modal (soft delete via `companies.remove`)
>  - ✅ `/contacts` — mesmas peças: `ContactDetailContent`,
>    `/contacts/layout.tsx`, `/contacts/@modal/default.tsx`,
>    `/contacts/@modal/(.)[id]/page.tsx`, `/contacts/[id]/page.tsx`.
>    Form inline pré-existente (Sprint 13) mantido; linha da tabela
>    agora vira `role="button"` → DetailSheet
>  - ✅ Testes: 26 novos (company-form Zod +9, contact-form Zod +5,
>    intercepting-routes existência +12). Total 288/288
>  - ✅ Type-check zero. Lint zero
>
> 🎉 **MVP completo.** Fix corretivo aplicado sobre Sprint 14.5.

> **Sprint 14.5 — Polish Pass: ✅ CONCLUÍDO em 2026-06-29**
>
> 9 itens da spec entregues na ordem obrigatória (radius bump → itens
> visuais → polish → baseline pendente operacional).
>
> Critérios de aceite atingidos:
>  - ✅ Border-radius bump primeiro (sm 6 / DEFAULT 8 / md 12 / lg 16
>    + xl 20 novo)
>  - ✅ Pipeline Kanban: colunas ≥ 280px com scroll-snap, valores em
>    gold/tabular-nums abaixo do nome (line-clamp-2), formatBRLCompact
>    + tooltip com valor completo
>  - ✅ FunnelChart refeito: grid interno 110/1fr/90, largura por
>    contagem, sinal correto (+X% verde / X% neutro), gradient brand
>    e final em success, a11y `<dl class="sr-only">`
>  - ✅ Popover via Radix (`@radix-ui/react-popover`)
>  - ✅ DetailSheet com 4 tabs (Visão geral / Atividades / Documentos
>    / Histórico) via Sheet (Radix Dialog) + Tabs (Radix); variant
>    right desktop / bottom mobile; sem swipe (decisão da spec)
>  - ✅ 3 banners contextuais (PastDue / Offline / Maintenance) +
>    ContextBanners agregador no AppShell;
>    `NEXT_PUBLIC_MAINTENANCE_MESSAGE` no env
>  - ✅ PageHeader component novo + aplicado em 8 rotas (companies,
>    search, approvals, contracts, admin/users, admin/products,
>    admin/privacy, dashboard-style já no Sprint 14)
>  - ✅ Lighthouse script + workflow (standby até staging)
>  - ✅ 27 testes novos: format (12), funnel-math (5), banners (7),
>    + ajustes de tipo. Total 262/262
>
> Critérios em continuação operacional (requerem staging):
>  - 🟡 PageHeader nas 13 rotas internas restantes (item 4 spec) —
>    tokens estão corretos do refactor Sprint 14, falta padronizar
>    o header. Trabalho mecânico ~3h
>  - 🟡 Visual baseline capturado — script pronto, README em
>    `tests/visual/README.md`; depende de app rodando local com seed
>  - 🟡 Lighthouse ≥90 — workflow pronto, depende de
>    `vars.STAGING_URL` no GitHub
>
> 🎉 **MVP completo.** 15 sprints (0–14.5) executados sem débitos
> abertos.
>
> Próximos sprints planejados:
>
> 1. **Sprint 15A — Platform Console (Super Admin Operacional)** —
>    5–7 dias. Spec: `docs/Sprint_15A_Platform_Console.md`. Reno­
>    meação `SUPER_ADMIN` → `PLATFORM_OWNER` em enum separado
>    `PlatformRole`, `users.tenantId` nullable, runAsPlatform()
>    estendido, `/platform/*` shell + 7 telas (dashboard, tenants
>    CRUD, impersonação com audit trail, audit cross-tenant, privacy
>    cross-tenant, feature-flags). Pré-requisito de operação.
>
> 2. **Sprint 15B — AI Operations + Plataforma Estratégica** —
>    4–5 dias. Spec: `docs/Sprint_15B_AI_Ops_Platform.md`. AI Ops
>    Center (limits por tenant, anomaly detection, model pinning,
>    custo R$), AI Marketplace (catálogo `ai_features` +
>    `tenant_ai_features` 3 estados, callAiFeature gate), Tenant
>    Health Score (worker diário, 8 sinais, buckets RED/YELLOW/GREEN,
>    régua de incentivo), Trial Pipeline (`/platform/trials` com
>    extensão manual + source attribution), Broadcast genérico
>    (substitui MaintenanceBanner com targeting ALL/BY_PLAN/MANUAL).
>    Pré-requisito de escala. Depende de 15A.
>
> 3. **Sprint 15C — Usabilidade: Forms, Listas Configuráveis e
>    QuickCreate** — ✅ CONCLUÍDO 2026-06-30. Migrations 0022 + 0023.
>    QuickCreate Pattern + Empresa form + CNPJ/CEP máscaras + 3
>    tabelas configuráveis + UX hardening cross-forms.
>
> 4. **Sprint 15D — Inbound Marketing Pipeline** — ~6 dias. Spec:
>    `docs/Sprint_15D_Inbound_Marketing.md`. Entrada automática de
>    prospects via email dedicado + webhook custom genérico; parser
>    híbrido (regex prioritário com matchers Typeform/RD/key-value/
>    HTML + IA Haiku fallback via callAiFeature); worker cria
>    Opportunity em estágio PROSPECT sem owner, com is_inbound=true
>    e lead_source_id=INBOUND; nova role temporária GESTOR_INBOUND
>    (será migrada como permission no 15E); fila /inbox/prospects
>    onde Gestor de Inbound aloca vendedor; tela /reports/inbound-
>    vs-outbound com funil comparativo + conversion rate + cycle
>    time. Migration 0024. Depende de 15C (lead_sources table)
>    entregue.
>
> 5. **Sprint 15E — RBAC Granular (Permissões Configuráveis)** —
>    ~7 dias. Spec: `docs/Sprint_15E_RBAC_Granular.md`. Refactor
>    estrutural — roles continuam como perfis padrão mas admin pode
>    conceder/revogar permissions individuais por user. Catálogo
>    `permissions-catalog.ts` (~50 permissions categorizadas).
>    Backfill automático do GESTOR_INBOUND (Sprint 15D) → ADMIN +
>    3 permissions. Cache em users.cached_permissions com
>    invalidation nas mutations. UI /admin/users/[id]/permissions
>    com 3 estados visuais. ~30 procedures migradas de `withRoles`
>    pra `withPermission`. approval_rules aceita approver_roles OU
>    approver_permission. Migration 0025. Depende de 15D entregue
>    como caso de uso âncora.
>
> Outros: hardening produção (Sentry+Axiom wiring, k6 load test) —
> spec'd como Sprint 16 no backlog.
>
> **Backlog consolidado:** `docs/Backlog_Pos_MVP.md` — 5 pendências
> de curto prazo (P-01 a P-05, ~2 dias), Sprints 15A/15B/15C/16/17+,
> roadmap longo prazo, 6 decisões de arquitetura pendentes (framer-motion,
> Storybook, i18n, mobile native, hospedagem, pricing), 7 débitos
> técnicos identificados (audit silencioso em outros routers, PWA
> em dev, MAINTENANCE_WINDOW deprecar pós-15B, Sentry/Axiom stubs,
> seed scripts produção, RBAC test gap, backup externo Neon).

> **Sprint 14 — Venzo Design System: ✅ CONCLUÍDO em 2026-06-29**
>
> Foundation arquitetural (P1–P5) + AppShell + componentes base +
> componentes CRM + feedback + refactor mecânico das 25+ telas +
> polish individual das críticas + voice & tone + a11y.
>
> Critérios de aceite atingidos:
>  - ✅ Dark default sem FOUC (next-themes + suppressHydrationWarning)
>  - ✅ bg-brand-primary/50 funciona (canais HSL separados)
>  - ✅ 3 zonas de viewport implementadas (Sidebar variant overlay/fixed)
>  - ✅ Deep link /pipeline/{id} mantido; clique no kanban abre sheet
>    via intercepting route com URL preservada
>  - ✅ 1 Primary por tela respeitado nos componentes refeitos
>  - ✅ Zero "Nenhum encontrado" no grep (substituído por voz Venzo)
>  - ✅ Plus Jakarta Sans configurada via font-sans Tailwind
>  - ✅ axe-core smoke spec configurado em CI (5 rotas públicas + 4
>    rotas autenticadas)
>  - ✅ 25+ telas refatoradas para tokens do design system
>    (bg-card/bg-page/text-text-{1,2,3}/border-border/semânticos)
>  - ✅ Telas públicas (sign-in, sign-up, /privacy, /terms,
>    /privacy-request, /p/[slug]/contact, /, /onboarding,
>    /onboarding/setup) com layout Venzo dedicado
>
> Critérios em continuação operacional (requerem staging):
>  - 🟡 Lighthouse audit ≥ 90 em /dashboard, /pipeline, /contacts,
>    /admin/billing — script pronto, depende de staging operacional
>  - 🟡 Visual regression baseline capturado — script pronto, depende
>    de app rodando com seed E2E
>
> 🎉 **MVP completo.** 14 sprints (0–14) executados sem débitos abertos.
>
> Próximo: **Sprint 14.5 — Polish Pass** — 9 ajustes de design polish
> identificados em uso após Sprint 14: PipelineBoard com overflow de
> valor + colunas estreitas, border-radius mais generoso, FunnelChart
> em `/reports` com layout e matemática quebrados, polish individual
> de 9 telas internas críticas (refactor mecânico foi feito mas falta
> hierarquia tipográfica e empty states ricos), Popover (não entregue
> no 14), DetailSheet com tabs e bottom sheet mobile, banners
> contextuais completos (past due / offline / maintenance), captura
> do visual baseline (🟡 do 14). Esforço: ~3–4 dias.
>
> Spec completa: `docs/Sprint_14_5_Polish.md`.
>
> Specs:
> - `docs/venzo_ux_spec.docx` (10 capítulos: princípios, tokens,
>   shell/navegação, componentes base, dados, CRM-específicos,
>   feedback, acessibilidade WCAG 2.1 AA, responsividade,
>   checklist)
> - `docs/venzo_ui_preview.html` (protótipo HTML executável com
>   dark/light toggle, 631 linhas — referência visual concreta)
> - `docs/venzo_brand_guide.docx` (paleta, tipografia, voz —
>   continua sendo fonte da verdade)
> - `docs/Sprint_14_UX_Application.md` (plano de execução,
>   refactor map, voice & tone com exemplos antes/depois)
>
> Depois: hardening de produção (Sentry+Axiom wiring real,
> Lighthouse audit, smoke test contra ambiente staging, load test
> com k6). Roadmap futuro: módulo de comissões automáticas,
> integração nativa WhatsApp Business, marketplace de templates
> de proposta, agente autônomo de prospecção.
>
> Histórico Sprint 11: migration `0013_lgpd_security`
> (`data_subject_requests` com SLA 15d ANPD + `policy_acceptances`
> imutável + `connection_logs` WORM Marco Civil), middleware aplica
> security headers globais (HSTS, CSP, X-Frame-Options DENY,
> Permissions-Policy), rate limiter Redis sliding window (5
> login/15min/IP, 10 form público/min, 1000 req/min/tenant),
> cookie banner granular 4 categorias com ConsentLog integration,
> workflows LGPD `collectPersonalData` (export JSON) +
> `anonymizeSubject` (preserva FKs, scrubba activities), endpoint
> público `POST /api/v1/privacy-request` + router tRPC `privacy`,
> UI `/privacy-request` + `/admin/privacy`, Política Privacidade
> + Termos versionados com `PolicyAcceptGate` que força aceite,
> Dependabot 3 ecossistemas (npm/actions/docker) + GH Actions
> security workflow (npm audit, Semgrep p/owasp-top-ten, ZAP
> baseline semanal).

> **Débitos zerados na Sprint 11:**
>  - Sprint 1: middleware grava x-real-ip a partir de
>    x-forwarded-for em paralelo ao webhook Clerk ✅
>  - Sprint 2: E2E `pipeline-7-stages.spec.ts` agora roda via
>    fixture (E2E_TEST_TENANT_ID + E2E_RESET_URL + bypass
>    `/api/e2e/login` ativo só em NODE_ENV=test) ✅
>
> Histórico Sprint 10.5: (tabela `tenant_settings.theme_config` JSONB,
> CSS custom props `--brand-*` injetadas no RootLayout, cache Redis
> TTL 1h com invalidação imediata, UI self-service de paleta + fontes
> Google + logo, validação WCAG AA (contraste ≥ 4.5:1) com sugestão
> automática se reprovar, badge "Powered by Venzo" three-state
> (`visible` Starter / `subtle` Growth / `hidden` Enterprise) com
> enforcement server-side, matriz de permissões por plano, feature
> flag Unleash `tenant_theming_enabled`, audit log com before/after).
>
> Specs:
> - `docs/Arquitetura_e_Plano_Implantacao_CRM.docx` (Sprint 10.5)
> - `docs/CRM_Especificacao_e_Implementacao.docx` (Sprint 10.5)
> - `docs/venzo_brand_guide.docx` (paleta, tipografia Plus Jakarta
>   Sans, componentes, voz/tom — fonte da verdade do design system)
> - `docs/Sprint_10_5_WCAG_Refinements.md` (5 refinamentos da
>   validação WCAG: combinatorial, sugestão dupla, regra texto
>   grande, relatório pós-publicação, override Enterprise com
>   aceite formal — sobrescreve a validação simples descrita nos
>   .docx; +3 dias de esforço)
>
> Depois: **Sprint 11 — Segurança, LGPD e Conformidade** (Cloudflare
> WAF, rate limiting, security headers, cookie banner LGPD, workflows
> de exportação/anonimização, logs imutáveis, OWASP ZAP).

---

## Baseline de testes atual (2026-07-04)

Medido pelo QA automation report após ciclo P-32 → P-36:

- `npm test` com env dummy consistente: **715 passing / 0 failing / 168 skipped**
  (883 tests total)
- **Nota sobre variância:** com env vars parcialmente preenchidas (setup
  real de dev com Neon/Clerk mas sem chaves IA reais), ~709 é esperado —
  6 tests em `tests/unit/communication-summary-errors.test.ts` dependem
  de `ANTHROPIC_API_KEY` real. 715/0/168 é o piso 100% env dummy
  consistente (todo `xxx-dummy` no `.env.example`). Não é regressão —
  é sensibilidade a env. Chip P-40 mediu 709 no ambiente dele; P-41
  mediu 715 com dummies homogêneas. Ambos são o mesmo baseline sem
  regressão real de código
- Sem env vars: ~11 test files falham no import (env-dependent —
  field-encryption, rate-limiter, ai-pricing, document-compare,
  summary-parser, communication-summary-errors). Não é regressão real
- 168 skipped = ~166 estáticos + 2 conditional (RBAC + tenant-isolation
  guardados por `DATABASE_URL_TEST`)
- `npx tsc --noEmit`: zero
- `npm run lint`: zero na paterna E em worktree (pós-P-40 com
  `root: true` em `.eslintrc.json`)

Snapshots históricos por sprint estão preservados nos bullets acima
("Testes: X passing" em cada bloco de sprint) — não confundir com
baseline atual.

---

## Débitos técnicos com dependência cruzada (registrados para sprints futuros)

**Débitos abertos (atualizado 2026-07-04):**

| ID | Origem | Pendência | Resolve em |
|----|--------|-----------|-----------|
| P-03 | Sprint 14.5 | Visual baseline `scripts/visual-baseline.ts` (script pronto, ~1.5h) | depende app local + seed E2E |
| P-05 | Sprint 14.5 | Lighthouse audit ≥ 90 (script + workflow prontos) | depende `vars.STAGING_URL` no GitHub |
| P-07 | Sprint 15A | Memory `migration-pitfalls.md` salvo: 5 padrões recorrentes em migrações Postgres | ✅ documental, salvo em 2026-06-30 |

Detalhes em `docs/Backlog_Pos_MVP.md`. Débitos antigos (Sprints 1 e 2)
foram fechados na Sprint 11.

**Débitos zerados em 2026-06-30:**
- P-06 Drilldowns AI por tenant — commits `b8b95b7` (tela 1) +
  `27b5519` (tela 2). Sprint 15B entregou o backend + a agregação
  cross-tenant (`/platform/ai-ops`, `/platform/ai-marketplace`), mas
  as 2 telas drilldown por tenant faltavam. Fix:
  `src/app/platform/tenants/[id]/ai/page.tsx` (uso + limites + breakdown
  + histórico 30d + models pinados + anomalias com botão Reconhecer;
  editor de limites em `<details>` colapsável dispara `aiOps.setLimits`)
  e `src/app/platform/tenants/[id]/ai/features/page.tsx` (features
  agrupadas por `AiFeatureCategory` com `<Select>` alternando
  DISABLED/INCLUDED/ADDON_ACTIVE via `aiMarketplace.tenantAccessSet`).
  Header de tenant detail ganhou 2 botões "IA" e "Features IA" como
  entrypoint. Backend não mexeu — routers `platform.aiOps.byTenant`,
  `setLimits`, `acknowledgeAlert` e `aiMarketplace.tenantAccessList`,
  `tenantAccessSet` já existiam do Sprint 15B com audit + `tenantIdOverride`.
  +12 testes em `tests/unit/platform-ai-drilldown.test.tsx` (render,
  empty states, progress bar aria-valuenow, ackMutate, esconde botão
  quando reconhecida, salvar limites parseia null/int, agrupar por
  categoria, select dispara mutation, contador ativas/total). Total
  **537/549 passing** (baseline mantido; 10 falhas pré-existentes por
  env vars ausentes em field-encryption/rate-limiter/ai-pricing/
  document-compare/summary-parser/communication-summary-errors + 2
  skipped). Type-check zero. Lint zero
- P-01 Fix `/companies/new` + `/contacts/new` 404 — commit `54dab90`
- Sprint 15A débito UNIQUE(clerk_id) — commit `62ea353` (migration 0026 + dual identity)
- Platform Owner setup completo (JWT template + public_metadata + seed)
- P-11 Middleware dual identity (headers Platform) — commit `7d60192`.
  `src/middleware.ts` injetava só `x-tenant-id/x-user-clerk-id/x-user-role`
  no branch final, omitindo `x-platform-*` mesmo com
  `platformRole=PLATFORM_OWNER` no JWT. Resultado: `/platform/dashboard`
  retornava 403 do tRPC pra Fred (dual identity). Fix: helper
  `injectPlatformHeadersIfOwner()` chamado em paralelo aos headers
  tenant. +4 testes unitários, 372/378 passing (4 falhas + 2 skipped
  pré-existentes por env vars)
- P-12 Modal rouba foco a cada keystroke — `src/components/ui/modal.tsx`
  tinha `onClose` nas deps do `useEffect` que faz focus inicial
  + Tab trap. Callers passam `onClose={() => setOpen(false)}` inline,
  então cada render do parent (via `setForm` em cada keystroke)
  criava nova closure → identidade de `onClose` mudava → effect
  reciclava → `focusables[0].focus()` roubava foco pro primeiro
  input. Fix: capturar `onClose` em `onCloseRef` e depender só
  de `[open]`. +3 testes em `tests/unit/modal.test.tsx`,
  381/387 passing (4 falhas + 2 skipped pré-existentes)
- P-14 IA usa env global em vez de key por tenant — commit `a80564f`.
  `getAnthropicForTenant(tenantId)` novo em `src/lib/ai/claude.ts`
  decripta `aiApiKeyEncrypted` e retorna client dedicado com cache
  TTL 10min por tenant. Fallback pro global com warn; throw
  apontando /admin/ai quando ambos ausentes. 5 consumidores
  migrados. +6 testes em `tests/unit/claude-per-tenant.test.ts`
- P-15 Mensagem "IA indisponível" engolia erros estruturados — commit
  `be5f244`. Helper `mapAnthropicError` em `src/lib/ai/anthropic-errors.ts`
  converte `Anthropic.APIError` em `TRPCError` acionável (400 credit
  balance → PRECONDITION_FAILED com link, 401/403 → UNAUTHORIZED,
  429 → TOO_MANY_REQUESTS honrando retry-after, 5xx → null mantém
  fallback silencioso). Aplicado nos 3 serviços user-facing.
  +5 testes em `communication-summary-errors.test.ts`, 392/398
  passing
- P-16 Busca global (Command Palette ⌘K) sem handler — botão
  "Buscar…" em `src/components/layout/Topbar.tsx` era placeholder
  desde Sprint 14. Fix: router tRPC novo
  `src/server/trpc/routers/search.ts` (procedure `global`, 4
  buckets companies/contacts/opportunities/users, ILIKE '%q%'
  top 5 cada, RBAC gracioso = bucket vazio quando sem permissão)
  mesclado com `searchNaturalRouter` do Sprint 6 sob a key
  tRPC `search`. Novo componente `src/components/search/CommandPalette.tsx`
  standalone (não usa Modal — evita conflito Tab-trap vs setas)
  com debounce 200ms, ↑/↓/Enter/ESC, empty/loading/hint states.
  Topbar ganhou `onClick` + listener `(Cmd|Ctrl)+K` global. Rotas
  públicas (HIDDEN_ON) não registram o atalho. +18 testes
  (search-router +9, command-palette +9). 399/405 passing (4
  falhas + 2 skipped pré-existentes)
- P-17 Tabelas sem ordenamento clicável — commits `e269325` (infra)
  + `7e4949f` (rollout). `<TH>` do design system era wrapper mudo:
  clicar no header não fazia nada nas 8 tabelas do app. Fix:
  `<TH sortable sortState onSort>` renderiza chevron up/down/dupla
  + `aria-sort` + `tabIndex=0` + Enter/Space; novo hook
  `useTableSort` (asc → desc → null, null-safe, localeCompare
  pt-BR + numeric) e helpers puros para teste. Rollout em
  `/companies`, `/contacts`, `/admin/users`, `/admin/products`,
  `/admin/partners` (card list com select), `/platform/tenants`,
  `/platform/trials`. `/contacts` + `/admin/users` + `/admin/products`
  migrados de raw `<table>` pro Table/TH/TR/TD do design system.
  +23 testes (15 hook + 8 TH), 404/410 passing (4 falhas + 2
  skipped pré-existentes por env vars)
- P-13 401 do middleware vira "Unable to transform response from server" —
  `src/lib/trpc/session-guard.ts` novo com `sessionAwareFetch`
  interceptor injetado no `httpBatchLink` do `provider.tsx`. Detecta
  HTTP 401 na resposta do batch tRPC, loga `console.warn` com a
  mensagem do body do middleware ("Sessão expirada ou ausente. Faça
  login novamente."), agenda `window.location.reload()` em 800ms.
  Flag `handling401` estática garante idempotência num batch com N
  procedures (N × 401 → 1 reload). No-op em rotas públicas
  (`/sign-in`, `/sign-up`, `/onboarding`, `/privacy`, `/terms`,
  `/p/…`, `/`) via `isPublicPath` — evita reload em loop quando
  usuário já está no login. Middleware `src/middleware.ts` não foi
  tocado (formato JSON custom preservado pra debug em Network tab).
  +17 testes em `tests/unit/session-guard.test.ts`, 450/456 passing
  (4 falhas + 2 skipped pré-existentes por env vars)
- P-20 Tarefas na oportunidade sem criar/editar/deletar — a seção
  Tarefas em `/pipeline/[id]` só permitia marcar checkbox DONE;
  faltava criar/editar/deletar. Backend: `tasks.update` e
  `tasks.delete` (soft delete via `deletedAt`) em
  `src/server/trpc/routers/activities.ts`, com `findFirst` filtrando
  por `tenantId` (defesa em profundidade), audit com
  `tenantIdOverride` e RBAC via `withCapability('opportunity',
  'update')`. Frontend: novo componente
  `src/components/pipeline/TasksSection.tsx` com Modal do design
  system (form: título, descrição, prazo, prioridade,
  responsável), botão "+ Nova tarefa", clique na linha abre modal
  em modo edit, botão × dispara `AlertDialog` de confirmação (não
  usa `confirm()` nativo). Toasts Venzo em todas as mutações.
  Timeline extraída como `ActivitiesTimeline` inline no page.tsx.
  +10 testes em `tests/unit/tasks-router.test.ts` (NOT_FOUND
  cross-tenant, undefined não sobrescreve, null limpa campo,
  audit com override, Zod rejeita título curto/id inválido, soft
  delete preenche `deletedAt`). 443/449 passing (4 falhas + 2
  skipped pré-existentes por env vars)
- P-04 audit() sem `tenantIdOverride` em routers tRPC — bug arquitetural
  descoberto após 93ca6df (fix inicial do theme). `audit()` usa
  `AsyncLocalStorage` pra pegar `tenantId`; dentro de `fetchRequestHandler`
  do tRPC o contexto escapa em callbacks assíncronos e a entrada é
  **descartada silenciosamente com warn** (audit_logs vazio mesmo com
  escrita acontecendo). Fix mecânico em 19 routers: todas as 54
  chamadas `audit({...})` receberam `tenantIdOverride: ctx.tenantId,`
  como último campo. Arquivos: activities, ai-config, alerts,
  approval-rules, companies, contacts, contracts, documents, imports,
  inbox, opportunities, partner-engagements, partners, privacy,
  products, proposals, reports, users. `search.ts` só tinha comentário
  "NÃO chama audit()", skipado. Regressão em
  `tests/unit/audit-context-loss.test.ts` com 4 cenários (contexto ok,
  contexto perdido + override, sem contexto sem override, precedência).
  Total 437 passing (baseline 433 + 4 novos), 2 skipped, 4 pré-existentes
  (falhas env vars). Type-check pré-existente em `feature-gate.ts`
  também não regride. Débito adjacente: services em
  `src/server/services/*` que chamam `audit()` podem ter o mesmo bug —
  escopo foi rigidamente routers tRPC conforme spec
- P-19 Upload real de documentos + templates — commits `aa71f25`
  (infra) + `22b63fc` (backend) + `cbbb4c8` (rollout). Sprint 8
  ficou pela metade: modelos Prisma e serviço S3 existem, mas a
  UI pedia digitar SHA-256/URL/tamanho à mão. Fix: novo
  `src/components/ui/file-dropzone.tsx` (drag-and-drop + Web
  Crypto SHA-256 + a11y `role=button`/Enter/Space + polifill
  `Blob.arrayBuffer` em `tests/setup.ts` via FileReader);
  router `documents` ganhou `getUploadIntent` (gera storageKey
  `tenant/${tenantId}/documents/<uuid>-<sanitizedName>`) +
  `uploadProxy` (valida cross-tenant, decoda base64, delega pra
  S3 ou fallback `/tmp/venzo-uploads`). `sanitizeFilename`
  colapsa `..`, strip `/\`, remove diacríticos NFKD.
  `DocumentsSection` + `admin/templates` refeitos; `fileToBase64`
  em chunks pra evitar stack overflow. +24 testes (13 dropzone +
  11 upload-router), 457/463 passing (4 falhas + 2 skipped
  pré-existentes por env vars)
- P-21 Erro Zod renderizado como JSON cru na UI — helper
  `src/lib/trpc/error-format.ts` novo com `friendlyTrpcError(err)`.
  O `errorFormatter` em `src/server/trpc/trpc.ts` já expunha
  `zodError.flatten()` desde o Sprint 0; só faltava o cliente
  extrair. Fallback triplo: `fieldErrors[0]` → `formErrors[0]` →
  `err.message` (compat com `TRPCError` não-Zod, ex:
  `UNAUTHORIZED`). Rollout em 20 arquivos migrando `e.message` (e
  `.error.message` de estado de mutation/query em display) pra
  `friendlyTrpcError(e)`. Rotas: `/admin/users`, `/admin/products`,
  `/admin/listas`, `/admin/alerts`, `/admin/branding`,
  `/admin/email-inbound`, `/contacts`, `/onboarding`, `/imports`,
  `/search`, `/pipeline/new`, `/pipeline/[id]`,
  `/pipeline/@modal`, `/platform/tenants`, `/platform/broadcasts`,
  `/platform/dashboard`, `/platform/impersonate`,
  `/p/[tenantSlug]/contact`, `/p/tc/[token]`. Componentes:
  `CompanyForm`, `CommunicationIntake`, `PipelineKanban`,
  `PipelineMobile`, `TasksSection`, `quick-create-trigger`. Antes:
  usuário via `[{"code":"custom","message":"E-mail
  inválido","path":["email"]}]`; depois: "E-mail inválido" limpo.
  +8 testes em `tests/unit/friendly-trpc-error.test.ts` (fieldError
  único, múltiplos campos, formErrors puro, não-Zod, sem data,
  fallback vazio, arrays vazias intercaladas, strings vazias
  intercaladas). 533 passing (10 falhas + 2 skipped pré-existentes
  por env vars em field-encryption + communication-summary-errors,
  confirmadas em HEAD antes do fix)
- P-02 PageHeader consistente em 13 rotas `/admin/*` — 🟡 do Sprint
  14.5 item 4 fechado. Refactor mecânico substituindo `<h1>` +
  descrição ad-hoc por `<PageHeader title description />` do design
  system em 10 arquivos (`/admin/ai`, `/alerts`, `/approval-rules`,
  `/billing`, `/branding` — 2 ocorrências —, `/contracts`,
  `/conversion-rates`, `/email-inbound`, `/partners`, `/templates`).
  Já corretas (skip): `/admin/listas`, `/admin/privacy`,
  `/admin/products`, `/admin/users`. `/admin/branding` preserva
  banner de override WCAG como div separado (description do
  PageHeader é typed string); `/admin/partners` move link
  `/companies/new` pra parágrafo helper abaixo. Zero `<h1>` residual
  nas 13 rotas. 525 passing (baseline preservado), type-check zero,
  lint zero. Débito adjacente P-26 registrado: 7 rotas fora de
  `/admin` e `/platform` (`/pipeline`, `/pipeline/[id]`, `/inbox`,
  `/contacts`, `/imports`, `/more`, `/reports`) ainda têm `<h1>`
  ad-hoc

**Débitos zerados em 2026-07-05:**
- **P-52** Fixture E2E `axe-smoke.spec.ts` reportava violação
  `html-has-lang` — descoberto pelo QA automation pós-P-50. Fix
  defensivo em `tests/e2e/axe-smoke.spec.ts` adicionando
  `.exclude('iframe')` nas duas `AxeBuilder` chains (rotas públicas +
  autenticadas). Contexto: `ClerkProvider` injeta iframe oculto pra
  session management em todas as rotas, e axe reportava contra o
  `<html>` interno desse subframe que não controlamos.
  `<html lang="pt-BR">` do app segue intacto em
  `src/app/layout.tsx:59`. Validação: Playwright rodado localmente
  (chromium-desktop + mobile-safari) contra dev server; contagem de
  violations idêntica ANTES/DEPOIS (42 `color-contrast` em ambos —
  zero regressão do meu lado). `html-has-lang` não apareceu no ambiente
  de dev com dummy Clerk keys (não inicializa iframe), mas o exclude
  é defensivo pra staging/prod onde keys reais injetam iframe. Novo
  débito **P-54** registrado pra `color-contrast` da CookieBanner
  (`.text-brand` sobre bg dark = 2.97:1 vs 4.5:1 requerido) — não é
  escopo P-52. Type-check zero. Lint zero. QA automation exception
  aplicada (fixture E2E, sem código de app)
- **P-50** Campo "Valor estimado (R$)" sem máscara pt-BR — descoberto
  em uso real 2026-07-05 pelo Fred em prod. Input `type="number"` cru
  mostrava `289311` sem separador. Fix: `src/lib/utils/format.ts`
  ganha 2 helpers `formatBRLInput`/`unformatBRLInput` seguindo padrão
  Sprint 15C (CNPJ/CEP bidirecional). Regra: último `.` ou `,`
  seguido de 0-2 dígitos = decimal (display); 1-2 dígitos = decimal
  (unformat, `,` trailing sem dígitos vira integer). Cap 12 dígitos
  inteiros + 2 decimais. Zeros à esquerda strippados. Normaliza `.`
  decimal em `,` no display (compat calculadora). Aplicado em 2
  pontos: `src/app/pipeline/new/page.tsx:186-193` (troca `type=number`
  por `type=text inputMode=decimal` + `formatBRLInput` on-change +
  `unformatBRLInput` no submit linha 76) e
  `src/app/pipeline/[id]/page.tsx:319-325` (mesmo pattern +
  `coerceFields` linha 417 troca `Number(v)` por `unformatBRLInput(v)`).
  Compat com valores legados no banco preservada — número puro sem
  escala de centavos entra/sai igual. +15 testes novos em
  `tests/unit/format-brl-input.test.ts` (vazio, incremental, decimal
  opcional, cap 12 dígitos, colar valor pré-formatado, round-trip,
  ponto-como-decimal). Baseline: **741 passing (+15 novos) / 6
  pré-existentes por env vars em `communication-summary-errors.test.ts`
  (confirmado idêntico ANTES do fix) / 172 skipped**. Type-check zero.
  Lint zero. Sem dependência nova (Intl + regex puro)
- **QA automation pós-P-50** — chip QA verificou main `@9b4c831` contra
  baseline `@a69b0ce`. Verdict: **OK seguir, zero regressão**. Baseline
  pós: 741/6/172 bate 1:1 com o esperado. Coverage `format.ts`: **100%
  linhas / 95.16% branches / 100% funcs**. Grep de `estimatedValue` em
  outros forms confirmou refactor cirurgicamente completo (5 outros
  usos são leituras de persistência via `Number(o.estimatedValue)` em
  routers/services, não escritas — intactos). `coerceFields` em
  `pipeline/[id]` preservou branches dos outros campos. Playwright
  rodou (browsers disponíveis) — 7 falhas pré-existentes por fixture
  Sprint 14 desatualizada e violação `html-has-lang` (não P-50).
  Novos débitos registrados: **P-51** (smoke.spec desatualizada
  ~15min), **P-52** (axe html-has-lang ~30min), **P-53** (falta
  harness Testing Library pra forms ~4h piloto)
- **Housekeeping cycle** — residuais R1/R2/R3 dos chips P-39 e P-40
  fechados em um único commit docs+config (sem código de app):
  - **R1** — dummy `CLERK_ENCRYPTION_KEY` documentada no `.env.example`
    bloco Clerk. Silencia o warn `Missing CLERK_ENCRYPTION_KEY` do SDK
    em `next dev`. Var não passa pelo Zod schema (`src/lib/env.ts`
    intacto); SDK Clerk lê direto. Prod continua com
    `openssl rand -base64 32`
  - **R2** — `docs/Roteiro_QA_Homologacao_Staging.md` §0 (linha 36) e §5
    (linha 565) atualizados de "609 passing / 10 failed" pra "715 passing
    / 0 failing / 168 skipped (883 total)" com nota sobre variância
    709–715 dependendo de `ANTHROPIC_API_KEY`
  - **R3** — nota de variância adicionada em `CLAUDE.md` §Baseline e
    `docs/Metodologia_Desenvolvimento_Venzo.md` §5.2 esclarecendo que
    709 (env real parcial) e 715 (env dummy 100%) são o mesmo baseline
    verde — 6 tests em `communication-summary-errors.test.ts` dependem
    de chave IA real. Sensibilidade a env, não regressão
  - QA automation exception aplicada — docs+config only, sem código de
    app. Baseline preservado. Type-check zero. Lint zero
- **P-42** Backstop tenant-isolation quebrava `.update` sem `tenantId`
  no data — bug crítico descoberto em produção (Vercel prod) quando
  o Fred salvava campos por estágio no `/pipeline/<id>` estágio Lead
  (`meetingScheduledAt` + `meetingHappened`). `src/server/db/client.ts`
  linha 122-131 lançava `Error("[tenant-isolation] <Model>.<op> sem
  tenantId no payload")` cru pra QUALQUER `.update`/`.upsert` que não
  passasse tenantId no data. Só `User.update` e `Task.update` estavam
  em `ALLOW_MISSING_TENANT_ON_WRITE`, deixando 8+ modelos afetados
  (Opportunity, Company, Contact, Product, Proposal, Approval,
  PartnerEngagement, InboundLeadRejected + Document via side-effect
  em transação `documents.create`). Fix: extraída função pura
  `assertTenantWritePayload(model, op, ctxTenantId, payload)`
  exportada com semântica reformada: `create` continua exigindo
  tenantId (defesa contra bypass explícito com tenantId ≠ ctx);
  `update`/`upsert.update` NÃO exigem mais (WHERE injection já
  bloqueia cross-tenant — row alvo é imutável); só bloqueiam se
  payload declara tenantId ≠ ctx (tentativa deliberada de mover row).
  `ALLOW_MISSING_TENANT_ON_WRITE` eliminado. +17 unit em
  `tests/unit/tenant-backstop.test.ts` (função pura + `it.each` pros
  8 modelos afetados) + 4 integration em
  `tests/integration/opportunities-update.test.ts` (regressão bug
  500 + update simples + 2 defesas cross-tenant, skipa sem
  `DATABASE_URL_TEST`). Baseline: 726 passing (baseline 715 + 11
  novos) / 6 pré-existentes por env vars em
  `communication-summary-errors.test.ts` (confirmado idêntico ANTES
  do fix via stash) / 172 skipped. Type-check zero. Lint zero.
  Rollback: reverter `src/server/db/client.ts`. Débitos residuais
  registrados: **P-44** (caller tRPC), **P-45** (audit createMany),
  **P-46** (map Error pra TRPCError com friendlyTrpcError).
- **QA automation pós-P-42** — chip QA verificou main `@636a9cc`
  contra baseline `@79dc437`. Verdict: **OK seguir, zero regressão**.
  Baseline pós: 732 passing (+17 do P-42 unit) / 0 failing / 172
  skipped (+4 do P-42 integration guarded por `DATABASE_URL_TEST`).
  Cobertura `assertTenantWritePayload` = 100% linhas, 93.75% branches.
  Extension Prisma runtime (linhas 71-185) fica em 32.63% — coberta
  pelos 4 integration tests ativáveis por `DATABASE_URL_TEST` (padrão
  do repo desde Sprint 11). Type-check zero, lint zero. Playwright
  BLOCKED por infra (worktree sem browsers nem Postgres) — não por
  P-42; registrados como P-48 e P-49. Novo débito P-47 identificado
  (Vitest sem `dotenv/config` = causa raiz do P-43). QA report
  bate 1:1 com o que o chip P-42 documentou (+21 tests, mesma
  distribuição unit/integration)

**Débitos zerados em 2026-07-04:**
- P-40 Conflito `.eslintrc.json` em worktree — fix defensivo
  adicionando `"root": true` no topo de `.eslintrc.json` do repo.
  ESLint para de subir a árvore de diretórios procurando eslintrc
  parent — qualquer config em pasta acima (existente ou futura) é
  ignorada. Investigação confirmou que hoje não existe
  `.eslintrc.json` em `/Users/fredmarqueziniyahoo.com.br/Claude/`;
  o conflito reportado em 2026-07-04 provavelmente foi transitório,
  mas `root: true` é boa prática de qualquer forma pra configs raiz.
  Validação: `npm run lint` zero na paterna + `npm run lint` zero
  em worktree efêmera criada de HEAD com node_modules symlinkado.
  Baseline testes preservado (709 passing + 6 falhas pré-existentes
  em communication-summary-errors por env vars + 168 skipped — as
  falhas reproduzem na paterna antes e depois do fix). Type-check
  zero. QA automation exception aplicada (config-only sem impacto
  runtime; validação inclui npm test + lint em worktree efêmera)
- P-37 Roteiro de QA fragmentado — [`docs/Roteiro_QA_Homologacao_Staging.md`](docs/Roteiro_QA_Homologacao_Staging.md)
  novo consolida cenários de homologação staging que estavam
  espalhados entre chat + `Backlog_Pos_MVP.md` + `HANDOFF_Estado_Atual_2026-07-01.md` +
  `Runbook_Staging.md` + `DEPLOY_Vercel_Guide.md` + `DEPLOY_Railway_Worker.md`.
  Checklist executável em 7 seções (§0 pré-deploy bloqueadores · §1
  smoke 5min · §2 funcional ~1h com blocos por feature · §3 segurança
  · §4 degradado · §5 automatizado · §6 rollback · §7 sign-off PO) +
  3 anexos (env vars por ambiente, endpoints com rate limit,
  referências rápidas). Cada checkbox tem passo + critério pass/fail
  explícito; comandos curl/npm executáveis onde aplicável. Cobre
  Pipeline 7 estágios, `/admin/ai` 4 Cards (P-23), drilldown por
  tenant (P-06), Inbound Marketing (Sprint 15D), RBAC Granular
  (Sprint 15E) com guard anti-escalada, Command Palette ⌘K (P-16),
  multi-tenancy cross-tenant, vazamento de chave IA, audit_logs em
  mutations. 4 blocos com variações completas preenchidas (§2.3.a
  8 variações /admin/ai · §2.3.b 6 drilldown P-06 · §2.4 8 Inbound
  Sprint 15D · §2.6 9 Command Palette), extraídas do código real
  (admin/ai/page.tsx, admin-alerts.ts, inbound-parser.service.ts,
  CommandPalette.tsx). Zero placeholder residual — 691 linhas total.
  Manutenção: quando cenário virar release-blocker recorrente,
  promover pra §3; quando cenário virar automatizado, mover pra §5.
  Backlog atualizado (P-37 ✅) + HANDOFF §7 referências ganha entrada
  nova
- P-39 Fixture Clerk mock pra QA/dev local — docs-only. Sem
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` real, o SDK Clerk falava
  "Publishable key not valid" e `next dev` ficava inutilizável em
  worktree isolada. Investigação em `@clerk/shared/dist/keys.js`
  mostrou que `isPublishableKey` valida só (1) prefixo
  `pk_test_`/`pk_live_` e (2) que o segmento base64-decoded termina
  em `$` — sem checagem de rede na inicialização. Fix: `.env.example`
  ganha dummy `pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk` (base64
  decoda pra `fake.clerk.accounts.dev$`) + `sk_test_dummy_do_not_use_in_prod`.
  Comentário de 10 linhas acima explica dev/QA local vs staging/prod.
  Rotas protegidas ainda exigem login que falhará com Clerk API
  (`clerk_key_invalid`) — combine com bypass `NODE_ENV=test` em
  `tests/e2e/fixtures/auth.ts` (Sprint 11) pros Playwright.
  Verificação manual: `rm -rf .next && npm run dev` sobe em 1.2s,
  `HEAD /` → 200, `HEAD /sign-in` → 200, header
  `x-clerk-auth-reason: dev-browser-missing` confirma middleware
  Clerk rodando. Débito residual: runtime warning
  `Missing CLERK_ENCRYPTION_KEY` aparece com dummies (não crasha,
  var não relacionada à pub key). Roteiro de QA baseline
  ("609 passing / 10 failed" em §0) desatualizado — sub-débito 15min,
  não bloqueia P-39. QA automation exception aplicada (docs-only,
  sem código de app novo). Backlog atualizado (P-39 ✅)

**Débitos zerados em 2026-07-01:**
- P-26 PageHeader em rotas fora de `/admin` e `/platform` — refactor
  mecânico substituindo `<h1>` + descrição ad-hoc por
  `<PageHeader title description />` em 6 rotas: `/pipeline`
  (primaryAction "+ Nova oportunidade"), `/inbox` (secondaryAction
  "Configurar endereço →"), `/contacts`, `/imports`, `/more`,
  `/reports` (secondaryAction "↓ Exportar Excel").
  `/pipeline/[id]` **skipado por design** — header atual é unidade
  contextual rica (título dinâmico + razão social + valor destacado
  + badges estágio/status + botões avançar/voltar/cancelar); aplicar
  PageHeader degradaria a UX (perderia layout right-aligned).
  Consistência não vale regressão. Baseline mantido: 561 passing /
  10 pré-existentes (env vars field-encryption + communication-summary-errors) /
  2 skipped. Type-check zero. Lint zero
- P-23 UI `/admin/ai` (4 Cards) — commits `17ef181` + `26833ac`.
  Sprint 15F entregou backend multi-provider completo, mas UI
  estava pré-15F (só provider global). Refactor completo de
  `src/app/admin/ai/page.tsx` em 4 cards consumindo `aiConfig`
  router:
  - Card A: configuração padrão do tenant (provider/model/apiKey)
    + botão "Testar chave" (`testKey` retorna latência sem eco
    da chave)
  - Card B: tabela agrupada por `AiFeatureCategory` (5 features
    Sprint 15F), badge de status, indicador Herdada/Custom.
    Clique abre `FeatureEditModal` com trinca provider/modelo/
    chave própria + trinca fallback + costAlertBrlMonthly →
    `updateFeature`
  - Card C: total mês corrente (tokens + custo USD) + breakdown
    por (provider, modelo) via `monthlyUsage`. Breakdown primary
    vs fallback fica pra depois (débito residual em P-23).
  - Card D: alertas puros — regra em `src/lib/ai/admin-alerts.ts`
    (novo, isolado da page pra testar sem tRPC). CIRCUIT_OPEN
    dispara `AlertDialog` de confirmação → `clearCircuitBreaker`;
    MISSING_KEY quando feature ativa sem chave e tenant sem chave
    global. Refinamentos (fallback frequente, custo threshold)
    registrados como débitos residuais em P-23.
  Testes: +16 (10 casos puros em `admin-ai-alerts.test.ts`,
  6 casos smoke em `admin-ai-page.test.tsx` com trpc mockado
  no padrão do `command-palette.test.tsx`). Total 541 passing /
  10 falhas + 2 skipped pré-existentes por env vars
  (field-encryption, rate-limiter, ai-pricing, document-compare,
  summary-parser, communication-summary-errors — todos falham
  no import por env vars ausentes; irrelevante a este chip).
  Type-check zero. Lint zero. Sem alterações no backend.
- P-24 UI `/platform/ai-marketplace` form "Adicionar feature" —
  fechado em 2026-07-01. Débito residual do Sprint 15F: o Platform
  Owner só podia adicionar features novas via INSERT direto no
  banco. Fix backend + frontend:
  - **Backend** (`src/server/trpc/routers/platform-ai-marketplace.ts`):
    nova mutation `createFeature` (platformProcedure) com Zod
    validando code kebab-case (regex `/^[a-z0-9-]+$/`, 3-64 chars),
    name/description tamanhos, category/provider como
    `nativeEnum`, defaultInclusion como shape `{TRIAL, STARTER,
    PRO, ENTERPRISE}` × `disabled|included|addon` (alinhado ao seed
    da migration 0018), addonPrices opcionais nullable. CONFLICT
    quando code duplicado. `platformAudit` com `after` populado
  - **Frontend** (`src/app/platform/ai-marketplace/page.tsx`):
    botão "+ Nova feature" no PageHeader abre `<Modal size="lg">`
    com form completo (code em font-mono minusculado on-change,
    name, description via `<Textarea>`, 2 selects enum, modelo
    padrão como input livre, fieldset com 4 selects de inclusão
    por plano em grid 2×2/4×1 responsivo, 2 inputs de preço
    add-on opcionais). Submit converte strings vazias em null.
    `friendlyTrpcError` (P-21) traduz erro Zod. `onSuccess`
    invalida `list` e reseta form
  - Testes: +14 novos em
    `tests/unit/platform-ai-marketplace-create.test.ts` (7 de
    validação Zod — kebab-case pass/fail em 3 variações, descrição
    curta, provider inválido, defaultInclusion parcial; 5 de
    persistência — CONFLICT, campos corretos + active=true,
    preços nullable, audit assertion, list mostra criada; 2 de
    RBAC — sem platformUser=FORBIDDEN em 2 variações). 563
    passing / 4 falhas + 2 skipped pré-existentes por env vars
    (field-encryption). Type-check zero (apenas erros pré-existentes
    fora dos meus arquivos). Lint zero
  - Escopo intencionalmente estreito: não implementa delete (spawn
    de P-27 se necessário) nem edit inline de campos além dos já
    cobertos pelo `setFeature` (active/addonPriceBrlMonthly/
    defaultProvider/defaultModel)
  - **P-23 refino** (mesmo débito, complementar) — Card C ganhou
    breakdown primary vs fallback e Card D ganhou 2 tipos novos de
    alerta:
    - `getMonthlyUsage` agora agrega por `(provider, model,
      usedFallback)` e pivota devolvendo `requests/tokens/cost` +
      `fallbackRequests/fallbackTokens/fallbackCost` por linha, além
      de `totalFallbackTokens/totalFallbackCostUsd`
    - Nova query `aiConfig.featureUsageForAlerts` retorna por
      feature: `fallbackCountLast24h` (rows com `used_fallback=true`
      últimas 24h) e `costBrlMtd` (soma `cost_usd` do mês corrente ×
      `env.USD_BRL_RATE`, sem margem — tenant traz própria chave).
      Mapa `FEATURE_CODE_TO_REQUEST_TYPE` conecta `feature.code` ao
      `requestType` que cada service loga
    - `admin-alerts.ts` estendido: `FALLBACK_FREQUENT`
      (constante `FALLBACK_ALERT_THRESHOLD = 3` em janela 24h) e
      `COST_ABOVE_THRESHOLD` (dispara quando `costBrlMtd >
      costAlertBrlMonthly`, comparação estrita). Ambos severity
      `yellow`, sem CTA — só informativo. Assinatura de
      `AlertInputs.featureUsage` é opcional pra compat com callers
      antigos
    - UI Card C substituiu `Table` por lista de rows com barras
      lado-a-lado (info primary + warning fallback) via CSS puro,
      largura proporcional ao maior custo da tela; header ganhou
      legenda "Primary · Fallback"; grid de stats subiu de 2 pra
      4 cards (adiciona Tokens fallback + Custo fallback USD)
    - UI Card D consome `featureUsageForAlerts` e o rendering
      atual já cobre severity yellow com border/bg warning — sem
      botão de ação nos 2 novos tipos
    - Testes: +7 em `admin-ai-alerts.test.ts` (FALLBACK ≥3, <3,
      COST > threshold, threshold null, comparação estrita,
      ordem CIRCUIT→MISSING→FALLBACK→COST, compat sem
      featureUsage) + 3 smoke em `admin-ai-page.test.tsx`
      (breakdown com barras primary+fallback, alerta
      FALLBACK_FREQUENT visível, alerta COST_ABOVE_THRESHOLD com
      "Limite configurado"). Total 549 passing / 4 falhas + 2
      skipped pré-existentes (mesmo baseline). Type-check zero.
      Lint zero
    - Débitos residuais registrados: (1) conversão USD→BRL usa
      `env.USD_BRL_RATE` estático (sem cotação viva) — subir pra
      Sprint 15G se importar; (2) `FALLBACK_ALERT_THRESHOLD = 3`
      hardcoded, não exposto na UI de admin (P-XX se admin pedir);
      (3) mapa `FEATURE_CODE_TO_REQUEST_TYPE` manual — cada nova
      feature IA precisa adicionar entrada explícita, débito
      arquitetural pra registry central em Sprint 15G

---

### Sprint 14.5 — Polish Pass (concluído)
- [x] **Item 2 (primeiro) — Border-radius bump**: tokens HSL globais
      `--radius-sm: 6` / `--radius: 8` / `--radius-md: 12` / `--radius-lg: 16`
      + `--radius-xl: 20` (novo). Tailwind `borderRadius.xl` exposto
- [x] **Item 1 — Pipeline overflow corrigido**:
  - `src/lib/utils/format.ts` novo com `formatBRL`, `formatBRLCompact`
    (`R$ 288k` / `R$ 1,2M`), `formatPercent`, `formatRelativeDate`
  - `crm/OpportunityCard.tsx` refatorado: header stack vertical
    (título line-clamp-2 + valor em gold tabular-nums); badge de
    estágio movido para o rodapé; tooltip com valor completo via `title`
  - `pipeline/OpportunityCard.tsx` segue mesma estrutura
  - `PipelineKanban.tsx`: colunas com `minWidth: 280, maxWidth: 320,
    scrollSnapAlign: start`; total da coluna em gold/tabular-nums com
    tooltip completo
- [x] **Item 5 — Popover via Radix**:
  - `npm i @radix-ui/react-popover`
  - `src/components/ui/popover.tsx` wrapper com tokens Venzo (bg-card,
    border-border, radius-lg, animações via tailwindcss-animate)
- [x] **Item 6 — Sheet + Tabs + DetailSheet**:
  - `npm i @radix-ui/react-tabs`
  - `src/components/ui/sheet.tsx` (Radix Dialog) variants `right` (400px
    desktop) / `bottom` (85vh mobile com handle visual); sem swipe
  - `src/components/ui/tabs.tsx` (Radix Tabs) com border-bottom
    violet no ativo
  - `app/pipeline/@modal/(.)[id]/page.tsx` refatorado com 4 tabs
    (Visão geral / Atividades / Documentos / Histórico); Overview e
    History implementados, Activities/Documents apontam para a
    página completa
- [x] **Item 3 — FunnelChart refeito**:
  - Grid interno 3 colunas (110px / 1fr / 90px): valor R$ esquerda,
    barra com label central, conversão direita
  - Largura por contagem (não por valor)
  - Sinal correto: `≥100% → +X.X%` em `text-success`;
    `<100% → X.X%` em neutro/text-2 (eliminado o falso `↓114.3%`)
  - Última etapa: gradient `--success`; demais: gradient brand
  - `<dl class="sr-only">` como alternativa textual completa
- [x] **Item 7 — Banners contextuais**:
  - `src/components/ui/banner.tsx` base reutilizável (3 variantes,
    `aria-live="polite"`, dismissible opcional)
  - `PastDueBanner` — não descartável, refetch 60s, link
    `/admin/billing`
  - `OfflineBanner` — listener `online`/`offline` do window,
    SSR-safe, ícone de Wi-Fi cortado, auto-recupera
  - `MaintenanceBanner` — controlado por
    `NEXT_PUBLIC_MAINTENANCE_MESSAGE` (env), descartável via
    sessionStorage com chave incluindo a mensagem (mudar reaparece)
  - `ContextBanners` agregador inserido no `AppShell` abaixo do
    `Topbar`, ordem manutenção > past due > offline
- [x] **Item 4 — PageHeader + polish 8 rotas modelo**:
  - `src/components/layout/PageHeader.tsx` (title + description + meta
    + primaryAction + secondaryAction; layout flex responsivo)
  - Aplicado em: `/companies` (com Table do design system + EmptyState
    + Badge), `/search`, `/approvals`, `/contracts`, `/admin/users`
    (PageHeader + Button), `/admin/products`, `/admin/privacy`,
    `/dashboard` (já feita no Sprint 14)
  - 13 rotas restantes pendentes (mecânico ~3h em sessão dedicada)
- [x] **Item 8 — Lighthouse audit script + workflow**:
  - `scripts/lighthouse-audit.mjs` percorre 4 rotas-chave em
    headless Chromium, aplica thresholds (a11y 90 / perf 85 /
    best-practices 90 / SEO 80) e falha o processo se algum cair
  - `.github/workflows/lighthouse.yml` em `pull_request` com
    `vars.STAGING_URL`, comenta resultados no PR via
    `github.rest.issues.createComment`
  - Standby até staging existir
- [x] **Item 9 — Visual baseline pendente operacional**:
  - `tests/visual/README.md` documentando procedimento (setup env +
    seed + execução + commit + diff em PR)
  - Script `scripts/visual-baseline.ts` do Sprint 14 já existe
  - Captura depende de app local rodando com seed E2E
- [x] Testes: 262/262 unit (+27 do Sprint 14.5: format +13,
      funnel-math +5, banners +9). Type-check zero. Lint zero

### Sprint 14 — Venzo Design System (concluído)
- [x] **P0 — Visual baseline script**: `scripts/visual-baseline.ts`
      (Playwright) percorre 25 rotas × 3 viewports (375/768/1280)
      salvando em `tests/visual/{baseline|current}/`. Execução
      requer app rodando com seed E2E (postergada para CI/staging)
- [x] **P3 — Tokens HSL com canais separados**: cada cor exposta como
      `--brand-primary-h/-s/-l` em `globals.css` permitindo Tailwind
      alpha modifiers (`bg-brand-primary/50`). `hexToHsl()` em
      `src/lib/theme/color.ts` converte HEX → canais para tenant
      theming. `tailwind.config.ts` usa
      `hsl(var(--name-h) var(--name-s) var(--name-l) / <alpha-value>)`
- [x] **P2 — next-themes**: `ThemeProvider` com
      `attribute="data-theme"` + `defaultTheme="dark"` +
      `enableSystem` + `disableTransitionOnChange`.
      `suppressHydrationWarning` no `<html>`. `ThemeToggle` no topbar
      com SSR-safe mount. **FOUC eliminado**
- [x] **P5 — 3 zonas de viewport**: `AppShell` detecta variante via
      matchMedia: `< 768` BottomNav, `768–1023` Sidebar overlay com
      hamburger no topbar, `≥ 1024` Sidebar fixa colapsável. Atalho
      `Cmd+B / Ctrl+B`. Estado persistido em localStorage
- [x] **P1 — Intercepting routes DetailSheet**:
      `app/pipeline/layout.tsx` com slot `{modal}`,
      `app/pipeline/@modal/(.)[id]/page.tsx` renderiza sheet 400px
      sobre o kanban mantendo URL `/pipeline/{id}` (Voltar fecha
      sheet, F5 cai em `/pipeline/[id]/page.tsx` full-page).
      Default em `@modal/default.tsx`
- [x] **AppShell completo**:
  - `Topbar` 56/48px com breadcrumb hierárquico calculado de
    `usePathname`, busca global Cmd+K (placeholder), ThemeToggle,
    botão hamburger em tablet/mobile
  - `Sidebar` com 4 seções (Operação / Documentos / Parceiros /
    Admin), 24+ ícones Tabler-style inline (sem deps externas),
    item ativo destacado com `aria-current="page"` + border-left
    violeta, focus-visible em todos os links
  - `BottomNav` 5 tabs (Início/Pipeline/Inbox/Alertas/Mais) com
    `md:hidden`, safe-area-inset-bottom, touch ≥ 48px
- [x] **Componentes base refeitos** (consumindo tokens HSL):
  - `Button` 5 variants (primary/secondary/ghost/danger/link) ×
    3 tamanhos (sm/md/lg) + accent, loading com spinner inline,
    leftIcon/rightIcon, focus-ring 2px offset 2px, mantém compat
    com variants legados (default/destructive/outline)
  - `Input`, `Textarea`, `Select` em `input.tsx` — 6 estados via
    classes (default/hover/focus/filled/error/disabled),
    `aria-invalid` automático em error, dropdown chevron SVG inline
  - `Field` em `field.tsx` — wrapper a11y que injeta `id`,
    `aria-required`, `aria-describedby` no primeiro child;
    helper text + erro com `role="alert"`
  - `Badge` em `badge.tsx` — 7 variants + `dot` opcional
  - `Avatar` + `AvatarGroup` — 5 tamanhos, foto OU iniciais (violet
    15% bg, violet-light text), online dot ring 2px na cor do card
  - `Checkbox`/`Radio`/`Switch` em `controls.tsx` — focus ring 3px
  - `Tooltip` em `tooltip.tsx` — `role="tooltip"` +
    `aria-describedby`, delay 300ms hover, instant em focus
- [x] **Componentes de dados**:
  - `Table` (THead/TH/TBody/TR/TD) com header 11.5px uppercase
    tracking 0.06em, linha 48px hover bg, border-collapse, overflow
    horizontal scrollable
  - `EmptyState` + `ErrorState` + `SkeletonRow` em `empty-state.tsx`
  - `TableEmpty` + `TableSkeleton` em `table.tsx`
  - Shimmer animation 1.6s no skeleton via globals.css
- [x] **Componentes CRM-específicos**:
  - `OpportunityCard` em `crm/OpportunityCard.tsx` — header com
    nome + badge + valor em gold, contato + próxima atividade no
    corpo, footer com avatar do responsável + dias no estágio.
    `border-left 3px` muda para danger (overdue) / warning (≤48h).
    IA badge opcional com score `ti-sparkles`
  - `ContactCard` em `crm/ContactCard.tsx` — avatar + badge tipo,
    e-mail/telefone/LinkedIn clicáveis com aria-label, banner de
    próxima data importante
  - `ActivityTimeline` em `crm/ActivityTimeline.tsx` — linha
    vertical com dots coloridos por tipo (manual/sistema/email/
    meeting/alert/ai_summary), agrupamento por dia com sticky
    header "Hoje · Ontem · [data]", formatação relativa de tempo
- [x] **Feedback**:
  - `ToastProvider` + `useToast` em `toast.tsx` — 4 tipos com
    `aria-live` polite/assertive, máx 3 visíveis, auto-dismiss
    4-6s (error é manual), animação slide-in-right
  - `Modal` + `ModalFooter` em `modal.tsx` — `role="dialog"` +
    `aria-modal`, **focus trap** Tab/Shift+Tab cicla dentro,
    Escape fecha, foco retorna ao trigger, 3 tamanhos
  - `TrialExpiryBanner` (Sprint 12) e `OnboardingChecklist`
    (Sprint 13) refinados para usar tokens novos
- [x] **Dashboard refinado** — header com saudação Venzo
      ("Bom dia, X."), copy contextual com contagem de compromissos,
      Badge no contador de cada seção, skeleton no loading state,
      `EmptyCard` substitui mensagens robóticas, AlertRow usa
      semânticas (success/warning/danger no dot)
- [x] **Voice & tone pass** — 17 ocorrências de "Nenhum encontrado"
      e variantes substituídas por voz Venzo (orientado a ação:
      "Cadastre o primeiro", "Suba seu primeiro CSV", "Sem
      contratos ativos — os assinados aparecem aqui"). As 4
      restantes (regras de aprovação, IA, fonte popular, propostas)
      já tinham copy Venzo direto e foram preservadas
- [x] **A11y**:
  - `:focus-visible` global em `globals.css` com outline 2px violeta
  - `prefers-reduced-motion` aplicado em todos os elements/transitions
  - Skip link `<a class="skip-link" href="#main-content">` como
    primeiro elemento focável no `<body>`
  - `tests/e2e/axe-smoke.spec.ts` com `@axe-core/playwright` em 5
    rotas públicas + 4 rotas autenticadas (gated por fixture)
- [x] **Testes**: 235/235 unit (+18 Sprint 14: color-hsl +6,
      design-tokens +9, voice-tone +3). Type-check zero. Lint zero
- [x] **Refactor mecânico de 65 arquivos** via perl pass: classes
      Tailwind genéricas → tokens Venzo (`bg-white` → `bg-card`,
      `text-neutral-{900..400}` → `text-text-{1,1,2,3}`,
      `border-neutral-*` → `border-border{-strong}`,
      semânticos `text-red/rose/emerald/amber/blue-*` →
      `text-danger/success/warning/info{-text}` e equivalentes em
      bg/border). Único `bg-white` restante é o thumb do Switch
      (intencional). Zero classes Tailwind genéricas em src/app
- [x] **Polish individual das telas públicas**:
  - `/sign-in` + `/sign-up`: layout centrado com logo VENZO + tagline
  - `/privacy` + `/terms`: tipografia editorial (max-width 720px,
    leading 1.6, escala Venzo h1/h2/body-lg, links violet-light)
  - `/privacy-request`: form com Field/Input/Select/Textarea/Button
    do design system, copy Venzo ("Recebemos seu pedido. Conforme
    a LGPD, respondemos em até 15 dias.")
  - `/`: landing nova com display hero "Feche mais. Vença sempre.",
    CTAs Entrar/Criar conta com `bg-brand-primary`, instruções
    dev no card secundário
  - `/onboarding`: layout centralizado com Field/Input/Button,
    saudação Venzo ("Bem-vindo, {nome}.") + redirect pós-criação
    para `/onboarding/setup`
  - `/onboarding/setup`: tipografia Venzo + copy Venzo + link
    underline violet-light pro dashboard
  - `/p/[slug]/contact`: form público polido com cabeçalho "Fale
    com a gente" e confirmação "Recebemos!" em vez de "Obrigado"
- [ ] **Lighthouse audit ≥ 90** em /dashboard, /pipeline, /contacts,
      /admin/billing — pendente de staging operacional
- [ ] **Visual regression baseline capturado** — pendente de app
      rodando

### Sprint 13 — UI Hardening + Onboarding Guiado (concluído)
- [x] Migration `0015_tenant_setup_state` — `Tenant.setupCompletedAt` +
      `Tenant.tourDismissedAt`
- [x] **Hardening segurança**: `users.updateRole` + `users.invite` agora
      têm guard `assertCanAssignSuperAdmin` — apenas SUPER_ADMIN pode
      atribuir/alterar role SUPER_ADMIN. ADMIN tentando promover ou
      rebaixar SUPER_ADMIN recebe FORBIDDEN. UI espelha desabilitando
      a opção no dropdown
- [x] `onboarding-progress.service.ts` — `computeChecklist(tenantId)`
      retorna 9 steps com heurísticas em tempo real (counts de users/
      companies/products/approval_rules/territories/segments + booleans
      de aiApiKey/inboundSlug/themeConfig); `dismissTour` +
      `markSetupCompleteIfDone`
- [x] Router `onboarding` estendido com `progress` (query),
      `dismissTour` (mutation), `markCompleteIfDone` (mutation)
- [x] `Sidebar.tsx` desktop fixa (>= md) — 2 seções (Operação 10 itens /
      Administração 13 itens), colapsável com persistência em
      localStorage, atalho `Cmd+B`/`Ctrl+B`, item ativo destacado com
      `aria-current="page"`, item colapsado vira ícone com tooltip
- [x] `SidebarSpacer` reserva largura para o main content (60 expandido,
      14 colapsado) reagindo a evento de storage
- [x] `AppShell` envolve children + Sidebar + BottomNav
      (BottomNav agora restrito a `md:hidden` pelo seu próprio CSS;
      hidden nas rotas auth/legal)
- [x] `RootLayout` — `BottomNav` standalone substituído por `AppShell`
- [x] WCAG explícito em todos os novos componentes:
      - botão de colapsar tem `aria-expanded` + `aria-label` +
        `focus-visible:ring-2 focus-visible:ring-brand`
      - todos os forms usam pattern `<Field label htmlFor>` com `aria-required`
        inferido automaticamente
      - tabelas com `<caption>` e `scope="col"` em todas as headers
      - progress bar usa `role="progressbar"` com `aria-valuenow/min/max`
      - lista de steps com `role="list"` e ícones com `aria-label`
- [x] `/contacts` standalone — lista com filtros (busca, área, tipo de
      relacionamento), form unificado create/update, soft delete,
      vinculação opcional a empresa
- [x] `/admin/products` CRUD completo — name, type (5 opções),
      sku, minMarginPct (0-100), active flag, soft delete
- [x] `/admin/users` CRUD — tabela com lastLoginAt, dropdown role com
      7 opções (SUPER_ADMIN só visível para SUPER_ADMIN), modal de
      convite com role default ANALISTA, botão desativar com confirm
- [x] `OnboardingChecklist` componente — 2 variantes: `compact`
      (card no /dashboard, dispensável) e `full` (página completa).
      Esconde quando `setupCompletedAt` ou `tourDismissedAt` setados
- [x] `/onboarding/setup` — página dedicada com checklist `full`
      mostrada após `createFirstTenant`; auto-tenta marcar como
      completo ao montar
- [x] `/more` mantém lista funcional para mobile + aviso visual em
      desktop apontando para a sidebar (sem redirect server-side, deep
      links continuam funcionando)
- [x] Testes: 217/217 unit (+10 Sprint 13: onboarding-progress shape +5,
      users-role-guard SUPER_ADMIN +5). Type-check zero. Lint zero

### Sprint 12 — Billing e Self-service (concluído)
- [x] Migration `0014_billing` — Tenant ganha stripeCustomerId/
      stripeSubscriptionId/subscriptionStatus/currentPeriodEnd/
      trialEndsAt + tabela `billing_events` IMUTÁVEL (RLS sem
      UPDATE/DELETE, idempotência via stripe_event_id UNIQUE) +
      tabela `usage_snapshots` com RLS padrão + backfill
      trial_ends_at = created_at + 14d nos tenants TRIAL
- [x] 2 enums: `BillingEventType` (7 tipos), `SubscriptionStatus`
      (TRIALING/ACTIVE/PAST_DUE/CANCELED/INCOMPLETE)
- [x] `stripe-client.ts` — Stripe SDK singleton + `priceIdForPlan` +
      `planFromPriceId` (mapeia STRIPE_PRICE_STARTER/PRO/ENTERPRISE)
- [x] `billing-checkout.service.ts` — `ensureCustomer` (cria/recupera
      Stripe Customer com metadata.tenantId) + `startCheckoutSession`
      (subscription mode + promotion codes + success/cancel URLs) +
      `openCustomerPortal` (URL do Billing Portal)
- [x] `billing-webhook.service.ts` — processa 7 tipos de evento Stripe
      (checkout.session.completed, customer.subscription.*,
      invoice.paid/payment_failed, trial_will_end); idempotente via
      lookup BillingEvent.stripeEventId; `applySubscription`
      atualiza Tenant.plan + status + currentPeriodEnd
- [x] Endpoint `POST /api/stripe/webhook` valida assinatura via
      `Stripe.webhooks.constructEvent` + chama processStripeEvent;
      retorna 503 se Stripe não configurado, 400 sem assinatura,
      500 em erro recuperável (Stripe reenvia)
- [x] `plan-limits.ts` — PLAN_LIMITS por tenant (maxUsers/companies/
      contacts/storageBytes/aiTokensMonth + 6 features booleans);
      Enterprise tem Infinity; hidePoweredBy/overrideWcag só Enterprise
- [x] `usage.service.ts` — `collectCurrentUsage` agrega counts +
      storage (sum sizeBytes de documentVersions) + tokens IA do mês +
      cost convertido para centavos; `takeSnapshot` grava em
      usage_snapshots
- [x] `storage-s3.service.ts` — wrapper @aws-sdk/client-s3 +
      s3-request-presigner; uploadObject + presignDownload (24h);
      retorna null se S3 não configurado (fallback gracioso)
- [x] Privacy workflow agora envia ACCESS/PORTABILITY para S3 com
      key `privacy-exports/<tenantId>/<requestId>.json`; fallback
      inline:base64 mantido. `exportPayload` retorna `{kind:'s3',url}`
      com presigned 24h OU `{kind:'inline',preview}`
- [x] Router tRPC `billing` — status (plano + Stripe status),
      startCheckout (URL de redirect), openPortal, currentUsage
      (com checks vs limites), history (últimos 50 eventos)
- [x] UI `/admin/billing` — card plano atual com status + período +
      trial; 3 cards de planos com features e botão Mudar;
      seção Uso atual com 5 barras (users/companies/contacts/storage/
      tokens) coloridas (verde <80%, âmbar 80–100%, vermelho excedido);
      histórico de eventos
- [x] `TrialExpiryBanner` global no layout — amarelo se trial termina
      em ≤7 dias, vermelho se já expirou ou subscription past_due
- [x] env: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`,
      `STRIPE_PRICE_ENTERPRISE` (todos optional)
- [x] Testes: 207/207 unit (+11 Sprint 12: plan-limits +7,
      stripe-client +4)

### Sprint 11 — Segurança, LGPD e Conformidade (concluído)
- [x] Migration `0013_lgpd_security` — `data_subject_requests` (SLA 15d
      ANPD via dueAt auto-calculado, status PENDING/IN_PROGRESS/
      COMPLETED/REJECTED, processed_by_id, export_file_key), tabela
      `policy_acceptances` IMUTÁVEL (RLS sem policies UPDATE/DELETE),
      tabela `connection_logs` WORM (Marco Civil Art. 15, INSERT/SELECT
      apenas) + 3 enums + RLS padrão para data_subject_requests
- [x] Middleware Next — aplica `SECURITY_HEADERS` em todas as respostas
      (HSTS prod, CSP com frame-ancestors none + object-src none,
      X-Frame-Options DENY, Permissions-Policy camera/mic/geo desligados,
      X-Content-Type-Options nosniff, Referrer-Policy strict-origin)
- [x] **Fechado débito Sprint 1**: middleware propaga `x-real-ip`
      derivado de `x-forwarded-for` em paralelo ao webhook Clerk
- [x] `rate-limiter.service.ts` — sliding window via Redis INCR+EXPIRE,
      fallback open quando Redis indisponível, helpers LOGIN_LIMIT
      (5/15min), PUBLIC_FORM_LIMIT (10/min), API_LIMIT_PER_TENANT (1000/min)
- [x] `CookieBanner` LGPD granular — 4 categorias com STRICTLY_NECESSARY
      sempre on, persiste em localStorage E grava `ConsentLog` no
      backend via `POST /api/v1/consent` (com IP + tenant_id se autenticado)
- [x] `privacy-workflow.service.ts` — `collectPersonalData` agrega
      users/contacts/activities/audit/consent + nota sobre Marco Civil;
      `anonymizeSubject` substitui PII por anon-{base36} preservando
      FKs, scrubba rawText de activities, marca deleted_at em users
      e contacts; logs de conexão preservados
- [x] Endpoint público `POST /api/v1/privacy-request` (com rate limit
      PUBLIC_FORM_LIMIT) + endpoint público `POST /api/v1/consent`
- [x] Router tRPC `privacy` — submitRequest (public), listPending/listAll
      (admin), process (gera export ou anonimiza), reject, exportPayload,
      acceptPolicy, myAcceptedVersions
- [x] UI `/privacy-request` (público, sem auth) + `/admin/privacy` (fila
      com badges de status, indicador ATRASADO em vermelho se dueAt
      vencido, botões Processar e Rejeitar com justificativa)
- [x] `/privacy` + `/terms` páginas estáticas versionadas via
      `POLICY_VERSIONS` + `PolicyAcceptGate` modal forçando aceite
      quando versão atual não consta em `policy_acceptances`
- [x] `.github/dependabot.yml` — npm semanal (grupos prod/dev), GH
      Actions semanal, Docker mensal
- [x] `.github/workflows/security.yml` — npm audit (rompe build em
      vulnerabilidade ≥ high), Semgrep (p/owasp-top-ten + p/typescript
      + p/nextjs com SARIF upload), ZAP baseline scan semanal contra
      STAGING_URL
- [x] **Fechado débito Sprint 2**: fixture E2E em
      `tests/e2e/fixtures/auth.ts` (loginAsAdmin + resetDatabase) +
      bypass `POST /api/e2e/login` ativo APENAS em NODE_ENV=test;
      pipeline-7-stages.spec.ts não mais `test.skip`, agora skip
      condicional na ausência de env vars E2E_TEST_TENANT_ID
- [x] Testes: 196/196 unit (+11 Sprint 11: security-headers +4,
      rate-limiter +4, anonymizer +3). Lint zero. Type-check zero

### Sprint 0 — Foundation (concluído)
- [x] Next.js 14 + TS strict + Tailwind + shadcn/ui
- [x] Schema Prisma 25+ entidades + pgvector + migrations init/RLS/vector
- [x] Prisma extension de tenant + AsyncLocalStorage
- [x] Middleware Clerk + tRPC base + DataMaskingService + RBAC + AuditLog
- [x] Docker, GitHub Actions CI, seed (3 tenants), .env.example

### Sprint 10.5 — White-Label Theming e Identidade Venzo (concluído)
- [x] Migration `0012_tenant_settings_theming` — tabela `tenant_settings`
      1:1 com tenants (theme_config JSONB, powered_by enum, wcag_overrides
      JSONB, theming_enabled bool, RLS) + backfill com defaults Venzo
      (#7C3AED/#3B1F6A/#C084FC/#F5A623/Plus Jakarta Sans) + powered_by
      por plano
- [x] Enum `PoweredByMode` (VISIBLE/SUBTLE/HIDDEN)
- [x] `src/lib/theme/types.ts` — VENZO_DEFAULTS, themeConfigSchema (Zod),
      mapping TenantPlan→VenzoPlan, helpers de capacidade por plano
      (canHidePoweredBy, canUseFreeformHex, canOverrideWcag etc)
- [x] `src/lib/theme/curated-palettes.ts` — 8 paletas Growth harmônicas
      com Venzo
- [x] `src/lib/theme/curated-fonts.ts` — 6 fontes Google (Plus Jakarta
      Sans, Inter, Manrope, DM Sans, Outfit, Public Sans) + googleFontsUrl()
- [x] `wcag-validator.service.ts` — computeContrast (algoritmo WCAG
      relativo de luminância) + TEXT_CONTEXTS (9 contextos com 3 ou 4.5
      conforme tamanho/peso) + validateThemeCombinations combinatorial
      em 8 pontos de uso real (botões, badges, hover, accent)
- [x] `contrast-suggester.service.ts` — sugestão dupla via HSL iteration
      (passos 5%, max 8 cada direção) retornando { darker, lighter,
      unsupported }
- [x] `theme.service.ts` — getThemeConfig (cache Redis 1h TTL),
      updateThemeConfig (enforce plano, WCAG combinatorial, override
      Enterprise com justification ≥30 + DPO, invalida cache, audit
      log com wcag_level)
- [x] `src/lib/feature-flags.ts` — stub Unleash com flag
      `tenant_theming_enabled` default true; substituível em Sprint 12
- [x] Router tRPC `theme`: get, validate, suggestContrastFix,
      listCuratedPalettes, listCuratedFonts, update,
      publishWithOverride (Enterprise), auditHistory, planInfo
- [x] `src/lib/theme/server.ts` — resolveTenantTheme via headers (lê
      x-tenant-id do middleware) + buildBrandStyle injetando 5 vars
      CSS no `<html style>` do RootLayout
- [x] `globals.css` — utilities `.bg-brand`, `.text-brand`, `.border-brand`,
      `.hover:bg-brand-dark`, `.bg-brand-accent` consumindo as vars
- [x] Refactor: botões CTA `bg-neutral-900` → `bg-brand` em pipeline/*,
      imports, e demais CTAs
- [x] `<PoweredByBadge>` three-state (visible 14px centro / subtle 9px
      canto / hidden null) usando `var(--brand-primary)`
- [x] UI `/admin/branding` — tabs Paleta/Tipografia/Logo/Histórico,
      color pickers (Enterprise) ou dropdown (Growth), painel WCAG
      lateral com semáforo, panel sugestão dupla, banner amarelo se
      overrides ativos, modal override com checkbox DPO + textarea ≥30
- [x] Plan enforcement server-side: Starter 403, Growth 422 fora da
      lista, Enterprise hex livre + override permitido. Powered by
      HIDDEN só Enterprise (validado no backend)
- [x] env: UNLEASH_URL, UNLEASH_API_TOKEN, NEXT_PUBLIC_VAPID_*,
      INBOUND_WEBHOOK_SECRET (todos optional)
- [x] Testes: 185/185 unit (wcag-validator +8, contrast-suggester +5,
      theme-plan-matrix +13). Cobertura: pass/fail por contexto,
      sugestão dupla, plano matrix, curadoria

### Sprint 10 — PWA, Mobile e Performance (concluído)
- [x] Migration `0011_push_subscriptions` — tabela com endpoint UNIQUE,
      p256dh + auth keys, userAgent + lastSeenAt; RLS
- [x] `@serwist/next` + `serwist` configurados em `next.config.mjs` com
      `swSrc=src/app/sw.ts` → `swDest=public/sw.js`
- [x] Service worker (`src/app/sw.ts`) com precaching + defaultCache
      (runtime stale-while-revalidate) + handlers `push` e
      `notificationclick` (foca tab existente ou abre)
- [x] `public/manifest.json` — standalone, theme-color #0a0a0a, ícones
      192/512/SVG, shortcuts Pipeline e Dashboard
- [x] `src/app/icon.tsx` + `apple-icon.tsx` — geração via ImageResponse
      (Next 14 metadata route, gera PNG no edge)
- [x] `layout.tsx` — metadata completo (applicationName, manifest,
      appleWebApp, formatDetection.telephone=false) + viewport
      (themeColor, maximumScale, viewportFit=cover)
- [x] `BottomNav` componente fixed bottom, 5 ítens (Pipeline, Inbox,
      Search, Dashboard, Mais), visível só em < 768px, touch ≥ 48px,
      respeita safe-area-inset, esconde nas rotas /sign-in /onboarding /p/
- [x] Página `/more` com índice de todas as outras rotas (substitui
      menu lateral em mobile)
- [x] `push-sender.service.ts` — wrapper web-push com VAPID, marca
      subscription como deleted em 404/410, helpers `sendPushToUser` e
      `sendPushForAlertRecipient`
- [x] Router `push` (config + subscribe + unsubscribe + mySubscriptions)
- [x] `EnablePushButton` no `/dashboard` — pede permissão, subscribe
      no PushManager, salva no servidor; esconde se não suportado ou
      VAPID não configurado
- [x] Worker `email-send` envia push em paralelo ao e-mail (best-effort,
      não falha o e-mail se push falhar)
- [x] env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
      `VAPID_SUBJECT` (todos opcionais — sem VAPID, push fica desabilitado)
- [x] Testes: 148/148 unit (manifest +4, push-subscription +5)
- [ ] Lighthouse audit — pendente porque requer app rodando contra
      Postgres/Clerk reais; rodar `npx lighthouse http://localhost:3000`
      depois do setup paralelo concluir

### Sprint 9 — Importação de Dados (concluído)
- [x] Migration `0010_import_jobs` — tabela `import_jobs` (bytea de até
      10MB, mapping/preview/result JSON, status PENDING/PARSING/MAPPED/
      RUNNING/DONE/FAILED, strategy IGNORE/UPDATE/CREATE) + 3 enums + RLS
- [x] `parser.ts` — unifica CSV (papaparse) e XLSX (exceljs), com modo
      previewOnly (10 linhas) ou completo; detecta extensão `.csv/.tsv/.xlsx/.xls`
- [x] `import-engine.service.ts` — engines `importCompanies` e
      `importContacts` com validação por linha (CNPJ/email Zod), dedup
      por CNPJ ou email, política IGNORE/UPDATE/CREATE; estrutura
      preparada pra `OPPORTUNITY` e `USER` (TODO sprint posterior)
- [x] Resolução automática de empresa em contatos via `companyCnpj` ou
      `companyRazaoSocial` (case-insensitive)
- [x] Endpoint `POST /api/v1/imports/upload` (multipart, máx 10MB) gera
      preview inline e persiste bytes
- [x] Router tRPC `imports` (fields/list/byId/confirm/cancel) — `confirm`
      enfileira no worker BullMQ
- [x] Worker `import-run` integrado ao `npm run worker` — re-parseia
      arquivo, executa engine, atualiza `processedRows` a cada 50 linhas,
      grava `resultJson`, envia e-mail de conclusão ao criador
- [x] UI `/imports` — wizard 3 passos (upload → mapping com dropdowns +
      preview 10 linhas → confirmar com estratégia de dedup) + histórico
      com auto-refresh 3s e badges de status
- [x] `IMPORT_FIELDS` mapping para COMPANY (10 campos) e CONTACT (6 campos)
- [x] Testes: 139/139 unit (import-parser +5: CSV/TSV/preview/extensão inválida)

### Sprint 8 — Propostas, Aprovações e Contratos (concluído)
- [x] Migration `0009_contract_handoff_renewal`: `Tenant.handoffEmails`
      String[] + `Tenant.contractRenewalLeadDays` Int[] (default 90/60/30)
- [x] **Débito Sprint 2 fechado**: `PROPOSTA → NEGOCIACAO` exige ≥ 1
      `ProposalVersion`; `NEGOCIACAO → ACEITE` exige zero approvals em
      PENDING/REJECTED/CHANGES_REQUESTED da última versão
- [x] `approval-engine.service.ts` — função pura `selectApplicableRules`
      (UNIVERSAL / MIN_MARGIN_BELOW / TOTAL_VALUE_ABOVE) +
      `createApprovalsForProposalVersion` (idempotente, busca aprovador
      por role) + `getApprovalState`
- [x] Router `proposals` (listByOpportunity, create, addVersion com
      trigger automático do engine, compareVersions com diff metadata
      + IA Haiku, approvalState) + `approvals` (myPending, decide)
- [x] `contract-handoff.service.ts` — ao Contract.status virar ACTIVE,
      envia e-mail a `handoffEmails` + `centralCrmEmail` com CNPJ +
      parcelas + valores; idempotente via Activity SYSTEM_EVENT
- [x] `contract-renewal-alerts.service.ts` — integrado ao worker
      `alerts-scan`; gera AlertLog PIPELINE_DATE para contratos com
      endDate em `tenant.contractRenewalLeadDays`
- [x] `contract-renewal.service.ts` — `renewContract` cria nova
      Opportunity em PROSPECT pré-preenchida + marca contrato como RENEWED
- [x] Router `approvalRules` (CRUD admin) + `contractsConfig`
      (getConfig/updateConfig/renew/dispatchHandoff/activeContracts)
- [x] Handoff disparado automaticamente em `contracts.update` quando
      status muda para ACTIVE
- [x] UI `ProposalsSection` na `/pipeline/[id]` — criar proposta + adicionar
      versão com totalValue/marginPct + badges de status de aprovação
- [x] UI `/approvals` — fila do aprovador logado com botões Aprovar /
      Solicitar mudanças / Reprovar + comentário
- [x] UI `/contracts` — contratos ativos com Renovar + Reenviar handoff
- [x] UI `/admin/approval-rules` — CRUD de regras com critério + threshold
      + checkboxes de aprovadores
- [x] UI `/admin/contracts` — handoffEmails (chips) + renewalLeadDays
- [x] Testes: 134/134 unit (approval-engine +8: universal, margin-below,
      value-above, disabled, múltiplas regras simultâneas)

### Sprint 7 — Parceiros e Documentos (concluído)
- [x] Migration `0008_partners_documents`: `User.partnerCompanyId` (FK SET
      NULL), enum `DocumentCategory`, `Document.category`, tabela
      `document_templates` com RLS
- [x] **Débito Sprint 2 resolvido**: visibilidade real do perfil PARCEIRO
      em `opportunities` e `reports` (PARCEIRO vê apenas oportunidades onde
      `partnerCompanyId = User.partnerCompanyId` E existe `PartnerEngagement`
      com status APPROVED). Context tRPC agora carrega `partnerCompanyId`
- [x] **Débito Sprint 2 resolvido**: validação ACEITE → CONTRATO exige
      Document `category=ACEITE_CLIENTE` vinculado à oportunidade
- [x] Router `partners`: listWithStats (oportunidades + comissão acumulada),
      getTcText, updatePartnerConfig (commission, T&C text/versão),
      linkUserToPartner, registerTcAcceptance, publicTcView/publicTcAccept
      via token de `partner_links` (sem auth)
- [x] Router `documents`: listByOpportunity, create (+v1), addVersion
      (dedup por SHA-256), compare (mock IA)
- [x] Router `templates`: list/create/uploadVersion/setActive por categoria
- [x] `document-compare.service.ts` — Haiku gera JSON estruturado
      (scopeChanges, valueChange, marginChange, items+/-, termChanges) com
      DataMasking + circuit breaker + fallback metadata
- [x] UI `/admin/partners` — lista com stats + form de config inline
      (commission, T&C, ativo) + usuários parceiros vinculados
- [x] UI `/admin/templates` — biblioteca agrupada por categoria + form
      de adicionar
- [x] UI `/p/tc/[token]` — aceite público de T&C com token de partnerLink;
      registra IP+UA em `partner_tc_acceptances`
- [x] UI `DocumentsSection` no `/pipeline/[id]` — upload (URL),
      versionamento visual, link p/ abrir cada versão
- [x] Sprint 7 NÃO implementa upload binário (S3); usa `storageKey` como
      URL externa. Sprint 11 endurece com presigned URLs
- [x] Testes: 126/126 unit (document-compare +3: emptyResult, circuit
      breaker open/close)

### Sprint 6 — Comunicações, Busca e E-mail (concluído)
- [x] Migration `0007_inbound_email_search` — `Tenant.inboundEmailSlug`
      (citext unique), tabela `incoming_emails` (raw payload + status
      PENDING/LINKED/REJECTED + dados de vínculo), índices GIN tsvector
      PT-BR em `activities` e `incoming_emails` para fallback de busca
- [x] `inbound-email.service.ts` — ingestão de payload com normalizadores
      `fromPostmark` e `fromResend`, extração de slug por
      `extractSlugFromAddresses`
- [x] Endpoint `POST /api/v1/inbound/email` aceita Postmark/Resend/
      genérico com proteção via `?secret=` (INBOUND_WEBHOOK_SECRET)
- [x] `email-link.service.ts` — 3 heurísticas em ordem:
      `#<oppId>` no subject (conf 1.0) > match por contato (conf 0.85 se
      unique, senão sugestões) > Claude Haiku rank das top oportunidades
      ativas. Cria Activity tipo EMAIL automática quando conf ≥ 0.8
- [x] `embeddings.service.ts` — opcional via OpenAI text-embedding-3-small;
      grava em `embeddings` (pgvector) com dedup por contentHash SHA-256
- [x] `semantic-search.service.ts` — pipeline candidate retrieval →
      hydrate → rerank Haiku. Cai para tsvector PT-BR sem OPENAI_API_KEY
- [x] Routers tRPC: `inbox` (list/byId/retryAutoLink/linkManually/reject),
      `search` (natural com rerank opcional), `adminEmail` (getSlug/setSlug/
      regenerateSlug)
- [x] UI `/inbox` — lista expansível com sugestões + vincular manual +
      rejeitar + retry IA
- [x] UI `/search` — busca natural com indicador de modo (vector/tsvector)
      e reranqueamento + exemplos
- [x] UI `/admin/email-inbound` — endereço completo + copiar + regenerar
      + instruções de uso (#ID no subject)
- [x] env: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`,
      `INBOUND_WEBHOOK_SECRET` (todos optional)
- [x] Testes: 123/123 unit (inbound-email +9: slug parser, #ID parser,
      normalizadores Postmark/Resend)

### Sprint 5 — Relatórios, Analytics e Equipe (concluído)
- [x] Migration `0006_conversion_rates` — `Tenant.conversionRates JSONB`
      com defaults B2B (5/15/30/50/70/85/100)
- [x] `analytics.service.ts` — funções puras: `computeFunnel`,
      `avgDaysPerStage`, `winLossBreakdown`, `performanceByOwner`,
      `projectRevenue` (cenários base/best/worst)
- [x] `conversion-rate-suggestion.service.ts` — sugere taxas via
      histórico próprio (≥30 fechadas) OU IA com contexto de segmento/
      território (Claude Haiku com masking). Retorna source/rationale/rates
- [x] Router tRPC `reports`: funnel, winLoss, timePerStage,
      performanceByOwner (ANALISTA vê apenas própria linha + média
      anônima), revenueProjection, conversionRates (get/update),
      suggestConversionRates. Filtros dinâmicos: from/to/ownerId/stage/
      segmentId/territoryId. Visibilidade por perfil aplicada
- [x] `excel-export.service.ts` + endpoint `GET /api/v1/reports/export`
      gera xlsx com abas Resumo/Funil/Performance/Projeção via exceljs
- [x] UI `/reports` — filtros + funil SVG inline (sem libs) + stats
      (projeção base/best/worst, win rate, valor ganho) + tabela
      performance + motivos de perda + projeção por estágio + botão
      Exportar Excel
- [x] UI `/admin/conversion-rates` — edição inline + botão "Sugerir
      com IA" com modal de preview (atual vs sugerida) + aceitar/descartar
- [x] Testes: 114/114 unit (analytics +9, incluindo funil, win rate,
      projeção com cap 100%, performance, avgDaysPerStage)

### Sprint 4 — Atividades, Tarefas e IA (concluído)
- [x] `DataMaskingService` estendido: PESSOA (nomes PT-BR com conectores),
      EMPRESA (sufixo societário Ltda/S/A/EIRELI/Inc), VALOR (R$ N | N
      milhões de reais), ENDERECO (logradouro + número), além de EMAIL/
      PHONE/CPF/CNPJ. Inclui blacklist de falsos positivos comuns
      (São Paulo, Brasil, CNPJ, etc.) e método `audit()` para métricas
- [x] `CircuitBreaker` reusável em `src/server/services/ai-circuit-breaker.ts`
- [x] `summarizeCommunication`: mascara → Claude Haiku → parse JSON → desmascara
      → loga `ai_usage_log` com tokens + custo. Fallback gracioso se IA falhar
- [x] `ai-usage.service.ts` com `AI_PRICING` table (Anthropic, OpenAI),
      `calculateCost`, `logAiUsage`, `getMonthlyUsage`
- [x] Routers tRPC: `activities` (list, create, summarize, confirmSummary),
      `tasks` (list, myOpen, create, updateStatus), `aiConfig`
      (getConfig, updateConfig com encryption, monthlyUsage, pricingTable)
- [x] Encriptação AES-256-GCM para `tenant.ai_api_key_encrypted` em
      `src/lib/crypto/field-encryption.ts` (encryptField/decryptField/maskApiKey)
- [x] Worker scan diário agora também roda `scanTaskEscalations` — cobrança
      no vencimento (TASK_DUE) + escalonamento após `tenant.taskOverdueDays`
      (TASK_OVERDUE) para GESTOR/DIRETOR_COMERCIAL
- [x] Template de e-mail `renderTaskAlert` com badge [Escalonamento]
- [x] UI `CommunicationIntake` no `/pipeline/[id]`: textarea → resumir →
      preview com 4 blocos editáveis + checkboxes de tarefas sugeridas
- [x] Seções "Tarefas" e "Linha do tempo" no `/pipeline/[id]`
- [x] Tela `/admin/ai` para configurar provider/modelo/API key + medidor
      de consumo mensal com breakdown por modelo
- [x] Testes: 103/103 unit (masking PII +9, summary-parser +4, field-encryption +4)

### Sprint 3 — Sistema de Alertas (concluído)
- [x] `alert-generator.service.ts` — gera alertas devidos para HOJE por
      tenant; suporta datas recorrentes (ano sentinela 0001) e únicas;
      antecedência via `tenant.alertLeadDays`; resolve destinatário
      (owner da última opp da company; fallback ADMIN)
- [x] `email-sender.service.ts` — wrapper Resend com circuit breaker
      (3 falhas em 60s → aberto por 5min); dry-run quando RESEND_API_KEY
      ausente
- [x] Templates de e-mail em `src/lib/email/templates.ts`
      (relationship + pipeline)
- [x] BullMQ: `src/jobs/queues.ts`, workers `alerts-scan` e `email-send`,
      entry point `src/jobs/index.ts` com job recorrente diário 07:00 BRT
- [x] Router tRPC `alerts`: myAlerts (com window de N dias), tenantConfig,
      updateConfig (admin), dismiss
- [x] `/dashboard` com Central de Alertas (Relacionamento + Pipeline) com
      indicador de urgência + ações Abrir/Dispensar
- [x] `/admin/alerts` com edição de `alertLeadDays`, `centralCrmEmail`,
      `taskOverdueDays`
- [x] Worker no docker-compose (serviço `worker`) + script `npm run worker`
      + `npm run worker:scan-now` para disparar scan manual
- [x] Testes: 85/85 unit (alert-generator +10, email-templates +3)

### Sprint 2 — Pipeline Comercial (concluído)
- [x] Migration `0005_opportunity_stage_fields` — campos por estágio
      (meetingScheduledAt/Happened, briefing, proposalPresentedAt,
      decisionExpectedAt, estimatedTeamNotes, acceptedAt,
      acceptanceNotificationSentAt, handoffReportGeneratedAt,
      currentStageEnteredAt)
- [x] Service `opportunity-stage.service.ts` com `STAGE_EXIT_REQUIREMENTS`,
      `validateStageExit`, `isValidTransition` (avança 1 ou retrocede livre),
      `advanceStage` (transação + histórico + audit), `cancelOpportunity`
- [x] Routers tRPC: `opportunities` (com kanban, byId, advance, cancel, team),
      `partnerEngagements` (request → decide aprovar/rejeitar, revoke),
      `contracts` + `contracts.installments`
- [x] Visibilidade por perfil aplicada em queries (ANALISTA só vê próprias +
      onde é team member; DIRETOR/GESTOR vê tudo)
- [x] UI desktop Kanban com @dnd-kit (drag-and-drop entre colunas, validação
      no servidor dispara modal "Não foi possível avançar")
- [x] UI mobile com tabs horizontais por estágio + botão Avançar →
- [x] Cards mostram avatar + nome do responsável (não só iniciais)
- [x] Indicador de urgência baseado em `expectedCloseDate` (verde >7d, amarelo
      2-7d, vermelho <2d) ou em dias no estágio quando não há data prevista
- [x] Página `/pipeline/[id]` com header, ações (avançar/voltar/cancelar),
      formulário inline dos campos do estágio atual, histórico
- [x] Modal de cancelamento com motivo + lossReason (soft delete via status)
- [x] Testes: 72/72 unit (validators 39, rbac 9, masking 5, tenant-context 3,
      company-validator 6, stage-transition 10)
- [x] E2E spec `pipeline-7-stages.spec.ts` (skipped até CI ter banco seeded
      + auth fixture)

### Sprint 1 — Auth + Cadastros (concluído)
- [x] Migration `0004_sprint1_additions` com refinos (WorkArea, DIRETOR_*, CNAE,
      commissionPct, Contact.workArea/relationshipType/function, Product.type novo,
      Opportunity.contactId/source/lossReason, ContractStatus.RENEWED, ApprovalRule,
      ConsentLog)
- [x] Validators Zod compartilhados (`src/lib/validators/`): CNPJ, CPF, email,
      telefone BR, datas PT-BR
- [x] Webhook Clerk com verificação svix (`/api/clerk/webhook`):
      user.created/updated/deleted + session.created → access log
- [x] Onboarding Super Admin (`/onboarding`): cria Tenant + Company OWN + ADMIN
- [x] CRUDs tRPC: territories, segments, companies, contacts (com auto-cadastro
      público em `/p/[tenantSlug]/contact`), products, users (com convite Clerk)
- [x] Páginas mínimas: `/companies`, `/onboarding`, `/p/[slug]/contact`
- [x] Middlewares tRPC `withRoles` + `withCapability` + `adminOnlyProcedure`
- [x] `audit()` chamada nos pontos sensíveis dos CRUDs
- [x] User access log via webhook session.created
- [x] Testes: 62/62 passando (rbac, masking, tenant-context, validators, company);
      integração de isolamento gated por `DATABASE_URL_TEST` (skip local)
- [x] E2E smoke (Playwright): home, health endpoint, /p/.../contact form

---

## Configuração necessária para rodar (pós-Sprint 1)

1. **Clerk** — criar aplicação em https://dashboard.clerk.com com:
   - OAuth providers: Google, Microsoft
   - Email + Magic Link, TOTP 2FA habilitados
   - **JWT Template** com nome `default`, claim:
     ```json
     {
       "public": {
         "tenantId": "{{user.public_metadata.tenantId}}",
         "role": "{{user.public_metadata.role}}"
       }
     }
     ```
   - **Webhook** apontando para `https://seu-dominio/api/clerk/webhook` com
     events: `user.created`, `user.updated`, `user.deleted`, `session.created`.
     Copiar Signing Secret para `CLERK_WEBHOOK_SECRET`.

2. **Postgres** com extensões `vector`, `pgcrypto`, `citext` (já no
   `pgvector/pgvector:pg16` do docker-compose).

3. **Variáveis** preencher em `.env.local` (ver `.env.example`).

---

## Stack (não negociável)

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 App Router + Tailwind CSS + shadcn/ui |
| API interna | tRPC (type-safe, Next.js ↔ frontend) |
| API pública | REST + OpenAPI 3.0 (endpoints `/api/v1/`) |
| Banco | PostgreSQL + Prisma + Row Level Security (Neon serverless em prod) |
| Autenticação | Clerk (Google OAuth, Microsoft OAuth, magic link, TOTP 2FA) |
| Filas/Jobs | BullMQ + Redis |
| Email | Resend |
| Storage | AWS S3 / Cloudflare R2 |
| Billing | Stripe |
| WAF/CDN | Cloudflare |
| Feature flags | Unleash (self-hosted) |
| IA principal | Anthropic SDK (Claude Haiku + Sonnet) |
| IA benchmarks | Perplexity API (fallback: Gemini, OpenAI) |
| Vector search | pgvector (extensão PostgreSQL) |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Observabilidade | Sentry + Axiom |
| Testes | Vitest (unit) + Supertest (integration) + Playwright (E2E) |

---

## Regras de Arquitetura — OBRIGATÓRIAS

1. **Multi-tenancy**: TODA query de banco inclui `WHERE tenant_id = ?` — sem exceção. A Prisma extension em `src/server/db/client.ts` injeta isso automaticamente desde que o handler esteja envolto em `runWithTenant()`. RLS no PostgreSQL como segunda linha de defesa.

2. **Validação**: TODA entrada de usuário é validada com **Zod no servidor**. Nunca confiar apenas na validação do frontend.

3. **Secrets**: ZERO hardcode de credenciais. Somente variáveis de ambiente, parseadas e validadas em `src/lib/env.ts` (Zod). Usar `.env.local` no dev (nunca commitar).

4. **Soft delete**: Campo `deleted_at` em todas as entidades. Nenhum registro é deletado permanentemente em operações normais. Exceção: rota `/api/v1/gdpr/erase` para anonimização LGPD.

5. **Data Masking para IA**: NUNCA enviar PII (nomes, e-mails, CPF/CNPJ, telefones) diretamente a providers de IA. Passar pelo `DataMaskingService` (`src/lib/ai/masking.ts`) que tokeniza e destokeniza automaticamente.

6. **Mobile-first**: Breakpoint base 375px. Bottom navigation bar em mobile. Tables → cards empilhados em viewport < 768px. Touch targets ≥ 44×44px.

7. **Audit log**: Toda ação sensível registrada em `audit_logs` via `audit()` em `src/server/services/audit.service.ts`.

8. **RBAC**: Todo endpoint tRPC/REST com middleware de auth (Clerk) + tenant + role. Roles: `SUPER_ADMIN | ADMIN | DIRETOR | GESTOR | ANALISTA | PARCEIRO`. Matriz em `src/lib/auth/rbac.ts`.

---

## Estrutura de Pastas

```
/
├── CLAUDE.md                    ← este arquivo
├── docs/
│   └── CRM_Especificacao_e_Implementacao.docx
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── api/
│   │   │   ├── trpc/[trpc]/    ← tRPC HTTP adapter
│   │   │   └── v1/             ← REST endpoints públicos
│   │   ├── layout.tsx          ← ClerkProvider + tema shadcn
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui base (button, etc.)
│   │   └── modules/            ← componentes por módulo (pipeline/, contacts/, …)
│   ├── server/
│   │   ├── trpc/
│   │   │   ├── routers/        ← um arquivo por módulo
│   │   │   ├── context.ts      ← extrai tenantId + user dos headers
│   │   │   └── trpc.ts         ← initTRPC + middlewares
│   │   ├── services/           ← lógica de negócio (audit, etc.)
│   │   ├── db/
│   │   │   ├── client.ts       ← Prisma + tenant extension
│   │   │   ├── tenant-context.ts ← AsyncLocalStorage helpers
│   │   │   └── repositories/
│   │   └── api/v1/             ← handlers REST OpenAPI
│   ├── lib/
│   │   ├── validators/         ← schemas Zod compartilhados
│   │   ├── ai/
│   │   │   ├── masking.ts      ← DataMaskingService (tokenização PII)
│   │   │   └── claude.ts       ← wrapper Anthropic SDK
│   │   ├── auth/
│   │   │   └── rbac.ts         ← matriz de permissões
│   │   ├── utils/cn.ts         ← cn() helper shadcn
│   │   └── env.ts              ← variáveis validadas com Zod
│   ├── jobs/                   ← BullMQ workers (sprint 3+)
│   └── middleware.ts           ← Next.js middleware (Clerk + tenant)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                 ← 3 tenants com massa em PT-BR
│   └── migrations/
│       ├── 0001_init/
│       ├── 0002_rls/
│       └── 0003_vector_indexes/
├── tests/
│   ├── unit/                   ← Vitest
│   ├── integration/            ← Supertest
│   ├── e2e/                    ← Playwright
│   └── setup.ts
├── docker-compose.yml
├── Dockerfile
└── .github/workflows/ci.yml
```

---

## Multi-tenancy — fluxo de uma requisição autenticada

```
Request HTTP
   ↓
Clerk middleware (src/middleware.ts)
   ↓  extrai sessionClaims.public.tenantId → header x-tenant-id
   ↓
Route handler (app/api/trpc/[trpc]/route.ts)
   ↓  runWithTenant({tenantId, userId, role}, async () => ...)
   ↓
tRPC procedure
   ↓
Prisma query
   ↓  $extends.query.$allOperations injeta {where: {..., tenantId}} ou
   ↓  {data: {tenantId, ...}} automaticamente
   ↓
PostgreSQL
   ↓  RLS policies (current_tenant_id()) bloqueiam vazamento mesmo se a injeção falhar
```

A camada Prisma + RLS é defesa em profundidade: ambas precisam ser bypassadas para haver vazamento de tenant.

---

## DataMaskingService — uso obrigatório antes de IA

```typescript
import { masking } from '@/lib/ai/masking';
import { getAnthropic, MODELS } from '@/lib/ai/claude';

const { masked, map } = masking.mask(userText);
const completion = await getAnthropic().messages.create({
  model: MODELS.HAIKU,
  max_tokens: 1024,
  messages: [{ role: 'user', content: masked }],
});
const safe = masking.unmask(extractText(completion), map);
```

**Nunca passe `userText` diretamente para um provider de IA.**

---

## Convenções de Código

- TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride`
- Nomenclatura: `camelCase` variáveis, `PascalCase` componentes/types, `snake_case` banco (mapeado via `@@map` / `@map`)
- Imports: absolute paths via `@/` alias
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
- Cada novo módulo: router tRPC + service + testes unitários mínimos
- Nada de comentários narrativos; explicar apenas o "porquê" não óbvio

---

## Comandos úteis

```bash
# dev
npm run dev                     # Next.js em http://localhost:3000
docker compose up -d postgres redis

# banco
npx prisma migrate dev          # cria nova migration interativamente
npx prisma migrate deploy       # aplica todas em prod/CI
npm run db:seed                 # popula 3 tenants
npm run db:reset                # reset + migrate + seed
npx prisma studio               # GUI do banco

# qualidade
npm run lint
npm run type-check
npm run test                    # Vitest
npm run test:watch
npm run test:coverage
npm run test:e2e                # Playwright

# build
npm run build
```

---

## Ordem de Implementação

Seguir rigorosamente o Plano de Sprints da **PARTE II, Seção 4** do documento de especificação.

**Nunca pular sprints ou implementar módulos fora de ordem** — cada sprint depende da fundação do anterior.

Sprint atual: **verificar no topo deste arquivo qual sprint está em andamento.**

---

## Deploy staging (Vercel)

Guia completo em `docs/DEPLOY_Vercel_Guide.md`. Config commitada:
`vercel.json` (region `gru1`, `maxDuration` estendido para tRPC/IA/upload)
+ `scripts/setup-vercel-env.sh` (imprime a lista de `vercel env add`
na ordem correta, sem ler `.env.local`).

Fluxo resumido pra Fred rodar (~20min):

1. Criar Neon branch `staging` + rodar `prisma migrate deploy` e
   `npm run rbac:backfill-cache` contra a nova connection string
2. (Opcional) Upstash Redis grátis pra workers BullMQ
3. `vercel login && vercel link && vercel`
4. Colar as vars imprimidas por `bash scripts/setup-vercel-env.sh`
5. Adicionar o domínio Vercel no Clerk (Domains + Webhook endpoint)
6. `vercel --prod` e smoke test

⚠️ `RBAC_GRANULAR_ENABLED=false` no 1º deploy até smoke test passar;
ligar depois de confirmar backfill do cache. Nunca reusar
`TENANT_FIELD_ENCRYPTION_KEY` do dev em staging (chaves criptografadas
ficam isoladas por ambiente).

---

## Observabilidade

Sentry (error tracking) + Axiom (structured logs) já wireados —
ver `docs/Observability.md` pra setup completo, categorias de log,
dashboards e runbook. Ambos SDKs viram **no-op silencioso** quando
os env vars correspondentes não estão setados (dev local sem
tokens funciona igual).

Hooks: `audit()` (breadcrumb + log), `logAiUsage()` (custo BRL +
provider + fallback), `makeWorker()` (duração + erro), middleware
tRPC `monitor` (procedure + tenantId + errorCode). PII **nunca**
sai do processo — payloads de mutation e prompts IA não vão para
Sentry/Axiom.

---

## Checklist antes de cada deploy (PR → staging)

- [ ] `npm run test` passa
- [ ] `npm run type-check` passa
- [ ] `npm run lint` passa
- [ ] Job `multi-tenancy-guard` no CI passa (sem queries Prisma fora dos pontos de controle)
- [ ] Nenhum secret hardcoded (revisar diff)
- [ ] Schema Prisma migrado em staging (`npx prisma migrate deploy`)
- [ ] Seed executado (se for novo tenant)
- [ ] `GET /api/v1/health` retorna `{status: "ok", checks: {db: "ok"}}`
- [ ] Nenhum `console.log` com PII ou tokens
