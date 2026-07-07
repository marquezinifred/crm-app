# Backlog Pós-MVP — CRM B2B Venzo

Estado: MVP completo (Sprints 0–14.5), 262 testes passando, 0 débitos
abertos formalmente no CLAUDE.md. **Mas há débitos identificados em
uso real** e roadmap estratégico que não cabe num único sprint.

Esse doc consolida tudo o que ficou na bagagem após os 15 sprints e
serve de fonte da verdade pra próximos planejamentos.

Mantido em sincronia com `CLAUDE.md` e memory `MEMORY.md`.

---

## 🔥 Pendências de curto prazo (próximas 2 semanas)

### P-68. `.text-caption.text-text-3` no header público reprova WCAG AA
**Severidade:** Baixa (a11y). Descoberto pelo QA automation pós-bloco
H+I em 2026-07-05.

`axe-smoke.spec.ts` reporta 5 falhas de color-contrast em
`p:CRM B2B` (header público sign-in). NÃO é regressão dos 9 chips —
diff não toca sign-in, `.text-caption`, `.text-text-3` nem `globals.css`.
Pré-existente ao P-52 (axe iframe exclude).

**Fix:** avaliar contraste do token `--text-text-3` sobre bg da rota
pública e trocar por `--text-text-2` OU escurecer o background.

**Esforço:** ~30min.

### P-69. CookieBanner sem teste de componente (0% coverage)
**Severidade:** Baixa (débito arquitetural). Descoberto pelo QA
automation pós-bloco H+I em 2026-07-05.

P-55 fixou contraste mas não tem teste de componente cobrindo
CookieBanner. Testing Library harness já existe (P-53) — extender pra
cobrir consumer categories, dispensar via botão, persistência
localStorage.

**Esforço:** ~2h.

### P-70. Rate-limit por sender inbound NÃO tem bypass em `forcePromoted`
**Severidade:** 🟡 Média (decisão de produto). Descoberto pelo QA
automation pós-bloco H+I em 2026-07-05.

P-29 (rate limit sender) roda ANTES do check de `forcePromoted`
(P-30 promote manual). Consequência: admin tenta promover lead
rejeitado por rate limit → cai no gate de rate limit outra vez.

**Fix escopo (2 caminhos):**
- **A**: `createInboundLead({forcePromoted: true})` bypassa rate
  limit (admin já aprovou manualmente)
- **B**: manter — admin não bypassa rate limit (decisão de
  compliance — evita re-aceitar spam)

Consultar PO antes de implementar.

**Esforço:** ~30min investigação + fix.

### P-71. Metodologia §5.2 baseline stale
**Severidade:** Baixa (só doc). Descoberto pelo QA automation
pós-bloco H+I em 2026-07-05.

§5.2 ainda cita "715 passing / 0 failing / 168 skipped". Real
com env dummy consistente é **927 / 0 / 174**.

**Fix:** atualizar §5.2 e nota de variância (777 do bloco G intermediário,
816 do bloco G final, 927 do bloco H+I atual).

**Esforço:** ~15min inline.

### P-72. `permissions.service.ts` funcs 25%
**Severidade:** Baixa (débito de cobertura). Descoberto pelo QA
automation pós-bloco H+I em 2026-07-05.

Helpers como `computeAndCacheUserPermissions`,
`invalidateUserPermissionsCache`, `computeEffectivePermissions` só
são exercitados em suites gated por `DATABASE_URL_TEST`. Testes
unit puros sem DB cobrem hoje ~25% das funcs.

**Fix:** testes unit adicionais com prisma mocked cobrindo lógica
sem DB (Set intersect, override apply/revoke, cache hit/miss
simulado).

**Esforço:** ~3h.

### P-77. Approvals órfãs quando role/rule/estrutura muda
**Severidade:** 🟡 Média (bug arquitetural — descompasso RBAC dinâmico ×
Approvals snapshot). Descoberto durante diagnóstico P-67 em 2026-07-06.

**Anatomia:**
- `approval-engine.service.ts:159-170` (legado com `approver_roles`)
  faz `findFirst({ where: { tenantId, role, active } })` → escolhe 1
  user por role e persiste `approverId` fixo no momento da criação.
- `approval-engine.service.ts:142-157` (novo com `approver_permission`)
  faz `findMany({ cached_permissions has 'X' })` → snapshot do cache
  daquele momento.
- **Nenhum dos dois re-avalia** quando (a) role do approver muda,
  (b) rule é editada, (c) user é desativado, (d) **Sprint 15G** — user
  é movido de unidade organizacional.

**Sintoma real (P-67):** tenant `acme-tech` tem 4 approvals PENDING
apontando pra della.block36 (ANALISTA) e marquise_ritchie68 (GESTOR),
mas as 2 rules ativas apontam pra `{DIRETOR_COMERCIAL, DIRETOR_FINANCEIRO}`
e `{DIRETOR_COMERCIAL}`. `/approvals` do Fred hotmail (DIRETOR_COMERCIAL)
mostra vazio porque nenhuma approval aponta pra ele.

**Cenário confirmado:** audit log de `approval_rules` vazio — rules
nunca foram editadas via UI. Provável: seed antigo criou approvals
com roles diferentes das rules atuais (histórico de merges/reseeds).

**Fix arquitetural — 2 caminhos possíveis (decidir na spec):**
1. **Worker daily reconcile**: pra cada Approval PENDING, checa se
   `approver.role` ainda satisfaz a rule original. Se não, marca
   `Approval.status = ORPHANED` + notifica admin + tenta re-atribuir
   pelo engine com a rule + roles atuais.
2. **Approval passa a persistir `applicable_rule_id`** + `matched_criteria`
   → quando `approval_rule.update` é chamado, worker re-executa
   `createApprovalsForProposalVersion` só pras PENDING afetadas.

**Fix imediato pro caso do acme-tech:** rejeitar as 4 fósseis via UI
logando como della.block36 e marquise_ritchie68 (mantém audit trail).
Fred confirmou preferência por esse caminho em 2026-07-06.

**Interseção com Sprint 15G:** quando 15G entrar, structure moves vão
gerar exatamente o mesmo problema. Spec 15G Amendment A6 documenta
isso e sugere Sprint 15H absorver P-77.

**Esforço:** ~2-3 dias (spec + implementação + testes).

### P-65. `estimatedValue` da oportunidade não sincroniza com valor da proposta
**Severidade:** 🟡 Média (UX crítico — desalinha forecast + relatórios).
Descoberto em uso 2026-07-05 pelo Fred:
"valor da oportunidade nao atualiza quando colocarmos o valor da
proposta, deveria atualizar".

**Anatomia esperada:**
- `ProposalVersion.totalValue` (Sprint 8) é o valor real negociado
- `Opportunity.estimatedValue` é preenchido no create do lead, raramente
  atualizado
- Hoje NÃO existe sync automático entre os dois
- Forecast (`reports.revenueProjection`), Kanban (soma por coluna) e
  relatórios usam `Opportunity.estimatedValue` — desalinhado

**Fix escopo:**
- Quando `proposals.addVersion` cria nova `ProposalVersion`, atualizar
  `opportunity.estimatedValue = latestVersion.totalValue` na mesma
  transação
- Considerar preservar `estimatedValue` original em novo campo
  `Opportunity.initialEstimatedValue` pra métrica "quanto mudou do
  lead até proposta" (nice-to-have; escopo P-65 base pode pular)
- Testes:
  - `addVersion` atualiza `estimatedValue` corretamente
  - Cross-tenant: version de Tenant A não afeta opp Tenant B
  - Se `totalValue = null` na version, `estimatedValue` fica intacto
- Verificação visual: adicionar version com `totalValue=500000` →
  Kanban da coluna PROPOSTA mostra R$ 500.000 imediatamente

**Onde tocar:**
- `src/server/trpc/routers/proposals.ts` — procedure `addVersion` (~linha 100)
- Testes em `tests/unit/proposals-router.test.ts` (se existir) ou novo
- Kanban `src/app/pipeline/page.tsx` — validar via query se `estimatedValue`
  reflete

**Esforço:** ~2h.

### P-66. Transição PROPOSTA→NEGOCIACAO deve exigir valor + margem + documento
**Severidade:** 🟡 Média (business rule crítica — Sprint 8 P-01 gate
incompleto). Descoberto em uso 2026-07-05 pelo Fred:
"para evoluir para o estagio de negociação deve ser obrigatório
ainda no estagio de proposta ter preenchido um valor de proposta
atualizado e a margem, e anexar o documento de proposta".

**Estado atual** (`src/server/services/opportunity-stage.service.ts`
STAGE_EXIT_REQUIREMENTS):
- `PROPOSTA` → exige `proposalPresentedAt`
- Também Sprint 8 P-01 exige ≥ 1 `ProposalVersion` (validador Zod
  em `advanceStage`)
- **Falta**: exigir `latestVersion.totalValue` não-nulo E
  `latestVersion.marginPct` não-nulo E ≥1 `Document category=PROPOSTA_TECNICA`
  ou `PROPOSTA_COMERCIAL` vinculado à opp

**Fix escopo:**
- Estender `STAGE_EXIT_REQUIREMENTS['PROPOSTA']` OU criar novo helper
  async `validateProposalExit(opportunityId)` que verifica:
  - `latestVersion.totalValue !== null`
  - `latestVersion.marginPct !== null`
  - Existe pelo menos 1 Document com category em `['PROPOSTA_TECNICA',
    'PROPOSTA_COMERCIAL']` (definir quais aceitos com PO) vinculado
- Erro claro no `StageTransitionError`: "Preencha valor e margem
  da proposta e anexe o documento antes de avançar."
- UI reflete mensagem via `friendlyTrpcError`

**Testes:**
- Advance PROPOSTA→NEGOCIACAO sem valor → PRECONDITION_FAILED
- Sem margem → mesmo erro
- Sem documento categoria proposta → mesmo erro
- Com todos → sucesso

**Onde tocar:**
- `src/server/services/opportunity-stage.service.ts` — helper novo
- `src/server/trpc/routers/opportunities.ts` — chamar helper no
  `advanceStage` quando `from=PROPOSTA`
- Testes em `tests/unit/stage-transition.test.ts` (Sprint 2 baseline)

**Esforço:** ~2h.

### P-67. Tela `/approvals` não mostra oportunidades pendentes de DIRETOR_COMERCIAL / DIRETOR_FINANCEIRO
**Severidade:** 🔴 Alta (feature quebrada — aprovadores não veem o que
precisam aprovar). Descoberto em uso 2026-07-05 pelo Fred logado como
DIRETOR_COMERCIAL:
"Nao estou conseguindo visualizar na tela de aprovação, as
oportunidades que precisam ser aprovados por estarem dentro das
regras de aprovação pelo diretor comercial e diretor financeiro".

**Hipóteses de investigação:**
1. **Approval engine não está criando `Approval` rows** ao gerar
   nova `ProposalVersion` — verificar
   `src/server/services/approval-engine.service.ts`
   `createApprovalsForProposalVersion` está sendo chamado?
2. **RBAC filtro errado em `approvals.myPending`** — retorna
   `Approval.approverId = ctx.user.id`. Mas com Sprint 15E, engine
   pode estar usando `approver_permission` em vez de `approver_roles`
   — buscar rows onde `approverRole in ctx.user.role` OU
   `approverPermission in ctx.user.cachedPermissions`
3. **Regras de aprovação não configuradas** — `/admin/approval-rules`
   está vazio ou desativado
4. **Fred não é o aprovador designado** — Sprint 8 config espera
   role no approval_rule, mas talvez matriz de aprovação atual não
   tem regra ativa pra DIRETOR_COMERCIAL/FINANCEIRO

**Fix escopo:**
- Investigação primeiro: rodar SQL no Neon prod
  ```sql
  SELECT ap.id, ap.status, ap.approver_role, ap.approver_id, o.title
  FROM approvals ap JOIN opportunities o ON o.id = ap.opportunity_id
  WHERE ap.tenant_id = '<marquezini-tenant-id>' AND ap.status = 'PENDING'
  ORDER BY ap.created_at DESC LIMIT 20;
  ```
- Verificar quantas approvals existem, com qual role, e se Fred
  bate no filtro
- Se 0 approvals: bug do engine — corrigir criação
- Se >0 approvals com role DIRETOR_COMERCIAL: bug do filtro na
  procedure — corrigir query
- Se approvals têm outro role: config de aprovação errada — chamar PO

**Onde tocar** (depende do diagnóstico):
- `src/server/trpc/routers/approvals.ts` procedure `myPending`
- `src/server/services/approval-engine.service.ts` criação
- `src/app/approvals/page.tsx` UI (se filtro cliente errado)

**Esforço:** ~1-3h (investigação + fix).

### P-56. `billing.status` bloqueia todo role não-ADMIN (falso 403 no AppShell)
**✅ FECHADO 2026-07-05** — commit `61a572b`

`billing.status` usava `withRoles('ADMIN')` legado. Banner Past Due
e Trial Expiry no AppShell nunca apareciam pra não-ADMINs em prod
(DIRETOR/GESTOR/ANALISTA/PARCEIRO), e o console mostrava
`GET /api/trpc/billing.status?batch=1 → 403 (Forbidden)` em toda
carga de página.

**Fix aplicado (caminho A da spec — procedure separada):**
- Nova procedure `billing.statusForBanner` em
  `src/server/trpc/routers/billing.ts:34-77` protegida só por
  `protectedProcedure` (autenticado basta). Retorna `{plan,
  subscriptionStatus, trialEndsAt, isPastDue, isTrialExpiring}`
  computados no servidor
- `isPastDue` = `subscriptionStatus === 'PAST_DUE' || 'CANCELED'`
- `isTrialExpiring` = `plan === TRIAL && trialEndsAt !== null &&
  trialEndsAt - now < 7 dias`
- `billing.status` original **preservado** com `adminOnlyProcedure`
  — `/admin/billing` continua expondo detalhes financeiros
  (`stripeCustomerId`, `currentPeriodEnd`) só pra ADMIN
- `src/components/layout/PastDueBanner.tsx:14` e
  `src/components/billing/TrialExpiryBanner.tsx:12` migrados de
  `trpc.billing.status.useQuery` pra `trpc.billing.statusForBanner.useQuery`

**Testes:** `tests/unit/billing-status-for-banner.test.ts` novo com
**13 casos** (PAST_DUE=true, CANCELED=true, trial<7d=true, trial>7d=false,
plan≠TRIAL ignora trialEndsAt, ACTIVE+sem trial=ambos false, tenant
não encontrado retorna defaults, cross-tenant filtra por ctx.tenantId,
DIRETOR_COMERCIAL não lança FORBIDDEN, 4 roles não-ADMIN funcionam).
Padrão: mock `@/server/db/client` capturando `tenant.findUnique`,
`makeCaller` configurável por role/tenantId.

**Baseline:** 736 passing (+13 novos) / 10 pré-existentes por env vars
em `field-encryption` (4) + `communication-summary-errors` (6) —
confirmados idênticos ANTES do fix / 172 skipped. Type-check zero.
Lint zero. Rollback trivial (reverter 3 arquivos).

Escopo cirúrgico: `permissions-catalog.ts` intacto (não precisou
`billing:read_status`); `rbac.ts` intacto; nenhum backfill de cache
necessário. Rollout imediato sem migração.

### P-57. IA bloqueia por dirty em campos NÃO relacionados ao Receptor
**Severidade:** Baixa (decisão de produto). Registrado ao fechar P-54
em 2026-07-05.

Mesmo com P-54 fixado (state limpa após Salvar), o design
`CommunicationIntake.tsx:73` bloqueia botão "Resumir com IA" sempre
que `editStageFields` tem QUALQUER chave. Se usuário está editando
briefing/valor/datas E paralelamente cola comunicação no Receptor
pra resumir, IA fica bloqueada.

Argumento contra: IA só consome texto do Receptor, não briefing/valor.
Argumento a favor (P-09 original): evita ambiguidade — usuário salva
tudo antes de invocar IA.

**Decisão:** produto/PO. Sem ação técnica imediata.

**Esforço:** ~30min se aprovar mudança.

### ~~P-58. Toast padronizado em CommunicationIntake / Documents / Proposals~~ ✅ FECHADO 2026-07-05
Chip `claude/p58-subforms-toast` (worktree `silly-chandrasekhar-6f6953`).
Fix cirúrgico replicando padrão canônico P-54 nos 3 componentes:

- **`CommunicationIntake.tsx`** — `summarize.onSuccess` (aiGenerated=true)
  dispara toast success "Resumo gerado."; `onError` dispara toast error
  com `friendlyTrpcError`. `confirmSummary.onSuccess` dispara toast
  success "Reunião salva."; `onError` dispara toast error. Inline error
  paragraph removido (redundante com toast). `aiFailed` inline banner
  preservado (é state UX, não erro de mutation)
- **`DocumentsSection.tsx`** — orquestração `getUploadIntent → uploadProxy
  → create` dentro de `handleFileSelected` com try/catch: sucesso dispara
  toast "Documento anexado."; catch dispara toast error com
  `friendlyTrpcError` quando aplicável (fallback pra "Falha ao enviar
  arquivo." pra erros não-TRPC). Estado local `error` removido (toast
  substitui inline banner)
- **`ProposalsSection.tsx`** — `create.onSuccess` dispara toast "Proposta
  criada."; `addVersion.onSuccess` dispara toast "Nova versão da
  proposta.". Ambos com `onError` via `friendlyTrpcError`

Imports novos: `useToast` de `@/components/ui/toast`,
`friendlyTrpcError` de `@/lib/trpc/error-format` (este último só onde
faltava).

Testes: `tests/unit/pipeline-subforms-toast.test.tsx` novo com **11
casos** (CommunicationIntake +5, DocumentsSection +2, ProposalsSection
+4). Padrão idêntico ao `pipeline-detail-page.test.tsx` (P-54): mock
`@/lib/trpc/client` capturando `onSuccess/onError` das mutations,
`ToastProvider` real, dispara handlers manualmente e verifica títulos
via `[role="status"]/[role="alert"]`.

Baseline: **734 passing (+11 novos) / 10 pré-existentes por env vars em
`field-encryption` (4) + `communication-summary-errors` (6) — confirmado
idênticas no HEAD antes do fix / 172 skipped**. Type-check zero. Lint
zero.

**Escopo intencionalmente estreito:** nenhum código de servidor tocado;
`pipeline/[id]/page.tsx` (fixado no P-54) preservado; padrão de copy
mantido curto e direto (spec explicitou "mensagens curtas").

### P-59. Playwright E2E em worktree efêmera sem instância Clerk real
**Severidade:** Baixa. Descoberto pelo QA automation pós-bloco A+B+C
em 2026-07-05.

Chip QA rodou `smoke.spec.ts` e `axe-smoke.spec.ts` no worktree
efêmero — todos falham porque browser real do Playwright recebe
página `"Invalid host"` do Clerk SDK (dummy publishable key satisfaz
o SDK-init mas rejeita request real de browser). curl HTML SSR
confirma que os fixes P-51 e P-52 estão corretos — só o browser
real trava.

**Fix sugerido:** ampliar bypass `NODE_ENV=test` (Sprint 11 —
`tests/e2e/fixtures/auth.ts`) pra smoke/axe. Ou `webServer` com
env `CLERK_MOCK=true` que substitui `ClerkProvider` por mock
(caminho B do P-39 spec). Ou documentar que Playwright só roda
verde em staging real.

**Esforço:** ~3h (mock caminho B) OU ~30min (docs "requer staging").

### P-60. `communication-summary-errors.test.ts` 6 falhas — potencial regressão silenciosa
**✅ FECHADO em 2026-07-05.** Commit `4f44496` na branch
`claude/p60-comm-summary-regression`.

**Diagnóstico (bisect):** commit culpado `9aef608` (Sprint 15F,
2026-06-30). Sprint 15F trocou a superfície de IA de `callAiFeature`
(path legado) por `dispatchChat` (roteador que respeita
`MULTI_AI_ENABLED`). `summarizeCommunication` migrou; os testes NÃO.
Continuaram mockando `callAiFeature` — mas quando `MULTI_AI_ENABLED`
resolve `true`, `dispatchChat` chama `callAiWithFallback` +
`resolveAiConfig` (Prisma direto), bypassando o mock. Resultado: mock
não intercepta, Prisma tenta ir ao banco com `tenantId:'tenant-1'`
(não-UUID), throw genérico, service catch-all resulta em
`aiGenerated:false`. 6 asserts que esperavam `rejects.toBeInstanceOf(...)`
recebem resolve. **Hipótese vencedora: B (teste velho pós-Sprint 15F).**
Contrato do service está correto — só o mock estava no nível errado.

**Bug secundário descoberto (bônus arquitetural):**
`z.coerce.boolean()` no `src/lib/env.ts` fazia `Boolean("false") ===
true`. Isso silenciosamente LIGAVA `MULTI_AI_ENABLED=false` no `.env`
(além de `AXIOM_LOG_QUERIES` e `RBAC_GRANULAR_ENABLED`). Rollback
via env var não funcionava — quem escrevesse "false" esperando
desligar, ligava. Ver memory `env-boolean-parsing.md`.

**Fix (2 partes, 1 commit):**
1. **`tests/unit/communication-summary-errors.test.ts`** — substitui
   `vi.mock('@/lib/ai/feature-gate')` por `vi.mock('@/lib/ai/dispatch')`.
   Cada teste agora define `vi.mocked(dispatchChat).mockImplementation(...)`.
   As 8 assertions cobrem exatamente o contrato do service:
   `FeatureNotAvailableError`/`AiLimitExceededError` → rethrow;
   `Anthropic.APIError` 400/401/429 → `mapAnthropicError` → `TRPCError`;
   erro genérico ou 5xx → `aiGenerated:false` gracioso. Independente
   da flag `MULTI_AI_ENABLED`.
2. **`src/lib/env.ts`** — novo helper `envBoolean(default)` que
   interpreta strings literalmente (`"true|1|yes|on"` → true;
   `"false|0|no|off|""` → false; ausente → default; desconhecido →
   default). Aplicado em `AXIOM_LOG_QUERIES`, `MULTI_AI_ENABLED`,
   `RBAC_GRANULAR_ENABLED`. 10 testes novos em
   `tests/unit/env-boolean-parsing.test.ts` cobrindo undefined /
   boolean direto / cada string comum / case-insensitive / vazia /
   valor desconhecido → default.

**Resultado (as 6 assertions específicas):**

| # | Assertion | Antes | Depois |
|---|-----------|-------|--------|
| 1 | `FeatureNotAvailableError` propaga | resolve `{themes:[]}` | rejects instanceof ✓ |
| 2 | `AiLimitExceededError.kind='MONTHLY_TOKENS'` propaga | resolve | rejects toMatchObject ✓ |
| 3 | 400 credit balance → `TRPCError PRECONDITION_FAILED` + créditos + console URL | resolve | rejects toSatisfy ✓ |
| 4 | 401 → `TRPCError UNAUTHORIZED` + /admin/ai | resolve | rejects toSatisfy ✓ |
| 5 | 429 sem retry-after → `TRPCError TOO_MANY_REQUESTS` + "alguns segundos" | resolve | rejects toSatisfy ✓ |
| 6 | 429 com retry-after:30 → `TOO_MANY_REQUESTS` + "30s" | resolve | rejects toSatisfy ✓ |

Assertions 7 (5xx fallback silencioso) e 8 (500 genérico → aiGenerated:false)
já passavam por coincidência (path novo do resolve.ts também falhava
com erro genérico não-mapeado que caía no ramo aiGenerated:false).

**Baseline testes:**
- Antes: 733 passing / 10 failing (4 field-encryption + 6 comm-summary) / 172 skipped
- Depois: **739 passing / 4 failing (só field-encryption pré-existentes) / 172 skipped**
- +6 comm-summary corrigidos, +10 env-boolean-parsing novos, 0 regressão

Type-check zero. Lint zero.

### P-61. `src/server/trpc/trpc.ts` reporta 0% coverage estático ✅ FECHADO em 2026-07-05
**Severidade:** Baixa. Descoberto pelo QA automation pós-bloco A+B+C
em 2026-07-05.

Módulo era exercido por replay em `tests/unit/tenant-isolation-error-map.test.ts:121-179`
(bloco "errorFormatter — integração com tRPC") sem instanciar
servidor. Coverage estático não contava o replay. Comportamento
validado semanticamente mas relatório ficava ruim.

**Fix aplicado (caminho A da spec):** refactor cirúrgico em
`src/server/trpc/trpc.ts` extraindo a lógica dos 5 handlers para
funções puras EXPORTADAS no mesmo arquivo — `formatTrpcError`,
`assertAuthContext`, `assertPlatformContext`, `runMapErrors`,
`runMonitor` (+ interface `MonitorHookInput`). Os wrappers
`t.middleware(...)` viraram one-liners que delegam pras funções
puras. Zero mudança semântica: contrato do tRPC preservado
(errorFormatter usa `DefaultErrorShape` do próprio SDK; middlewares
mantêm signature `({ctx, path, type, next}) => next()`).

`tests/unit/trpc-middlewares.test.ts` novo com **21 casos**:
- `formatTrpcError` × 4 (tenant-isolation via cause; via message
  fallback; ZodError flatten; erro comum preserva shape)
- `assertAuthContext` × 3 (happy path; sem user; sem tenantId)
- `assertPlatformContext` × 3 (happy path; sem platformUser; role
  errada `PLATFORM_SUPPORT`)
- `runMapErrors` × 5 (passthrough; ForbiddenError→FORBIDDEN;
  tenant-isolation Error→INTERNAL_SERVER_ERROR com cause; Error
  genérico re-throw intacto; TRPCError re-throw intacto)
- `runMonitor` × 6 (success mutation loga Axiom ok=true; success
  query com AXIOM_LOG_QUERIES=false NÃO loga; TRPCError FORBIDDEN
  loga sem Sentry; Error genérico dispara Sentry captureException
  com tags corretas; string throw vira errorMessage=String(err);
  ctx nulls não crash)

Padrão: `vi.mock` de `@/lib/monitoring/axiom` + `@/lib/monitoring/sentry`
com spies capturando payloads. Reusa mesmo `process.env.DATABASE_URL`
guard-import de `tests/unit/audit-context-loss.test.ts`.

**Coverage antes:** 0% linhas / 0% funcs.
**Coverage depois:** **85.6% linhas / 88.88% branches / 100% funcs**
(v8, sobre trpc.ts). Uncovered: linhas 188-196, 201, 215-223 — só os
wrappers `t.middleware((opts) => runHandler(...))` que executam
quando servidor tRPC roteia request real. A lógica está 100%
coberta via os handlers puros.

**Baseline:** pré-chip 768 passing / 4 failing (field-encryption
pré-existentes) / 172 skipped (944 total); pós-chip **789 passing
(+21) / 4 failing preservados / 172 skipped (965 total)**. Zero
regressão confirmada via `git stash` + `npm test` no baseline
anterior. Type-check zero. Lint zero.

**Rollback:** trivial — reverter `src/server/trpc/trpc.ts` (mantendo
o formato original com handlers inline) + remover
`tests/unit/trpc-middlewares.test.ts`.

### P-62. `RBAC_GRANULAR_ENABLED` flag morta — sem consumer runtime
✅ **FECHADO 2026-07-05.** Caminho A (kill-switch runtime real).

Kill-switch consumido em `src/server/services/permissions.service.ts`
`hasPermission()`:
- `env.RBAC_GRANULAR_ENABLED=true` (default P-62) → path granular
  Sprint 15E completo: role default + overrides individuais + cache.
- `env.RBAC_GRANULAR_ENABLED=false` → rollback runtime: query enxuta
  (sem `cachedPermissions`/`permissionOverrides`), retorna só
  `ROLE_DEFAULT_PERMISSIONS[role].has(permission)`. Overrides
  granted/revoked são ignorados até a flag religar. Reversível — não
  destrói cache DB nem overrides persistidos.

**Decisões de projeto:**
- Fallback usa `ROLE_DEFAULT_PERMISSIONS` (catálogo 15E) em vez de
  `hasCapability`/`ROLE_CAPABILITIES` legado. Motivo: `ROLE_CAPABILITIES`
  não cobre 7 semantic splits do 15E (`task:*`, `document:*`,
  `reports:*`, `import:*`, `opportunity:read_others`, etc.), e usar
  legacy quebraria ADMIN default. `ROLE_DEFAULT_PERMISSIONS` respeita
  os breaking changes intencionais do 15E (ANALISTA sem
  `opportunity:read_others`, GESTOR sem `partner:approve_engagement`).
- Default do `env` alterado de `envBoolean(false)` para `envBoolean(true)`.
  Runtime pré-P-62 já rodava granular sempre (sem gate); manter o
  default `false` teria flipado prod pra legado silenciosamente no
  próximo deploy. Docs de rollout antigas (Sprint 15E §5.4, Roteiro
  QA §Anexo) que dizem "default false" ficam obsoletas —
  documentado em CLAUDE.md §Débitos zerados 2026-07-05.
- Preservado Platform Owner bypass, checks `deletedAt`/`active`, e
  mensagem de rollback reversível.

**Testes:** `tests/unit/rbac-kill-switch.test.ts` reescrito (removeu
`describe.skip`), 15 casos cobrindo:
- flag=true: cache hit granted/revoked, Platform Owner bypass,
  deletedAt/inactive
- flag=false: ADMIN default preservado, ANALISTA com grant perde,
  breaking changes 15E preservados, Platform Owner, deletedAt/active/
  missing user, PARCEIRO 5 permissions
- rollback reversível (flag flip mid-runtime)

Baseline: **831 passing (+15) / 0 failing / 167 skipped (-5 do
`describe.skip` antigo) / 998 total**. Type-check zero. Lint zero.

### ~~P-63. Auditoria retroativa `AXIOM_LOG_QUERIES` em prod (potencial LGPD)~~ ✅ FECHADO 2026-07-05
Chip `claude/p63-envboolean-doc` — sem risco retroativo confirmado
(`vercel env ls production` mostrou que a var não estava setada, então
o default `.default(false)` seguiu vigente durante todo o intervalo de
exposição ao bug P-60). Ação preventiva entregue como docs + teste de
regressão estrutural:
- `docs/Metodologia_Desenvolvimento_Venzo.md` §4.9 nova documenta a
  regra "`envBoolean(default)` obrigatório em toda flag booleana de
  env" com o histórico do bug e link cruzado pros dois testes
- `docs/Metodologia_Desenvolvimento_Venzo.md` §13.1 (Antipatterns
  código) ganha entrada `❌ z.coerce.boolean() em env var (usar
  envBoolean(default))`
- `tests/unit/env-schema-regression.test.ts` novo faz grep estrutural
  em `src/lib/env.ts` proibindo `z.coerce.boolean(`. Filtra linhas de
  comentário `//` pra evitar falso positivo com a nota histórica do
  P-60 no cabeçalho. Complementa `env-boolean-parsing.test.ts` (P-60)
  que valida o parser case-a-caso

Se um dia a var for setada em prod, rodar checklist do sanity check
(spec do QA automation §8) antes do próximo deploy — não há risco
histórico a auditar.

### ~~P-54. Botão Salvar sem feedback + edits não limpos + IA bloqueada indefinidamente~~ ✅ FECHADO 2026-07-05
Chip `claude/p54-salvar-feedback` (worktree `blissful-zhukovsky-24abed`),
commit `89f5a95` — fix cirúrgico em `src/app/pipeline/[id]/page.tsx:22-51`. As 3 mutations
`update`/`advance`/`cancel` agora seguem o padrão canônico:
- `update.onSuccess`: `invalidate` + `setEditStageFields({})` + `toast
  success "Alterações salvas."`
- `advance.onSuccess`: `invalidate` + `setEditStageFields({})` + `toast
  success "Estágio avançado."`
- `cancel.onSuccess`: `invalidate` + `router.push('/pipeline')` (redirect
  é o feedback — sem toast redundante)
- Todos os 3 têm `onError: toast error com friendlyTrpcError`

Import novo: `useToast` de `@/components/ui/toast`. State declarations
movidas pra cima das mutations pra `setEditStageFields` ficar em escopo
(sem impacto em rules-of-hooks — ordem preservada entre renders).

Auditoria dos outros forms de pipeline:
- `pipeline/new/page.tsx` — **OK**, tem toast success + inline error via
  `create.error` + `friendlyTrpcError`
- `TasksSection` — **OK**, tem toast success + `onError` com friendly
- `CommunicationIntake` — 🟡 sem toast (state change é o feedback:
  summary aparece). Inline error existe. Registrado em **P-58**
- `DocumentsSection` — 🟡 sem toast (multi-step upload). Inline banner
  de erro existe. Registrado em **P-58**
- `ProposalsSection` — 🟡 sem toast (form fecha + lista atualiza).
  Registrado em **P-58**

Testes: `tests/unit/pipeline-detail-page.test.tsx` novo com **7 casos**
(update onSuccess dispara toast + limpa state, update onError com
friendly, click Salvar → Save → dirty limpo → botão Salvar some,
advance onSuccess dispara toast + limpa state + invalidate, advance
onError com friendly, cancel onError com friendly, cancel onSuccess
redireciona sem toast). Padrão: mock `@/lib/trpc/client` capturando
`onSuccess/onError` das 3 mutations, `ToastProvider` real, dispara
handlers manualmente e verifica `[role="status"]/[role="alert"]`.

Baseline: **723 passing (+7 novos) / 10 pré-existentes por env vars em
`field-encryption` (4) + `communication-summary-errors` (6) — confirmado
idênticas no HEAD sem fix / 172 skipped**. Type-check zero. Lint zero.

**Débitos residuais registrados:**
- **P-57** — decisão de produto: `stageHasDirtyChanges` bloqueia IA
  mesmo pra edits em campos NÃO relacionados ao Receptor (briefing/
  valor/datas). Deveria só bloquear se edit for em campo que impacta
  o resumo? Não escopo P-54.
- **P-58** — padronizar toast success em CommunicationIntake +
  DocumentsSection + ProposalsSection (todos hoje usam state change
  como único feedback). Cosmético mas melhora consistência.

Regressões caçadas: nenhuma. Toasts em cadeia funcionam (`ToastProvider`
limita 3 visíveis). Após salvar, dirty volta normalmente ao editar de
novo. CommunicationIntake desbloqueia (`stageHasDirtyChanges=false`).

### ~~P-51. Playwright `smoke.spec.ts` desatualizada (Sprint 14 copy)~~ ✅ FECHADO 2026-07-05
Chip `claude/p51-smoke-copy` — fixture-only. 2 seletores em
`tests/e2e/smoke.spec.ts` atualizados: `/CRM B2B/i` → `/Feche mais/i`
(landing) e `/Auto-cadastro/i` → `/Fale com a gente/i`
(`/p/[slug]/contact`). Sem código de app tocado.

Validação: `npx playwright test tests/e2e/smoke.spec.ts
--project=chromium-desktop` = **3/3 passing (7.7s)**. Type-check
zero, lint zero. QA automation exception aplicada (fixture E2E).

### ~~P-52. `axe-smoke.spec.ts` reporta violações `html-has-lang`~~ ✅ FECHADO 2026-07-05
Chip `claude/p52-axe-iframe` — fix defensivo em `tests/e2e/axe-smoke.spec.ts`
adicionando `.exclude('iframe')` nas duas `AxeBuilder` chains (rotas
públicas + rotas autenticadas). Comentário no cabeçalho do arquivo
justifica: Clerk injeta iframe oculto pra session management via
`ClerkProvider` em todas as rotas, e axe reportava `html-has-lang`
contra o `<html>` interno desse iframe que não controlamos. Nossa
`<html lang="pt-BR">` em `src/app/layout.tsx:59` segue intacta.

Validação:
- Playwright rodado localmente (chromium-desktop + mobile-safari)
  contra dev server com dummy Clerk keys. `html-has-lang` não aparece
  no output em nenhum estado (dummy keys não inicializam iframe
  Clerk — QA original observou em ambiente diferente). Contagem de
  violations idêntica ANTES e DEPOIS do fix (42 `color-contrast` em
  ambos), confirmando zero regressão do meu lado
- 10 failures pré-existentes remanescentes são `color-contrast`
  (link `.text-brand` na CookieBanner: `#7c3bed` on `#1f1a2d` = 2.97:1
  vs required 4.5:1). Não é escopo P-52 — registrado como novo débito
  **P-55** abaixo (P-54 já usado pra toast Salvar)
- `npx tsc --noEmit` zero. `npm run lint` zero

**QA automation exception:** fixture E2E, sem código de app.

### ~~P-55. Contraste `.text-brand` na CookieBanner falha WCAG AA~~ ✅ FECHADO 2026-07-05
Descoberto pelo chip P-52; fechado no chip `claude/p55-cookiebanner-contrast`
(commit `eb38597` (pré-merge; final SHA muda no merge)).

**Fix aplicado (caminho A da spec — trocar token no link):**
- `src/components/legal/CookieBanner.tsx:97` — token `text-brand`
  substituído por `text-brand-primary-light` no `<a>` da Política de
  Privacidade
- Estética violet preservada (light violet #c585fa em vez do
  primary #7c3aee)
- Tailwind já expõe `text-brand-primary-light` (via config em
  `brand.primary-light` HSL 273/92/75); mesmo token idiomático usado
  em `src/app/privacy/page.tsx`, `src/app/privacy-request/page.tsx` e
  `src/app/page.tsx` — sem utility legada nova em `globals.css`

**Cálculo do contraste (algoritmo `computeContrast` do
`wcag-validator.service.ts`):**
- ANTES: `#7c3aee` (brand-primary) sobre `#1f1a2d` (bg-card dark) =
  **2.97:1** ❌ FAIL WCAG AA
- DEPOIS: `#c585fa` (brand-primary-light) sobre `#1f1a2d` =
  **6.52:1** ✅ PASS WCAG AA (folga 45% acima do 4.5:1 requerido)

Rejeitados no processo:
- `text-brand-accent` (`#f5a124`, contraste 8.04:1 ✅): passaria mas
  quebra estética violet — vira link laranja
- Ajustar `--brand-primary` no dark theme: bagunçaria botão "Aceitar
  todos" e outros consumidores primary — escopo cirúrgico preferido
- Font-semibold como workaround: ❌ não conta pra WCAG AA em texto
  normal < 18px (per spec do chip)

**Testes:** sem test file novo — QA automation exception UI a11y minor
(config-only visual). Verificação manual do ratio via script
`scratchpad/contrast-check.mjs` reusando `hexToRgb`, `srgbToLinear`,
`relativeLuminance`, `computeContrast` do
`src/server/services/wcag-validator.service.ts`. Playwright axe-smoke
BLOCKED por infra P-59.

**Baseline:** 768 passing / 4 falhas + 172 skipped (baseline dev
preservado, delta zero — apenas mudança de token Tailwind num único
componente). Type-check zero. Lint zero. Rollback trivial (reverter
1 linha).

**Débito adjacente registrado como P-64** (renumerado — próxima linha):
outras 3 ocorrências de `.text-brand` residuais no code base
(`admin/branding/page.tsx:97` — tab indicator; `PolicyAcceptGate.tsx:60`
e `:67` — dois `<a>` de link em modal LGPD). Escopo P-55 foi
CookieBanner só; se axe-smoke rodar contra
`/privacy-request` (que renderiza `PolicyAcceptGate`) ou
`/admin/branding` deve reportar mesmas violations. Registrar como
sub-débito adjacente pra próximo chip a11y.

### P-64. Ocorrências residuais de `.text-brand` fora da CookieBanner
**Severidade:** Baixa. Registrado ao fechar P-55 em 2026-07-05.

Auditoria pós-P-55 identificou 3 usos remanescentes de `.text-brand`
com mesmo padrão do bug fixado:

- `src/app/admin/branding/page.tsx:97` — tab indicator ativa
  (border-brand + text-brand). Renderiza dentro do AppShell dark
  (bg-card `#1f1a2d`). Mesma combinação 2.97:1
- `src/components/legal/PolicyAcceptGate.tsx:60` — `<a>` "Política
  de Privacidade" em modal LGPD
- `src/components/legal/PolicyAcceptGate.tsx:67` — `<a>` "Termos"
  no mesmo modal

**Fix sugerido:** replicar pattern do P-55 — trocar `text-brand` por
`text-brand-primary-light` em cada um. Preserva estética violet e
resolve 3 violations WCAG AA de uma vez.

**Esforço:** ~10min UI + verificação axe. Escopo cirúrgico
(3 edits mecânicos, sem lógica). Não bloqueia deploy.

### ~~P-53. Pipeline pages `.tsx` sem coverage — falta harness React~~ ✅ FECHADO 2026-07-05
Chip `claude/p53-testing-library`. Piloto de Testing Library +
`jsdom` (já presente) + `@testing-library/react@^14.3.1` +
`@testing-library/user-event@^14.6.1` +
`@testing-library/jest-dom@^6.9.1`. Setup:
- `tests/setup.ts` importa `@testing-library/jest-dom/vitest` e
  chama `cleanup()` em `afterEach` (isolamento DOM entre casos).
- `vitest.config.ts:include` ganha
  `tests/component/**/*.test.tsx`; `coverage.exclude` remove
  `page.tsx` (mantém layout/loading/error/not-found/template
  como excludes).
- `tests/component/pipeline-new.test.tsx` cobre 11 casos: render
  cabeçalho + campos essenciais + botão Criar; filtro de
  PARCEIRO na lista de responsáveis; máscara BRL P-50 em tempo
  real (digitação, decimal com vírgula, filtro não-numéricos);
  submit com `estimatedValue` unformatado; submit sem valor
  envia `undefined`; `onSuccess` dispara `router.push` +
  toast Venzo; Cancelar chama `router.back`; existência do
  bloco `create.error && …` (integração fina fica pros unit
  tests dedicados de `friendlyTrpcError`).

**Coverage:** `src/app/pipeline/new/page.tsx` = **82.22% lines
/ 75% branches / 57.14% funcs** (target era ≥40%). Uncovered:
lead sources dinâmico (leadSources.data.length>0), branch de
Parceiro (source==='PARCEIRO'), bloco `create.error`
(coberto pelos unit tests dedicados de friendlyTrpcError).

**Baseline:** **759 passing** (baseline pré-P-53 = 748 + 11
novos) / 4 pré-existentes por env vars em `field-encryption` /
172 skipped. Type-check zero. Lint zero. Zero regressão.

**Padrão adotado (Testing Library vs createRoot manual do P-54):**
os dois padrões coexistem. Testing Library ganha em ergonomia
pra forms com digitação e submit (`userEvent.type`,
`getByLabelText`, `getByRole`); createRoot manual segue útil
pra páginas que só validam mutation handlers (mock trpc +
disparo direto de `onSuccess/onError`). Débitos residuais
registrados abaixo pra expansão do padrão.

**Débitos residuais (candidatos Sprint 16+):**
- **P-73:** `/companies` (form novo + edit) — CompanyForm com
  CNPJ auto-fill (BrasilAPI) e endereço via CEP. ~3h.
- **P-74:** `/contacts` (form novo + edit) — ContactForm com
  QuickCreate de Empresa aninhado. ~2h.
- **P-75:** `/admin/users` (convite + edição) — role picker
  com guard anti-escalada (SUPER_ADMIN). ~2h.
- **P-76:** `/pipeline/[id]` — migrar
  `tests/unit/pipeline-detail-page.test.tsx` (padrão
  createRoot manual) pra Testing Library, cobrindo agora
  também interações de digitação nos campos de estágio (não
  só handlers de mutation). ~4h. Opcional — padrão atual
  segue estável.

**Renumeração 2026-07-06:** IDs originais P-65/66/67/68 deste
bloco eram colisão com débitos novos do topo do backlog
(estimatedValue sync, PROPOSTA→NEGOCIACAO gate, /approvals
invisível, WCAG AA header). Renomeado pra P-73+ pra manter
IDs únicos.

**Update 2026-07-05 (P-54 fix, histórico)**: chip P-54 escreveu
`tests/unit/pipeline-detail-page.test.tsx` com 7 casos mockando
`@/lib/trpc/client` no padrão do `admin-ai-page.test.tsx` — sem
Testing Library, apenas `createRoot` + `act` + `ToastProvider`.
Padrão validado e mantido em paralelo ao Testing Library.

### ~~P-58. Padronizar toast success em Communication/Documents/Proposals sections~~ ✅ FECHADO 2026-07-05
Fechado no chip `claude/p58-subforms-toast`. Ver bloco P-58 acima
(§Pendências curto prazo) pra descrição completa do fix.

Débito residual identificado durante a auditoria: `TasksSection.updateStatus`
(checkbox toggle) segue sem toast em erro — falha silenciosa se rollback
do checkbox não for possível. Não coberto por este chip (escopo era
Communication/Documents/Proposals); registrar como P-77 se virar
recorrente.

### ~~P-50. Campo "Valor estimado (R$)" sem máscara pt-BR nos forms~~ ✅ FECHADO 2026-07-05
Chip `claude/p50-brl-input-mask` mergido no commit `9b4c831`. Fix
seguindo padrão Sprint 15C (CNPJ/CEP bidirecional):
- `formatBRLInput`/`unformatBRLInput` novos em
  `src/lib/utils/format.ts` — aceita `.` OU `,` como decimal,
  normaliza pra `,` no display, cap 12 dígitos inteiros + 2 decimais
- Aplicado em `src/app/pipeline/new/page.tsx:186-192` e
  `src/app/pipeline/[id]/page.tsx:319-323` + `coerceFields()`
- Preserva compatibilidade com valores legados (número puro sem
  escala de centavos)
- 15 testes novos em `tests/unit/format-brl-input.test.ts`

QA automation verde (`9b4c831` vs `a69b0ce`): 741 passing (+15) / 6
pré-existentes por env vars / 172 skipped. Coverage `format.ts`:
100% linhas / 95.16% branches / 100% funcs. Grep de `estimatedValue`
em outros forms = 0 (refactor cirurgicamente completo). Type-check
zero, lint zero.

Débitos residuais registrados: **P-51** (smoke.spec desatualizada),
**P-52** (axe html-has-lang), **P-53** (falta harness React
Testing Library).

Entregue conforme escopo:
- `src/lib/utils/format.ts` — `formatBRLInput(raw)` e
  `unformatBRLInput(value)`. Regra: último `.` ou `,` seguido de 0-2
  dígitos = decimal (display); 1-2 dígitos = decimal (unformat).
  Cap 12 dígitos inteiros + 2 decimais. Zeros à esquerda strippados.
  Normaliza `.` decimal em `,` no display (compat calculadora).
- `src/app/pipeline/new/page.tsx:186-193` — `type="text"
  inputMode="decimal"`, `formatBRLInput` on-change, `unformatBRLInput`
  no submit (linha 76).
- `src/app/pipeline/[id]/page.tsx:319-325` — mesmo pattern +
  `coerceFields` linha 417 troca `Number(v)` por `unformatBRLInput(v)`.
- 15 testes novos em `tests/unit/format-brl-input.test.ts`
  (vazio, incremental, decimal opcional, cap 12 dígitos, colar valor,
  round-trip, ponto-como-decimal). Total pós-P-50: **741 passing
  (+15 novos) / 6 pré-existentes (env vars em
  `communication-summary-errors`) / 172 skipped**. Type-check zero.
  Lint zero.

### ~~P-47. Vitest sem carregamento automático de `.env.local`~~ ✅ FECHADO 2026-07-05
### ~~P-43. Baseline testes tem 3 leituras diferentes por ambiente~~ ✅ FECHADO 2026-07-05 (consequência do P-47)

Chip `claude/p47-vitest-dotenv` (commit desta sessão). Fix caminho A
da spec: `tests/env-setup.ts` novo faz load com precedence
`.env.test → .env.local → .env` (`override: false` preserva vars já
setadas no shell/CI); `vitest.config.ts` prepende `env-setup.ts` no
`setupFiles` antes do `setup.ts` existente. `dotenv@^16.6.1`
promovido de transitive (via `@sentry/webpack-plugin`) pra devDep
explícita — instalação em disco já existia, só o manifesto ficou
consistente.

Validação em 3 cenários dentro da worktree (sem `source` prévio,
env limpo via `env -i PATH=$PATH HOME=$HOME USER=$USER`):
- **Sem env file**: 693 passing / 10 failing / 172 skipped (875).
  9 test files falham no import por Zod (`DATABASE_URL` ausente etc).
  Comportamento correto — o fix carrega só se .env existe.
- **Só `.env` (dummies do `.env.example`)**: 741 passing / 6 failing /
  172 skipped (919). Bate 1:1 com o baseline "verde" documentado no
  P-41 (env dummy 100% consistente).
- **Só `.env.local` (paterna Fred, ANTHROPIC_API_KEY real)**: 741
  passing / 6 failing / 172 skipped (919). Idêntico ao cenário
  dummies — os 6 skipped em `communication-summary-errors` dependem
  de mock (não de key real).

Antes do fix, o cenário 2 e 3 SÓ dava 741 se o dev fizesse
`source .env.local` manual no shell antes. Agora Vitest carrega
automático da cwd. Type-check zero. Lint zero.

**Fecha P-43** — a variância 693/709/715/726/741 documentada no P-43
era só o baseline "verde" (741) sendo mascarado pela ausência de
`source` manual. Com o fix, todo dev/CI vê o mesmo número.

**Regra pós-fix (documentada em `CLAUDE.md` §Baseline atual):**
- CI sem env: 693 passing / 10 failing / 172 skipped (esperado —
  workflow tem que injetar env vars via `env:` do GH Actions)
- Dev com `.env.local` ou `.env` presente: 741 passing / 6 failing /
  172 skipped (6 dependem de `ANTHROPIC_API_KEY` real; passam com
  chave real)
- Precedence `.env.test → .env.local → .env` respeita convenção
  Next.js (Next carrega em ordem similar em `next dev`)

### P-48. Playwright browsers ausentes em worktree efêmera
**Severidade:** Baixa. Descoberto pelo QA automation report pós-P-42
em 2026-07-05.

Worktrees `git worktree add` não têm `~/.cache/ms-playwright`
populado. `npm ci` na worktree não roda `playwright install` porque
a lib está listada como devDep. E2E autônomo em chip fica BLOCKED.

**Fix sugerido:**
- Adicionar `scripts/bootstrap-worktree.sh` que roda `npm ci &&
  npx playwright install chromium`
- Alternativa: `postinstall` no `package.json` com `playwright
  install chromium` — mas afeta todos que fazem `npm install`
  (custo cross-cutting)

**Esforço:** ~30min. Não bloqueia CI (Playwright roda em job
dedicado).

### P-49. Integration tests skipam sem Postgres local em worktree
**Severidade:** Baixa (known trade-off). Descoberto pelo QA
automation report pós-P-42 em 2026-07-05.

4 tests de `opportunities-update.test.ts` + N tests de
`tests/integration/rbac.test.ts` e `tenant-isolation.test.ts`
pulam sem `DATABASE_URL_TEST`. Em worktree efêmera não há Docker
nem Postgres local — cobertura de `src/server/db/client.ts` cai
de ~85% pra 32.63%.

**Fix sugerido:** documentar em
`docs/Roteiro_QA_Homologacao_Staging.md` §5 que integration puro
só roda em CI com service Postgres; local exige
`docker-compose up postgres` (Fred tem docker desktop). NÃO mockar
Prisma — descaracteriza os testes.

**Esforço:** ~15min (só documental — decisão consciente).

### ~~P-44. Integration test de tRPC via caller (P-42 residual)~~ ✅ FECHADO 2026-07-05
Chip `claude/p44-caller-integration`. Fixture
`tests/integration/fixtures/authed-caller.ts` nova encapsula
`buildAuthedCaller({tenantId, role})` — cria user real no DB, popula
cache de permissions via `computeAndCacheUserPermissions`, monta
`Context` compatível com `appRouter.createCaller` e devolve helper
`run(fn)` que wrappa a call em `runWithTenant`. Isso exercita o path
completo Zod → RBAC (`withPermission` → `hasPermission` async) →
audit (`tenantIdOverride`) → Prisma extension → RLS, cobrindo o
mesmo caminho que UI/API chamam em prod.

**Refactor de `tests/integration/opportunities-update.test.ts`:**
4 casos originais P-42 (Prisma direto) migrados pra caller. O caso
"data.tenantId ≠ ctx dispara backstop" tornou-se "Zod strip protege
contra tenantId no payload" — via caller, Zod default-strip descarta
o campo extra ANTES de chegar ao backstop, então a defesa primária
é anterior. Backstop segue coberto por
`tests/unit/tenant-backstop.test.ts` (P-42 unit + P-45 array).

**Novos casos (7):**
1. `caller.opportunities.create` injeta tenantId do contexto
   automaticamente + escreve `opportunityStageHistory` inicial
2. `ANALISTA` sem `opportunity:read_others` só enxerga próprias
   opps em `caller.opportunities.list` (regressão spec §6.4)
3. `caller.opportunities.byId` cross-tenant retorna `NOT_FOUND`
   legível (não 500 cru)
4. `caller.opportunities.update` grava `audit_log` com
   `tenantId=ctx.tenantId` via `tenantIdOverride` (regressão bug
   `audit-trpc-context-loss`)
5. `DIRETOR_FINANCEIRO` sem `opportunity:update` recebe `FORBIDDEN`
   do `withPermission`
6. `DIRETOR_FINANCEIRO` com `opportunity:read` consegue `byId`
   (sanity — FORBIDDEN é procedure-específico, não vaza)
7. TRPCError propaga como instância real (não Error genérico)

**Roles cobertos:** ADMIN (60 permissions), ANALISTA (23 permissions,
sem `opportunity:read_others`), DIRETOR_FINANCEIRO (18 permissions,
sem `opportunity:update`).

**Testes:** 11 novos gated por `DATABASE_URL_TEST` (padrão do repo
desde Sprint 11). Sem a var, skipam. Baseline: **768 passing / 4
pré-existentes por env vars em `field-encryption` (idênticas
antes/depois via stash) / 179 skipped (172 baseline + 7 do
delta)**. Type-check zero. Lint zero.

**NÃO regride:** guard `describeIfDb = TEST_DB ? describe :
describe.skip` mantido — CI segue sem tocar. Rollback trivial
(reverter fixture + reverter test file). `src/` intacto.

**Débitos residuais:** ampliar cobertura pra outros routers (users,
companies, contacts, proposals) — registrar como P-73+ quando virar
prioridade. Fixture é reusável.

### ~~P-45. Auditar `createMany` no backstop (P-42 residual)~~ ✅ FECHADO
**Resolvido em 2026-07-05.** Refactor cirúrgico em
`src/server/db/client.ts`:

- **Função pura `assertTenantWritePayload`** ganhou branch pra array:
  quando `Array.isArray(payload)`, itera cada row identificando o
  índice em caso de bypass (`row 2 tenantId no payload difere do
  contexto`). Rows `null`/não-objeto são ignoradas defensivamente
  (Prisma vai rejeitar por outro caminho). Signature estendida de
  `Record<string, unknown> | undefined` pra `Record<string, unknown>
  | Record<string, unknown>[] | undefined`.
- **Extension `$allOperations`** agora inclui `'createMany'` no set
  de ops que disparam o backstop (linha ~156 do `client.ts`). A
  injeção de `tenantId` por row (linha ~132-137) continua sendo a
  defesa primária; backstop confirma em profundidade contra bypass
  explícito de caller.
- **Compat total:** semântica de `create`/`update`/`upsert` intacta,
  todos os 17 testes originais P-42 seguem passando. `createMany`
  com data única (não-array) segue semântica de `create`.

**Testes:** +8 novos em `tests/unit/tenant-backstop.test.ts` bloco
"createMany (P-45)":
1. Array 3 rows tenantId correto → OK
2. Array com row sem tenantId → erro com índice
3. Array com row tenantId ≠ ctx → erro com índice
4. Array vazio → OK
5. Payload undefined → OK
6. Array com null intercalado → ignora null, valida restantes
7. Array em op errada (create) → ignora defensivamente
8. Data única em createMany (não-array) → semântica de create

Total: **709 passing (baseline HEAD 693 - env vars) + 8 novos =
701 passing** no worktree com env vars sensitive; **741+8 = 749 pass**
esperado em env dummy consistente. Zero regressão (as 10 falhas
pré-existentes em field-encryption/rate-limiter/ai-pricing/document-compare/
summary-parser/communication-summary-errors são todas por env vars
ausentes, confirmadas idênticas no HEAD via `git stash`).
Type-check zero. Lint zero.

Débitos residuais **P-44** (caller tRPC) e **P-46** (map Error pra
TRPCError) continuam abertos.

### ~~P-46. Mapear `Error("[tenant-isolation] ...")` pra TRPCError~~ ✅ FECHADO 2026-07-05
Chip `claude/p46-error-mapping`. Middleware wrapper +
`errorFormatter` extendidos em `src/server/trpc/trpc.ts` reconhecem
o prefixo `[tenant-isolation]` do backstop de
`src/server/db/client.ts::assertTenantWritePayload` e convertem em
`TRPCError(INTERNAL_SERVER_ERROR)` com:
- `message` sanitizada (`TENANT_ISOLATION_PUBLIC_MESSAGE`, não vaza
  detalhe interno)
- `cause` preservado (Sentry + monitor middleware continuam vendo o
  erro original com stack)
- `data.tenantIsolation = { model, op, reason }` injetado pelo
  errorFormatter

`friendlyTrpcError` (P-21) reconhece `data.tenantIsolation` com
precedence sobre `zodError` e renderiza "Erro de isolamento de
dados. Reporte à equipe (modelo: X, operação: Y)." — apenas
metadata sanitizada, sem payload cru.

Parser puro em `src/lib/trpc/tenant-isolation-error.ts`
(`parseTenantIsolationMessage`) reconhece 2 razões:
- `missing_tenant_id` — payload sem `tenantId`
- `tenant_id_mismatch` — payload com `tenantId` ≠ contexto

15 testes novos em `tests/unit/tenant-isolation-error-map.test.ts`
(parser: 8 casos + friendlyTrpcError: 4 casos + errorFormatter
replay: 3 casos). Zero mudança em `src/server/db/client.ts` — só
mapping do lado tRPC conforme escopo. Baseline preservado:
**756 passing (+15 novos) / 6 pré-existentes por env vars em
`communication-summary-errors.test.ts` (idênticos ANTES do fix
via stash) / 172 skipped**. Type-check zero. Lint zero.

**Rollback:** trivial — reverter `src/server/trpc/trpc.ts` +
`src/lib/trpc/error-format.ts` e apagar
`src/lib/trpc/tenant-isolation-error.ts`. Comportamento pré-P-46
era "Unable to transform response from server" no browser mas
sem impacto funcional em rotas que já não disparam o backstop.

### ~~P-42. Backstop tenant-isolation quebra TODOS os `.update` de routers~~ ✅ FECHADO
**Resolvido em 2026-07-05.** Refactor cirúrgico em
`src/server/db/client.ts` extraindo a lógica do backstop em função pura
`assertTenantWritePayload(model, op, ctxTenantId, payload)` exportada, e
reformando a semântica: `create` continua exigindo tenantId no data
(defesa contra bypass explícito com tenantId ≠ contexto);
`update`/`upsert.update` deixam de exigir tenantId (WHERE injection já
protege — row alvo é imutável cross-tenant) e só bloqueiam quando o
payload declara um tenantId diferente do contexto (tentativa deliberada
de mover row cross-tenant). `ALLOW_MISSING_TENANT_ON_WRITE` eliminado —
agora que `update` genericamente aceita ausência de tenantId, a
allowlist redundava. Fluxo do bug (Fred no estágio Lead salvando
`meetingScheduledAt` + `meetingHappened`) agora passa limpo. Idem
`documents.create` (transação com update embutido) e `proposals.addVersion`
que Fred também viu quebrar em prod.

**Modelos afetados** (todos passam a funcionar sem tocar nos 57 call
sites):
- `Opportunity.update` — opportunities.ts:202, inbound.ts:261,
  partner-engagements.ts:113
- `Company.update` — companies.ts:106, 128, partners.ts:99
- `Contact.update` — contacts.ts:107, 129, 158
- `Product.update` — products.ts:59, 83
- `Proposal.update` — proposals.ts:103
- `Approval.update` — proposals.ts (decide)
- `PartnerEngagement.update` — partner-engagements.ts:113, 149
- `InboundLeadRejected.update` — inbound.ts (discard)
- `Document.update` — documents.ts:195 (side-effect em transação)

**Testes:** 17 novos em `tests/unit/tenant-backstop.test.ts` (função
pura + 8 modelos afetados via `it.each`) + 4 novos em
`tests/integration/opportunities-update.test.ts` (regressão do bug 500 +
update simples + 2 defesas cross-tenant). Integration skipa por padrão
sem `DATABASE_URL_TEST`. Baseline: 726 passing (+11 novos) / 6 failing
pré-existentes em `communication-summary-errors.test.ts` (env vars,
confirmado idêntico ANTES do fix via stash) / 172 skipped. Type-check
zero. Lint zero.

**Rollback:** trivial — reverter `src/server/db/client.ts`.

**Débitos residuais registrados:** P-44 (caller tRPC), P-45 (audit
`createMany`), P-46 (mapear Error pra TRPCError com friendlyTrpcError).

### ~~P-01. Fix `/companies` + `/contacts` CRUD 404~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `54dab90`.** Modal inline
para criar/editar empresa e contato; DetailSheet via intercepting
routes pro detalhe. CompanyForm também ganhou auto-fill via
CNPJ no chip `ff8cf85`. Sprint 15C reforçou com máscara visual
+ CEP auto-fill (commit `fa84be6`).

### ~~P-02. PageHeader em 13 rotas /admin restantes~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Refactor mecânico das 13 rotas
`/admin/*` pra usar `<PageHeader title description />` do design
system em vez de `<h1>` ad-hoc.

**Aplicado em 10 rotas (h1 → PageHeader):** `/admin/ai`,
`/admin/alerts`, `/admin/approval-rules`, `/admin/billing`,
`/admin/branding` (duas ocorrências — main + PlanComparisonUpsell),
`/admin/contracts`, `/admin/conversion-rates`, `/admin/email-inbound`,
`/admin/partners`, `/admin/templates`.

**Já estavam corretas (skip):** `/admin/listas`, `/admin/privacy`,
`/admin/products`, `/admin/users` — entregues por Sprint 15C ou
antes com PageHeader canônico.

**Detalhes:**
- Títulos e descrições seguem tabela sugerida no chip, com pequenos
  ajustes onde o contexto pedia (ex: `approval-rules` preservou
  descrição contextual "Cada nova versão de proposta passa por
  estas regras…" mais informativa que a genérica)
- `/admin/branding`: descrição da PageHeader concatena o plano
  dinamicamente (Growth/Enterprise). Banner de override WCAG
  preservado como div separado abaixo do header (com `-mt-2`
  compensando o `mb-6` do PageHeader)
- `/admin/partners`: link `/companies/new` movido pra parágrafo
  helper abaixo (description do PageHeader só aceita string)
- Zero `<h1>` residual nas 13 rotas (grep confirmado)

**Verificação:** 525 passing (baseline 525), type-check zero,
lint zero. Manual: dev server e as 13 rotas foram inspecionadas
visualmente — layout consistente com `/admin/users` referência.

**Débito adjacente identificado:** ~13 rotas fora de `/admin/*` (
`/platform/*` sidebar, `/reports`, `/pipeline`, `/companies`,
`/contacts`, etc.) podem ter o mesmo padrão. Auditoria separada.
Registrado como P-26.

### P-03. Visual baseline capturado
**Severidade:** Baixa. 🟡 do Sprint 14.5 item 9. Script
`scripts/visual-baseline.ts` existe. Procedimento em
`tests/visual/README.md`.

**Esforço:** ~1.5h. **Bloqueador:** depende app rodando local +
seed E2E.

### ~~P-04. Bug do audit log em outros sprints (não só theme.update)~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Refactor mecânico em 19 routers tRPC:
todas as 54 chamadas `audit({...})` sem `tenantIdOverride` receberam
`tenantIdOverride: ctx.tenantId,` como último campo. Arquivos tocados:
`activities`, `ai-config`, `alerts`, `approval-rules`, `companies`,
`contacts`, `contracts`, `documents`, `imports`, `inbox`,
`opportunities`, `partner-engagements`, `partners`, `privacy`,
`products`, `proposals`, `reports`, `users`. `search.ts` só tinha
comentário (`* Read-only, alto volume — NÃO chama audit()`),
skipado.

**Regressão:** `tests/unit/audit-context-loss.test.ts` novo com
4 cenários: (1) audit dentro de `runWithTenant` sem override usa
ALS, (2) contexto perdido + override grava com override — o fix,
(3) sem contexto e sem override descarta com warn (documenta o
bug histórico como assert), (4) override tem precedência sobre
contexto. Total 437 passing (baseline 433 + 4 novos), 2 skipped,
4 pré-existentes.

**Débito adjacente identificado:** services em `src/server/services/*`
que chamam `audit()` também podem estar afetados. Escopo desse
fix foi rigidamente `src/server/trpc/routers/*.ts` conforme spec.
Ver P-20 se levantamento aplicável for feito.

### P-05. Lighthouse audit em CI
**Severidade:** Média. 🟡 do Sprint 14.5 item 8. Script + workflow
prontos. Bloqueador: `vars.STAGING_URL` no GitHub Secrets.

**Esforço:** ~3h (quando staging existir).

### ~~P-06. Drilldowns AI por tenant (Sprint 15B residual)~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelos commits `b8b95b7` (tela 1) +
`27b5519` (tela 2).** Ver entrada completa mais abaixo.

### ~~Platform Owner setup~~ ✅ FECHADO
**Resolvido em 2026-06-30** após migration `0026_clerk_id_per_scope`:
- JWT Template Clerk inclui `platformRole`
- Public metadata do user Fred tem `platformRole: PLATFORM_OWNER`
- Seed `prisma/seed-platform.ts` rodado; criou 2ª row do mesmo
  Clerk ID com `tenantId=NULL, platformRole=PLATFORM_OWNER`
- Dual identity validada (1 row tenant marquezini + 1 row Platform)

### ~~P-11. Middleware não injetava headers Platform em dual identity~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `7d60192`.** Sintoma: usuário Fred com dual identity
(admin tenant marquezini + Platform Owner, mesmo `clerk_id`) abria
`/platform/dashboard` e via mensagem vermelha "Acesso restrito a
Platform Owners." Causa: `src/middleware.ts` no branch final (com
tenantId) injetava só `x-tenant-id`/`x-user-clerk-id`/`x-user-role`,
omitindo `x-platform-user-clerk-id`/`x-platform-role` mesmo quando
`platformRole=PLATFORM_OWNER` estava no JWT. `platformProcedure`
no tRPC enxergava `ctx.platformUser=null` → FORBIDDEN.

**Fix:** helper local `injectPlatformHeadersIfOwner(headers,
userId, platformRole)` chamado em paralelo aos headers tenant nos
2 branches relevantes (API sem tenant + branch final com tenant).
Idempotente, no-op quando `platformRole` é null. Tenant pure
(seeds acme/beta/gamma) não recebe headers Platform.

4 testes unitários novos em `tests/unit/middleware-auth.test.ts`
cobrindo: inject quando PLATFORM_OWNER, no-op quando null, no-op
em string inválida (ex: futuro `PLATFORM_SUPPORT`), e coexistência
com headers tenant existentes. Total 372 passing (368 baseline +
4 novos), zero regressão.

### ~~P-07. Migration pitfalls — lições aprendidas~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Memory `migration-pitfalls.md` criada
em `~/.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/`
com 5 padrões recorrentes de bugs em migrações Postgres (cast
enum_old[]→text[]→enum_new[], sanitizar antes de DROP enum,
partial UNIQUE pra coluna nullable, CHECK XOR + UNIQUE global =
bloqueio dual identity, NULLS NOT DISTINCT armadilha). Indexado
em `MEMORY.md`. Padrões referenciados diretamente pelo backend
Sprint 15A + 15F durante as migrations 0026, 0027 e 0028.

**Contexto original (referência histórica):**

Bug do `UNIQUE(clerk_id)` na migration
0016 (Sprint 15A) e bug do cast `_UserRole_old → _UserRole` direto
sem rota via `text[]` (descoberto durante deploy do 0016 também)
mostraram 2 padrões recorrentes em migrações de enum + arrays no
Postgres. Salvar memory `migration-pitfalls.md` com:

- Sempre fazer cast `enum_old[] → text[] → enum_new[]` (rota
  intermediária)
- Sanitizar VALORES inválidos no array ANTES do cast
- `NULLS NOT DISTINCT` em UNIQUE index falha se seed populou NULLs
  duplicados; preferir partial `WHERE col IS NOT NULL` pra colunas
  opcionais
- CHECK constraints em users do tipo XOR (tenant_id IS NOT NULL XOR
  platform_role IS NOT NULL) precisam de UNIQUE composta, não
  global

**Esforço:** ~30min (escrever memory). Recomendado pra evitar 4ª
ocorrência do mesmo padrão.

### ~~P-06. Drilldowns AI por tenant (Sprint 15B residual)~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelos commits `b8b95b7` (tela 1) +
`27b5519` (tela 2).** Backend do Sprint 15B (`platform.aiOps.byTenant`
e `platform.aiMarketplace.tenantAccess.*`) ficou sem UI drilldown até
agora. Entregue:

- **Tela 1 — `/platform/tenants/[id]/ai`** (`src/app/platform/tenants/[id]/ai/page.tsx`):
  header com nome do tenant + link "voltar". 5 seções empilhadas:
  (A) Métricas do mês (tokens/requests/custo) + progress bar quando
  `monthlyTokenLimit` configurado (verde <80% / âmbar 80-99% / vermelho ≥100%)
  + `<details>` colapsável com form de edição dos 5 campos de
  `tenant_ai_limits` (monthlyTokenLimit, dailyRequestLimit, pinnedModelHaiku,
  pinnedModelSonnet, anomalyThresholdMultiplier); (B) Breakdown por
  `(provider, model)` do mês em barras horizontais proporcionais;
  (C) Histórico diário — bar chart 30 pts + tabela com data/provider/model/
  reqs/tokens/custo; (D) Modelos pinados (Haiku + Sonnet); (E) Anomalias
  detectadas (últimas 20) com badge de tipo, detalhes de `today vs avg7d`
  e botão "Reconhecer" (dispara `acknowledgeAlert`).
- **Tela 2 — `/platform/tenants/[id]/ai/features`** (`src/app/platform/tenants/[id]/ai/features/page.tsx`):
  contador "N/M ativas" no header. Uma seção por `AiFeatureCategory`
  (Sumarização/Scoring/Busca/Classificação/Geração/Extração) com tabela:
  feature (name + description + code em fonte mono) / provider default /
  add-on R$/mês / status atual (badge Add-on/Incluída/Desativada) /
  `<Select>` para trocar entre 3 estados (dispara `tenantAccessSet`) /
  data de ativação do add-on quando aplicável.
- **Entrypoints** — 2 botões novos ("IA" e "Features IA") no header
  de `/platform/tenants/[id]/page.tsx`, ao lado de "Impersonar admin".
  Tela 1 tem link cruzado pra tela 2 no header e vice-versa.
- **RBAC** — ambas as telas rodam sob `platformProcedure` (router já
  gera 403 pra caller sem `platformRole=PLATFORM_OWNER`). Audit fica
  a cargo dos routers (`setLimits`/`acknowledgeAlert` no `aiOps`,
  `tenantAccessSet` no `aiMarketplace`), com `tenantIdOverride` já
  presente do Sprint 15B/P-04.

**Testes:** +12 em `tests/unit/platform-ai-drilldown.test.tsx` cobrindo
render (header + link voltar), empty states (breakdown/daily/anomalies
vazios), progress bar (aria-valuenow=40 pra 40k/100k), botão Reconhecer
dispara ackMutate, anomalia com `acknowledgedAt` esconde botão e mostra
badge Reconhecida, salvar limites parseia string vazia como null e
número inteiro correto, erro do `tenantById` gera `role=alert`. Screen
2: agrupamento por categoria, empty state, `onChange` do select
dispara `tenantAccessSet({tenantId, featureId, status})`, contador
"1/3 ativa" no header. Baseline 537 passing (+12 novos), 10 falhas
pré-existentes por env vars ausentes em field-encryption/rate-limiter/
ai-pricing/document-compare/summary-parser/communication-summary-errors,
2 skipped.

**Débitos residuais:** ver P-06-A abaixo.

### P-06-A. Pequenos débitos das telas P-06 (opcional)
**Severidade:** Muito baixa. Nada bloqueia o uso das telas, mas polish
opcional:
- Bar chart do histórico diário (tela 1 card C) é HTML puro. Se
  virar componente reutilizável (Sparkline), pode ir pra
  `src/components/ui/sparkline.tsx`.
- Tela 2 não expõe as colunas Sprint 15F em `tenant_ai_features`
  (providerOverride, modelOverride, fallbackProvider, costAlertBrlMonthly,
  apiKeyEncrypted). Router `tenantAccessSet` só aceita `status` + `notes`.
  Se a UI Sprint 15F em `/admin/ai` for adiada, faz sentido expor
  esses campos por tenant aqui também — mas depende da UI dos 4 Cards
  do Sprint 15F (P-23) ainda não implementada.
- Toast de sucesso quando `setLimits`/`tenantAccessSet` completa
  (hoje mostra "Limites atualizados." e nada, respectivamente).
  `ToastProvider` está disponível via `useToast`.

### ~~P-08. Logout missing no AppShell~~ ✅ FECHADO
**Resolvido em 2026-06-30** — `<UserButton afterSignOutUrl="/sign-in"/>`
do Clerk inserido no `Topbar` à direita do `ThemeToggle`. Dropdown
nativo do Clerk cobre Manage account + Sign out em todas as rotas
autenticadas.

### ~~P-09. Mensagem "IA indisponível" enganosa~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Backend separa erros reais por código
tRPC: `summarize` carrega a oportunidade primeiro e lança
`NOT_FOUND`/`PRECONDITION_FAILED`; `summarizeCommunication`
re-lança `FeatureNotAvailableError`/`AiLimitExceededError` (em vez
de engolir) e a procedure traduz pra `PRECONDITION_FAILED`/
`TOO_MANY_REQUESTS`. Falhas reais de provider (Anthropic 5xx/
timeout/circuit aberto) continuam caindo no payload com
`aiGenerated: false` — UI cai no modo manual. Frontend ganhou
prop `stageHasDirtyChanges`: bloqueia o botão antes da chamada
tRPC com mensagem "Salve a reunião antes de resumir com IA."
3 testes novos cobrindo provider 5xx vs feature gate vs limit.

### ~~P-10. Rename "CAMPOS DO ESTÁGIO ATUAL (LEAD)"~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Novo `src/lib/constants/pipeline-stages.ts`
com `STAGE_INTENT_LABEL` para os 7 valores do enum
`OpportunityStage`. Título do card no `/pipeline/[id]` mudou de
"CAMPOS DO ESTÁGIO ATUAL (X)" pra rótulo semântico
("Agendamento de reunião" em LEAD, "Briefing e qualificação" em
OPORTUNIDADE etc.) com sub-rótulo discreto "Estágio: X". Outras
telas (kanban column, breadcrumb, conversion-rates) seguem usando
`STAGE_LABELS` curto; os dois mapas são intencionalmente
separados. 3 testes novos validando cobertura completa do enum.

### ~~P-12. Modal rouba foco a cada keystroke~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Sintoma: em qualquer modal de criação/
edição (12 callers no app — `/platform/tenants`, `/companies`,
`/admin/users`, etc.), a cada tecla digitada o cursor pulava pro
primeiro input. Forms intestáveis.

**Causa raiz:** `src/components/ui/modal.tsx` linhas 34-63 tinha
`onClose` nas deps do `useEffect` que faz focus inicial + listener
de Tab trap/ESC. Callers passam `onClose={() => setOpen(false)}`
inline — cada render do parent (disparado por `setForm` a cada
keystroke) criava nova closure, mudando a identidade de `onClose`,
disparando o cleanup+setup do effect por completo, com
`focusables[0].focus()` roubando o foco.

**Fix:** capturar `onClose` em `onCloseRef` e remover das deps do
effect principal. Effect agora depende só de `[open]`, roda uma
única vez ao abrir e desmonta ao fechar. ESC continua funcionando
via `onCloseRef.current()`. Tab trap intacto.

**Escopo:** único arquivo modificado. Fix no `Modal` propaga
automaticamente pros 12 callers sem tocar em nenhum deles.

**Testes:** `tests/unit/modal.test.tsx` novo com 3 casos:
(1) re-render do parent com `onClose` inline não rouba foco do
input ativo — reproduz o bug via 5 re-renders forçados;
(2) ESC continua fechando o modal;
(3) Tab trap continua ciclando (Shift+Tab do primeiro → último,
Tab do último → primeiro). Baseline 378 → 381 passing.
Verificação cruzada: reverter só o modal.tsx faz o teste (1)
falhar, confirmando que ele captura o bug real.

### ~~P-14. IA usa env global em vez de key por tenant~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `a80564f`.** Sintoma: Fred
cadastrou chave Anthropic em `/admin/ai` (salva encriptada em
`tenants.ai_api_key_encrypted`), mas todo consumo de IA (resumo de
comunicação, comparação de docs, sugestão de conversão, etc.) saía
da conta da Plataforma via `env.ANTHROPIC_API_KEY`. Custo e rate
limit misturados entre tenants.

**Causa raiz:** `src/lib/ai/claude.ts` expunha só `getAnthropic()`
— singleton global sem contexto de tenant.

**Fix:** novo `getAnthropicForTenant(tenantId)` decripta
`aiApiKeyEncrypted` via `decryptField` e retorna client dedicado.
Cache Map com TTL 10min por tenant (evita re-decrypt em rajada, com
risco cross-tenant nulo). Fallback pra `env.ANTHROPIC_API_KEY` com
warn quando tenant sem key; throw claro apontando `/admin/ai` quando
ambos ausentes. Cache invalidado automaticamente quando Admin troca
a key via `ai-config.updateConfig`.

**Consumidores migrados (5):** communication-summary, document-compare,
conversion-rate-suggestion, semantic-search, email-link. `getAnthropic()`
legacy mantido como `@deprecated`.

**Testes:** `tests/unit/claude-per-tenant.test.ts` novo com 6 casos:
key do tenant usada, tenants distintos → clients distintos, cache
hit, fallback + warn, throw apontando /admin/ai, invalidate força
re-fetch. Total 387/393 passing (baseline 381 + 6 novos).

### ~~P-15. Mensagem "IA indisponível" engole erros estruturados~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `be5f244`.** Sintoma: quando a
conta Anthropic ficava sem créditos, HTTP 400 com corpo `{"error":
{"type":"invalid_request_error","message":"Your credit balance is
too low..."}}`. Service capturava como Error genérico → UI mostrava
"IA indisponível no momento" e o usuário ficava tateando.

**Causa raiz:** `communication-summary.service.ts` catch tratava só
`FeatureNotAvailableError`/`AiLimitExceededError`; qualquer outro
erro caía em `aiGenerated:false`. Ignorava `Anthropic.APIError` do
SDK que expõe `.status` e `.message` estruturados.

**Fix:** helper reusável `mapAnthropicError(err)` em
`src/lib/ai/anthropic-errors.ts` converte `Anthropic.APIError` em
`TRPCError` acionável:
 - 400 "credit balance" → `PRECONDITION_FAILED` com link
   `https://console.anthropic.com/settings/billing`
 - 402 → `PRECONDITION_FAILED` "sem créditos"
 - 401/403 → `UNAUTHORIZED` "chave inválida, atualize em /admin/ai"
 - 429 → `TOO_MANY_REQUESTS` com header retry-after se presente
 - 5xx → `null` (mantém fallback silencioso + circuit breaker)

**Escopo:** aplicado nos 3 serviços user-facing (communication-summary,
document-compare, conversion-rate-suggestion). email-link (background
worker) e semantic-search (degrade gracioso) seguem no fallback
silencioso — sem UI aguardando resposta.

**Testes:** +5 casos em `communication-summary-errors.test.ts`
(400 credit, 401, 429 sem/com retry-after: 30, 5xx silencioso).
Instancia `Anthropic.APIError` direto (sem mock HTTP). Total
392/398 passing.

### ~~P-16. Busca global (Command Palette ⌘K) sem handler~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Sintoma: botão "Buscar…" com atalho
`⌘K` visível na Topbar em toda rota autenticada (linhas 67-77 de
`src/components/layout/Topbar.tsx`), mas era `<button>` sem
`onClick` — placeholder morto desde o Sprint 14.

**Fix:**
- Router tRPC novo `src/server/trpc/routers/search.ts` com
  procedure `global` (Zod input `{query: min 2, max 100}`) que
  retorna 4 buckets (companies/contacts/opportunities/users),
  top 5 cada, via `ILIKE '%q%'` no Prisma. Tenant isolation via
  `WHERE tenantId = ctx.tenantId` explícito. RBAC gracioso: user
  sem `<entity>:read` recebe array vazio no bucket (não erro
  global). CNPJ tolera máscara (extrai dígitos antes do LIKE).
- Fica sob a key tRPC `search` mesclada com `searchNaturalRouter`
  do Sprint 6 (semantic query) — cliente consome como
  `trpc.search.global` e `trpc.search.natural` sem confusão.
- Componente `src/components/search/CommandPalette.tsx` — overlay
  standalone (não usa `<Modal>` pra evitar conflito entre
  Tab-trap + navegação por setas). Debounce 200ms via setTimeout,
  ↑/↓ movem highlight, Enter navega, ESC fecha, clique também
  navega. Empty/loading/hint states. RBAC parcial vira bucket
  omitido no render (sem heading nem lista).
- Roteamento por bucket: `companies` → `/companies/<id>`,
  `contacts` → `/contacts/<id>`, `opportunities` → `/pipeline/<id>`,
  `users` → `/admin/users` (sem tela de detalhe — abre a lista).
- `Topbar.tsx` — botão ganhou `onClick={setPaletteOpen(true)}` +
  atalho global via `useEffect` que escuta `(Cmd|Ctrl)+K` no
  `document` (respeitando `HIDDEN_ON` das rotas públicas).

**Escopo:** 2 arquivos novos (router + componente) + 3
modificações mínimas (`_app.ts` merge, `inbox.ts` rename export,
`Topbar.tsx` wire). Sem migration, sem mudança em RBAC catálogo.

**Testes:** 18 novos.
- `tests/unit/search-router.test.ts` (9): Zod input rejeita
  query <2/>100 chars, extrai dígitos-only pra LIKE de CNPJ,
  não roda LIKE de CNPJ sem ≥2 dígitos, RBAC parcial vira
  bucket vazio.
- `tests/unit/command-palette.test.tsx` (9): não renderiza
  fechado, input recebe foco, hint <2 chars, ESC → onClose,
  empty state, resultados agrupados por bucket com heading,
  setas ↑/↓ movem highlight + Enter navega, skeleton loading
  visível, href correto por bucket (opportunity → /pipeline/).
- Baseline 381 → 399 passing. Mesmas 4 falhas pré-existentes
  (env vars ausentes em field-encryption/rate-limiter/ai-pricing/
  document-compare/summary-parser) + 2 skipped seguem iguais.

**Débito residual → novo P- futuro:** fuzzy match / typo tolerance
+ tsvector PT-BR pra full-text search. `ILIKE '%q%'` é suficiente
enquanto tenant tem <100k contatos. Escala vira P-XX se surgir
demanda.

### ~~P-17. Tabelas sem ordenamento clicável~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelos commits `e269325` (infra) +
`7e4949f` (rollout).** Sintoma: as 8 tabelas do app mostravam
dados na ordem que o backend devolveu. Clicar no header não
fazia nada.

**Causa:** `src/components/ui/table.tsx` — `TH` era wrapper mudo
de `<th>` sem prop `sortable`. Consumidores mostravam apenas
título sem controle de ordem.

**Fix:**
1. **`src/components/ui/table.tsx`** — `TH` ganhou `sortable`,
   `sortState`, `onSort`. Chevron dupla (null), single up (asc),
   single down (desc). `aria-sort`, `role="columnheader"`,
   `tabIndex={0}`, Enter/Space dispara `onSort()`. Focus ring
   Venzo. Comportamento sem `sortable` inalterado — não regride
   consumidores existentes
2. **`src/lib/hooks/useTableSort.ts`** — Hook com toggle
   asc → desc → null (volta ordem original). Null-safe
   (null/undefined ao fim em asc, ao início em desc). Strings
   usam `localeCompare('pt-BR', {sensitivity:'base', numeric:true})`.
   Accessor pode ser `keyof T` OU função pra valor computado
   (ex: `(t) => t._count.users`). Helpers puros expostos
   (`compareSortValues`, `resolveValue`, `nextSortState`) para
   testabilidade sem `@testing-library`
3. **`src/lib/trpc/client.ts`** — expõe `RouterOutputs` via
   `inferRouterOutputs<AppRouter>` para tipar linhas nas pages
   sem redeclarar

**Rollout aplicado em 7 tabelas + 1 lista de cards:**
- `/companies`: Razão social, Tipo, CNPJ, Cidade/UF
- `/contacts`: Nome, E-mail, Cargo, Área, Relacionamento
- `/admin/users`: Nome, E-mail, Papel, Último login, Status
- `/admin/products`: Nome, Tipo, SKU, Margem mín., Status
- `/admin/partners`: card list — select "Ordenar por" (Nome,
  Comissão, Contratos abertos), mesma matemática via helpers
  puros. Não é tabela; conversão pra tabela seria mudança maior
  fora do escopo P-17
- `/platform/tenants`: Nome, Plano, Status, Users, Opps, Criado
- `/platform/trials`: Tenant, Source, Termina em, Setup,
  Estendido

`/contacts`, `/admin/users` e `/admin/products` também migradas
de raw HTML `<table>` para `Table/THead/TH/TR/TD` do design
system Venzo por consistência visual.

**Testes:** 23 novos (15 em `use-table-sort.test.ts` cobrindo
helpers puros; 8 em `table-th-sortable.test.tsx` cobrindo
click/keyboard/aria-sort/chevrons via react-dom + act).
Baseline 381 → 404 passing. Type-check zero. Lint zero.

**Fora do escopo (registrar como P-18 se necessário):**
- Dashboard não tem `<table>` — usa `<ul>` de alertas
- Outras tabelas platform (`/platform/audit`, `/platform/broadcasts`,
  `/platform/ai-marketplace`, `/platform/ai-ops`, `/platform/privacy`)
  usam design-system Table mas não estavam listadas na P-17;
  aplicar em rollout separado se pedido
- Server-side sort para listas > 200 rows — nenhuma detectada
  neste rollout; adicionar `sortBy`/`sortDir` na query tRPC
  quando surgir

### ~~P-23. Sprint 15F — UI `/admin/ai` (4 Cards)~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelos commits `17ef181` + `26833ac`.**
Backend do Sprint 15F já expunha todos os procedures em
`aiConfig` (`updateConfig`, `listFeatures`, `updateFeature`,
`testKey`, `breakerStatus`, `clearCircuitBreaker`,
`monthlyUsage`). Faltava só a UI que consome. Refactor completo
de `src/app/admin/ai/page.tsx` em 4 cards:

- **Card A** — Configuração padrão do tenant: provider, modelo e
  chave global; botão "Testar chave" chama `aiConfig.testKey` e
  mostra latência/erro sem expor a chave.
- **Card B** — Features de IA: tabela agrupada por
  `AiFeatureCategory` (Resumos, Scoring, Busca, Classificação,
  Geração, Extração). Cada linha mostra provider/modelo
  efetivos, marca "padrão" quando herdado, badge de status
  (Ativa/Add-on/Desativada), estado da chave (Custom/Herdada)
  e fallback configurado. Clique na linha abre modal com trinca
  provider/modelo/chave própria + trinca fallback + alerta de
  custo mensal. Testar chave por-feature reusa o mesmo procedure.
- **Card C** — Uso e custo: total de tokens + custo USD do mês
  corrente + breakdown por (provider, modelo) via
  `aiConfig.monthlyUsage`. Breakdown primary vs fallback fica de
  fora (débito residual — precisa novo procedure agregando
  `ai_usage_logs.used_fallback`).
- **Card D** — Alertas: pura em
  [src/lib/ai/admin-alerts.ts](../src/lib/ai/admin-alerts.ts).
  Regras: (1) provider com circuit aberto → 🔴 com botão
  "Limpar" que dispara `AlertDialog` → `clearCircuitBreaker`;
  (2) feature ativa sem chave própria E tenant sem chave global
  → 🔴 sem-chave. Refinamentos futuros: fallback frequente e
  custo acima do threshold.

Testes: +16 novos — `admin-ai-alerts.test.ts` (10 casos cobrindo
matriz de combinações CIRCUIT_OPEN × MISSING_KEY, DISABLED
suprime, ADDON_ACTIVE dispara, IDs únicos) e
`admin-ai-page.test.tsx` (6 casos smoke com trpc mockado). Total
541 passing / 10 falhas + 2 skipped pré-existentes por env vars.
Type-check zero. Lint zero.

**Débitos residuais registrados aqui:**
- Card C sem breakdown primary vs fallback (precisa procedure novo
  em `aiConfig.monthlyUsageByFallback` ou expor `used_fallback`
  no `monthlyUsage` atual).
- Alerta "feature caiu em fallback N vezes em 24h" e "custo acima
  do threshold" — requerem query em `ai_usage_logs`.
- Chave viaja plaintext no wire tRPC (encrypt server-side em
  `updateConfig`/`updateFeature`). MVP aceitável — HTTPS obrigatório
  em produção. Melhoria: encrypt-in-client com pubkey por tenant.

### P-24. Sprint 15F — UI `/platform/ai-marketplace` form adiada
**Severidade:** Média. Backend
`platform.aiMarketplace.setFeature` aceita edit de
`defaultProvider`/`defaultModel`, mas o form "Adicionar feature
nova" na UI Platform Owner não foi entregue. Feature nova precisa
INSERT direto no banco.

**Esforço:** ~0.5 dia.

**Status:** ✅ FECHADO em 2026-07-01 (commit `84e6f56`
`feat(platform): add feature form in ai-marketplace (P-24)`). Backend adicionou mutation `createFeature` em
`src/server/trpc/routers/platform-ai-marketplace.ts` com Zod
validando code kebab-case (regex `/^[a-z0-9-]+$/`), name,
description, category/provider como `nativeEnum`, defaultInclusion
como shape `{TRIAL, STARTER, PRO, ENTERPRISE} × disabled|included|
addon` (alinhado ao seed 0018), addonPrices nullable. CONFLICT em
code duplicado. `platformAudit` com `after` populado. Frontend
adicionou botão "+ Nova feature" no PageHeader + `<Modal size="lg">`
com form completo (fieldset de 4 selects de inclusão por plano,
`<Textarea>` de descrição, 2 inputs de preço opcionais).
`friendlyTrpcError` (P-21) traduz Zod. `onSuccess` invalida list e
reseta form. Testes: +14 novos em
`tests/unit/platform-ai-marketplace-create.test.ts` (7 validação
Zod + 5 persistência + 2 RBAC). 563 passing / 4 falhas + 2 skipped
pré-existentes por env vars. Type-check zero (nas mudanças). Lint
zero. Escopo intencionalmente estreito — não implementa delete de
feature (spawn de novo débito se necessário) nem edit inline dos
campos já cobertos pelo `setFeature` (active/addonPriceBrlMonthly/
defaultProvider/defaultModel).

### P-25. Sprint 15F — Rollout em produção pendente
**Severidade:** Alta (bloqueia validação real). Migrations 0027 e
0028 aplicadas em Neon dev em 2026-06-30 ✓. Falta:
- Aplicar migrations em Neon produção
- Ativar `MULTI_AI_ENABLED=true` pro tenant Fred (marquezini)
  por override em `tenants.multi_ai_enabled` OU env global
- Monitorar 3-5 dias `ai_usage_logs` (usedFallback, configured_provider)
- Expandir pra 2-3 early adopters Enterprise
- 30 dias sem regressão → flag global `true` em produção

### ~~P-26. PageHeader em rotas fora de `/admin` e `/platform`~~ ✅ FECHADO
**Resolvido em 2026-07-01.** Refactor mecânico substituindo `<h1>` +
descrição ad-hoc por `<PageHeader title description />` (do design
system) em 6 rotas:

- `/pipeline` — title "Pipeline", description "Oportunidades por
  estágio no funil de vendas.", primaryAction "+ Nova oportunidade"
- `/inbox` — title "Inbox", description "E-mails recebidos aguardando
  triagem.", secondaryAction link "Configurar endereço →"
- `/contacts` — title "Contatos", description "Pessoas relacionadas
  às empresas cliente."
- `/imports` — title "Importações", description "Importar empresas
  e contatos de CSV/XLSX."
- `/more` — title "Mais", description "Configurações e ferramentas
  adicionais."
- `/reports` — title "Relatórios", description "Análise de conversão,
  performance e forecast.", secondaryAction link "↓ Exportar Excel"

`/pipeline/[id]` **skipado por design**: o header atual é uma unidade
contextual rica (título dinâmico + razão social do cliente + valor
em destaque + badges de estágio/status + botões de ação avançar/
voltar/cancelar). Aplicar `PageHeader` degradaria a UX — perderia
o layout right-aligned do valor e badges. Consistência não vale
regressão; mantido o padrão do Sprint 14.

`/dashboard` mantido por design (saudação "Bom dia, X." do Sprint
14). Rotas públicas (`/`, `/sign-in`, `/sign-up`, `/onboarding`,
`/privacy`, `/terms`, `/privacy-request`, `/p/*`) têm layout
dedicado sem AppShell — não recebem `PageHeader`.

Baseline mantido: 561 passing / 10 pré-existentes (env vars) /
2 skipped. Type-check zero. Lint zero.

### P-27. `/api/v1/inbound/email` estender pra criar Lead novo
**Severidade:** Média. Registrado ao fechar Sprint 15D.

Sprint 6 (Sprint 15D preservou) trata email inbound como Activity
vinculada à opp existente via `emailLinkService.link`. Spec §7.2
sugeria estender: se `parseLead` reconhece um lead novo (não é
correspondência de opp existente), enfileirar no
`inboundLeadQueue` em vez de vincular como atividade.

Escopo:
- Detectar sender NÃO conhecido (grep em `contacts`)
- Rodar `parseLead` → se confidence ≥ 0.7 e contact.email/company.cnpj,
  enfileira criar opp inbound
- Senão manter comportamento antigo (IncomingEmail + tryAutoLink)
- Guardar bit `converted_to_lead_at` em `incoming_emails` pra evitar
  reprocessamento

**Esforço:** ~1 dia. Depende de decisão de produto (Sprint 6 comportamento
"linka" é preservado por default — sem breaking change hoje). Vale a
pena quando cliente pedir "recebi 1 email num endereço novo, virou
lead automaticamente".

### P-28. Integrações nativas (RD Station / HubSpot / Typeform / LinkedIn)
**Severidade:** Média. Registrado ao fechar Sprint 15D.

Webhook custom + Zapier cobre 80% dos casos. Integrações OAuth
diretas viram chip de sustentação dedicado quando cliente pedir.
Priorizar por demanda:

| Integração | Cliente típico | Esforço |
|---|---|---|
| RD Station (OAuth + Webhook nativo) | empresas BR de mkt B2B | ~3d |
| HubSpot Forms (OAuth + Workflows) | stack HubSpot | ~3d |
| Typeform direto (sem Zapier) | landing pages premium | ~2d |
| LinkedIn Lead Gen Forms (Marketing API) | adv pago LI | ~4d |
| Pipedrive Forms | empresas migrando | ~2d |
| Mautic (self-hosted) | empresas técnicas | ~2d |

### ~~P-29. Rate limit por sender em lead inbound~~ ✅ FECHADO 2026-07-05

**Fix:** `SENDER_INBOUND_LIMIT = { limit: 10, windowSeconds: 60 * 60 }`
+ helper `senderInboundKey(tenantId, email)` em `rate-limiter.service.ts`.
`createInboundLead` chama `checkRate(senderInboundKey(...), ...)`
após o gate de confidence e antes de resolver company/contact.
Quando `!allowed`, grava em `inbound_leads_rejected` com
`reason='rate_limited_per_sender'` e retorna sem tocar DB pesado.

Key inclui `tenantId` (isolamento cross-tenant) e email lowercased
(case-insensitive). Lead sem `contact.email` pula o gate (pattern
preservado — parser exige email OU cnpj).

**Complementa** `PUBLIC_FORM_LIMIT` do endpoint público (Sprint 11):
IP capa transporte, sender capa origem. Redis fail-open igual ao
resto do rate-limiter (Cloudflare WAF em prod é 2ª linha).

+9 testes em `tests/unit/inbound-rate-limit-sender.test.ts`
(primeiro lead OK, 10º OK, 11º rejected, emails distintos =
keys distintas, tenants distintos = keys distintas, case-insensitive,
lead sem email pula o gate, shape do helper, formato da key).
Baseline: 777 passing (+9) / 4 pré-existentes por env vars
(field-encryption) / 172 skipped. Type-check zero. Lint zero.

### ~~P-30. UI de revisão de `inbound_leads_rejected`~~ ✅ FECHADO 2026-07-05

**Resolvido em 2026-07-05** (chip `claude/p30-rejected-review`).

Tela dedicada `/admin/inbound-rejected` com filtro por motivo/status,
raw payload viewer, promoção manual (bypassa confidence + blacklist),
retry de parser (útil pós-upgrade do prompt IA) e descarte.

**Backend:**
- `inbound-lead-creator.service.ts` — `CreateInboundLeadInput` ganhou
  campos opcionais `preParsed?: ParsedLead` (pula `parseLead`, evita
  consumo IA) e `forcePromoted?: boolean` (bypassa checks de blacklist
  E confidence). Path legado (sem os dois) inalterado. Endpoints
  públicos webhook/email **não expõem** essas flags — só o router tRPC
  usa via `rejectedPromote`
- `inbound.rejectedList` estendido com filtro opcional `reason` (enum
  com 6 valores). Match especial: `reason: 'parse_error'` casa qualquer
  variante `parse_error:<Error.name>` (persistido com colon suffix
  pelo service). Backward-compat: consumer existente `{take:30}` segue
  funcionando
- `inbound.rejectedPromote` (canConfigure) — reconstrói `ParsedLead`
  de `parsedJson` (confidence virou string no JSON encoding, cast pra
  number), chama `createInboundLead` com `forcePromoted:true`, marca
  como `promoted` + reviewedById + reviewedAt, audit com
  `tenantIdOverride`. BAD_REQUEST se status ≠ pending ou parsedJson=null
- `inbound.rejectedRetryParser` (canConfigure) — re-executa `parseLead`
  com versão atual, retorna preview `{parsed, wouldPromote}` sem
  alterar o registro. Audit da tentativa

**Frontend:**
- `/admin/inbound-rejected/page.tsx` novo — PageHeader + 2 selects
  (motivo, status), lista expansível de cards. Card colapsado: badges
  reason/source/status + confidence % + data. Card expandido: `<pre>`
  scrollable do raw payload + parsed JSON lado a lado (grid md:2col),
  3 botões (Promover / Retry parser / Descartar), preview do retry
  inline quando dispara. `AlertDialog` (design system, não `confirm()`)
  em promover e descartar. Toast success/error via `useToast` +
  `friendlyTrpcError`
- `Sidebar.tsx` — item "Inbound rejeitados" novo em Admin com
  `IconInbox` e gate `permission: 'inbound:configure'`

**Testes:** +24 novos.
- `tests/unit/inbound-rejected-router.test.ts` (17 casos) — filtro por
  reason (4 casos incluindo startsWith em parse_error), promoção
  (5 casos: bypass confidence+blacklist via forcePromoted, BAD_REQUEST
  em parsedJson=null e status≠pending, cross-tenant NOT_FOUND, service
  devolve rejected → INTERNAL_SERVER_ERROR), retry (5 casos:
  wouldPromote true/false/null, cross-tenant, parseLead throw), RBAC
  (3 casos FORBIDDEN em promote/retry/list)
- `tests/unit/inbound-force-promoted.test.ts` (6 casos) — service com
  Prisma mockado: sem force+lowConf → rejected, com force+lowConf →
  created, sem force+blacklist → rejected, com force+blacklist →
  created, preParsed pula parseLead, path legado sem preParsed preservado
- `tests/unit/inbound-router-shape.test.ts` — +1 caso confirmando as
  novas procedures expostas

**Baseline:** 840 passing (+24 novos, base 816) / 0 failing / 172
skipped (1012 total). Type-check zero. Lint zero. Rollback trivial
(reverter 5 arquivos + apagar 2 testes + apagar `/admin/inbound-rejected/`).

**Débitos residuais:** nenhum. Batch retry-all e auto-promote em
background NÃO implementados por design — ação deve ser humana e
individual (evita spam creation).

### ~~P-31. Push nativo pro vendedor quando alocado (mobile)~~ ✅ FECHADO 2026-07-05

**Resolvido em 2026-07-05** (commit desta branch).

`inboundRouter.assignInbound` agora dispara `sendPushToUser` em
paralelo à alocação (best-effort — falha não desfaz a alocação).
Mudanças cirúrgicas em `src/server/trpc/routers/inbound.ts`:

- Query `opp = findFirst` estendida com `clientCompany: { select:
  { razaoSocial: true } }` para compor o body da push
- Após o `audit()`, dispara `void sendPushToUser(input.ownerId,
  {title, body, url}).catch(...)` — fire-and-forget com
  `.catch(console.warn)` pra não propagar rejection
- Título: "Novo prospect atribuído"
- Body: `${razaoSocial ?? 'Empresa'} — comece a qualificação.`
- URL: `/pipeline/${opp.id}`
- Import novo de `sendPushToUser` do
  `@/server/services/push-sender.service` (Sprint 10)

Data masking N/A — payload de push tem só razão social
(informação comercial, não PII sensível).

**Testes** (`tests/unit/inbound-assign-push.test.ts` novo, 5 casos):
1. Alocação bem-sucedida dispara push com args esperados
2. Push falha (mock throw) → mutation ainda retorna sucesso +
   console.warn com prefixo `[inbound.assignInbound] push falhou`
3. Cross-tenant: opp de outro tenant → NOT_FOUND, push NÃO chamada,
   audit não chamado (regressão P-42 preservada; `findFirst` filtra
   por `tenantId: ctx.tenantId`)
4. `clientCompany` nulo → fallback "Empresa" no body
5. Vendedor inativo → BAD_REQUEST, sem update, sem push

Padrão de mock (padrão `tasks-router.test.ts` P-20): Prisma spy
via `vi.mock('@/server/db/client')`, permissions.service com
`hasPermission: async () => true`, audit + push como spies com
`vi.fn()`. `flushMicrotasks()` (setImmediate) garante que o
`.catch` do fire-and-forget rode antes das assertions.

**Baseline:** 728 passing (baseline pré-P-31 = 723 + 5 novos) /
10 pré-existentes por env vars em `field-encryption` (4) +
`communication-summary-errors` (6) — confirmado idêntico ANTES
via `git stash` / 172 skipped. Type-check zero. Lint zero.
Rollback trivial (reverter `inbound.ts` + remover test file).

### ~~P-32. 🔒 Rotacionar senha do Neon staging (compartilhada no chat)~~ ✅ FECHADO 2026-07-04

**Resolvido em 2026-07-04.** Rotação executada (3 tentativas —
duas primeiras vazaram novamente durante troubleshooting: awk
com regex ambíguo imprimiu URL completa; usuário compartilhou
senha antiga tentando debugar formato). Todas as senhas
comprometidas foram queimadas antes do fechamento.

**Ação executada:**
1. ✅ Neon dashboard → Roles → reset password no `neondb_owner` (3x)
2. ✅ `DATABASE_URL` atualizada no `.env.local` local (BBEdit save)
3. ✅ `vercel env rm DATABASE_URL production` + `vercel env add DATABASE_URL production`
4. ✅ `vercel --prod` redeploy sem erros
5. ✅ Validação: `curl https://crm-app-pi-eight.vercel.app/api/v1/health`
   retornou `{"status":"ok","checks":{"app":"ok","db":"ok","dbLatencyMs":2457}}`
   — HTTP 200 confirma app + banco funcionando com credenciais novas

**Débitos adjacentes registrados como memory permanente:**
- `feedback_never_parse_secrets.md` — nunca fazer awk/sed/regex em
  linha com secret embutido; incidente 2026-07-04 vazou senha via
  regex ambíguo. Rev 2 acrescentou proibição de `xxd`/`hexdump`
  em linhas com secret.

**Hardening pra próximo incidente (não bloqueia):**
- Considerar migrar dev pra Neon branch dedicada com role isolado
  (não compartilhar `neondb_owner` entre staging e production)
- Registrar em runbook procedimento visual passo-a-passo do Neon UI
  (screenshot dos botões Connect vs Reset — Fred perdeu tempo
  procurando)

**Tempo real:** ~1h (esperado ~10min). Overhead veio de 2 vazamentos
adjacentes + copy/paste truncado no primeiro reset.

**Esforço:** ✅ Concluído.

### P-33. Vercel CLI outdated (54.18.7 → 54.20.1) — ✅ FECHADO 2026-07-04
**Severidade:** Baixa. Não bloqueia deploy, só otimiza (novos
recursos agentic + performance).

**Ação:** `npm i -g vercel@latest` (ou `pnpm add -g vercel@latest`).

**Resolução:** upgrade global aplicado — `vercel --version` retorna
`Vercel CLI 54.20.1`. Nada no repo mudou (só o binário local do dev).

**Esforço:** ~30s.

### ~~P-34. Clerk dev instance atrasa propagação de public_metadata~~ ✅ FECHADO
**Resolvido em 2026-07-04 (documental).** Criado
[`docs/Runbook_Staging.md`](Runbook_Staging.md) novo com seção
"Cai em /onboarding após primeiro login" documentando o delay
de ~30s do Clerk dev instance e a mitigação (aguardar / sign
out + sign in). Seção "Troubleshooting comum" adicionada em
[`DEPLOY_Vercel_Guide.md`](DEPLOY_Vercel_Guide.md) espelha o
sintoma pro guia técnico.

Sprint 16 mantém prevista a migração pra Clerk production
instance como parte de hardening; enquanto isso, dev instance
segue suficiente pro roteiro do PO.

### P-35. 📊 Sentry + Axiom wiring — ✅ FECHADO em 2026-07-04
**Severidade:** Média (agora zerada).

**Entregue:**
- `@sentry/nextjs` já estava instalado — configurado via
  `sentry.client.config.ts` + `sentry.server.config.ts` +
  `sentry.edge.config.ts` (root do repo) + `instrumentation.ts`
  (Next.js 14 hook). `next.config.mjs` wrapped com
  `withSentryConfig` (silent, widenClientFileUpload, hideSourceMaps,
  disableSourceMapUpload quando SENTRY_AUTH_TOKEN ausente).
- `@axiomhq/js` + `@axiomhq/nextjs` adicionados. Logger em
  `src/lib/monitoring/axiom.ts` com no-op sem AXIOM_TOKEN/DATASET
  + categorias tipadas: `logAudit`, `logAiUsage`, `logWorkerJob`,
  `logTrpc` + helper `flush()`.
- Helpers em `src/lib/monitoring/sentry.ts` com `captureException`,
  `captureMessage`, `addBreadcrumb`, `withScope`, `shouldReportTrpcError`
  — todos no-op quando `Sentry.getClient()` undefined (sem DSN).
- **Instrumentação aplicada:**
  - `audit.service.ts` — breadcrumb no sucesso, exception no erro,
    log Axiom nos dois casos
  - `ai-usage.service.ts` `logAiUsage()` — log Axiom com costBrl
    derivado (USD_BRL_RATE), provider/fallback/latência
  - `jobs/queues.ts` `makeWorker()` — wrap universal com Axiom
    `logWorkerJob` (durationMs/ok/error) + Sentry captureException,
    tenantId auto-extraído do payload quando presente
  - `trpc.ts` — middleware `monitor` novo, aplicado em
    `protectedProcedure` e `platformProcedure`. Loga procedures no
    Axiom; Sentry só captura INTERNAL_SERVER_ERROR (não FORBIDDEN/
    UNAUTHORIZED/PRECONDITION_FAILED). Queries só logadas quando
    falham a menos que `AXIOM_LOG_QUERIES=true`.
  - `dispatch.ts` `dispatchChat()` — breadcrumb por feature code
  - `api/trpc/[trpc]/route.ts` onError — defense-in-depth
- Env vars documentados em `.env.example` (via `src/lib/env.ts`):
  `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ENVIRONMENT`,
  `AXIOM_TOKEN`, `AXIOM_DATASET`, `AXIOM_LOG_QUERIES`
- `docs/Observability.md` novo: setup Sentry + Axiom + alertas
  recomendados (5 queries APL) + runbook por alerta + política
  anti-PII
- Testes: `tests/unit/monitoring-sentry.test.ts` (+13) e
  `monitoring-axiom.test.ts` (+13). Baseline preservado
  (falhas pré-existentes por env vars ausentes não regridem).

**Fora do escopo (mantido para hardening futuro):**
- Alertas configurados em Sentry/Axiom UI — decisão de infra do
  Fred. Doc lista os 5 monitores APL prontos pra colar.
- OpenTelemetry — Sentry+Axiom já cobrem MVP; nenhum ganho claro.

### P-36. ⏰ Workers BullMQ não estão rodando
**Severidade:** 🔴 Alta (features degradadas silenciosamente).
Redis conectado (Upstash), queues criadas — mas nenhum processo
consumindo. Vercel serverless não sustenta long-running workers.

**Features impactadas:**
- `alerts-scan` (07:00 BRT) — alertas diários de relacionamento
  e pipeline não disparam
- `ai-usage-rollup` (00:30 BRT) — agregação diária pra `/platform/ai-ops`
  não roda; dashboard cross-tenant fica desatualizado
- `health-score-rollup` (02:00 BRT) — snapshots `/platform/health`
  não atualizam; buckets RED/YELLOW/GREEN congelam
- `email-send` — reação em fila mas nenhum destinatário
  recebe. Impacta convites Clerk (redundante) e alertas
- `import-run` — importações CSV ficam pending pra sempre
- `inbound-lead-create` — leads inbound acumulam na queue,
  nunca viram opportunities

**Opções de fix:**
1. **Worker separado no Railway/Render** (recomendado, ~R$50/mês)
   — processo Node.js dedicado rodando `npm run worker`. Docker
   image pronta; só configurar env vars (mesmo Neon + Redis do
   Vercel).
2. **Vercel Cron Jobs pra cada worker** — troca BullMQ por
   handlers HTTP disparados por cron. Requer refactor pesado
   (~5 dias). Perde durabilidade da queue (retry, backoff).
3. **Upstash QStash** — plataforma de queue serverless da Upstash
   com handlers HTTP. Migração ~2 dias.

**Recomendação:** Opção 1 no curto prazo (staging pra PO) e
avaliar migração pra QStash como decisão de Sprint 16.

**Esforço:** ~2h pra subir worker no Railway.

**Status (2026-07-04):** ⏸️ Artefatos prontos, aguardando execução
manual pelo Fred (autenticar Railway CLI + criar projeto):
- `Dockerfile.worker` na raiz — multi-stage Node 20 Alpine, `tini`
  como init, roda `npx tsx src/jobs/index.ts`
- `railway.json` na raiz — aponta pro Dockerfile.worker com
  `restartPolicyType: ON_FAILURE` (max 10 retries)
- `docs/DEPLOY_Railway_Worker.md` — guia passo-a-passo (~150 linhas):
  criar projeto → colar env vars do Vercel → validação end-to-end
  em 3 cenários (inbound-lead-create, cron diário, import CSV) →
  rollback + manutenção

Worker entry (`src/jobs/index.ts`) já tinha SIGTERM/SIGINT handler
com `Promise.all([...].close())` desde Sprint 15D — não precisou
ajuste. Estimativa Fred: 30min-2h de execução manual (autenticar
Railway + colar ~10 env vars + validar).

### ~~P-37. Cobertura hooks P-35 nos services (dispatch + ai-usage)~~ ✅ FECHADO
**Resolvido em 2026-07-05.** Baseline pós: **846 passing** (+30 novos)
/ 172 skipped / 1018 total. Type-check zero. Lint zero.

**Cobertura antes:** dispatch.ts = 21% / ai-usage.service.ts = 10%
(reproduzido: 6.01% stmts combinado no baseline vazio).
**Cobertura depois:** **100% stmts / 100% branches / 100% funcs / 100%
lines em ambos.** Alvo era 60%, superado por larga margem porque os
dois arquivos são funções puras sem side-effects não-mocáveis.

**Fix aplicado (só testes, zero código app tocado):**
- **`tests/unit/dispatch-chat.test.ts`** novo com **14 casos**
  cobrindo `dispatchChat` + `dispatchEmbed`:
  - Path novo (MULTI_AI_ENABLED=true, 5 casos): delega
    `callAiWithFallback` + propaga usedFallback=false/true + shape
    correto + callback interno recebe (client, model) + breadcrumb
    Sentry com multiEnabled=true + propaga erro sem cair no path legado
  - Path legado (MULTI_AI_ENABLED=false, 5 casos): delega
    `callAiFeature` + `getAnthropicForTenant` → shape Anthropic-only
    com usedProvider/configuredProvider='ANTHROPIC', usedFallback=false
    + filtra mensagens role='system' antes do SDK + concatena blocos
    text e ignora não-text no `completion.content` (defesa contra
    tool_use blocks) + breadcrumb com multiEnabled=false + precedência
    `input.chat.model` sobre model do gate + fallback pra model do
    gate quando caller não passa
  - `dispatchEmbed` (4 casos): path novo delega pra callAiWithFallback
    com client.embed + lança erro se adapter não implementa embed +
    path legado retorna shape vazio pra sinalizar fallback tsvector
- **`tests/unit/ai-usage-service.test.ts`** novo com **16 casos**
  cobrindo `AI_PRICING`/`calculateCost`/`logAiUsage`/`getMonthlyUsage`:
  - AI_PRICING contém haiku/sonnet/opus/gpt (4 modelos verificados)
  - calculateCost linear em prompt+completion (haiku 1M+1M=6 USD)
  - calculateCost modelo desconhecido retorna 0 sem crashar
  - calculateCost zero tokens retorna 0
  - logAiUsage grava row com totalTokens=prompt+completion + costUsd
    computado pelo pricing table
  - defaults corretos (usedFallback=false / configuredProvider=null /
    success=true / errorCode=null / latencyMs=null / userId=null)
  - respeita overrides de success/errorCode/latencyMs/usedFallback/
    configuredProvider
  - publica evento Axiom com `costBrl = costUsd * env.USD_BRL_RATE`
    (mock USD_BRL_RATE=5 → 6 USD × 5 = 30 BRL)
  - Prisma falha → console.error + Axiom ainda é chamado (
    observabilidade não bloqueia)
  - modelo desconhecido → costUsd=0 tanto no row quanto no Axiom
  - getMonthlyUsage vazio (sem rows)
  - getMonthlyUsage filtra por tenantId + success=true + createdAt
    >= dia 1 do mês corrente 00:00:00.000
  - getMonthlyUsage agrupa (provider, model, usedFallback) e pivota
    primary vs fallback com stats separados
  - trata `_sum` null como zero
  - ordena breakdown por `(cost + fallbackCost)` desc
  - primary-only não polui fallback stats

**Mocks:**
- `@/lib/env` via Proxy pra flipar MULTI_AI_ENABLED entre testes
  (padrão `claude-per-tenant.test.ts` do P-14)
- `@/lib/ai/call` (callAiWithFallback), `@/lib/ai/feature-gate`
  (callAiFeature), `@/lib/ai/claude` (getAnthropicForTenant),
  `@/lib/monitoring/sentry` (addBreadcrumb) — zero rede real
- `@/server/db/client` (prisma.aIUsageLog.create + groupBy),
  `@/lib/monitoring/axiom` (logAiUsage) — zero Postgres real

**Rollback trivial** (dois arquivos de teste + reverter 3 blocos docs).

### P-38. Cobertura worker duration em queues.ts
**Severidade:** Média. Descoberto por QA automation em 2026-07-04.
`src/jobs/queues.ts` = **0%** cobertura. P-35 tocou pra adicionar
Sentry span + Axiom log em success/failure de worker, mas nenhum
teste executa `makeWorker()`.

**Escopo:** teste puro do wrapper capturando Sentry span + Axiom
log em success/failure.

**Esforço:** ~2h. Não bloqueia — candidato Sprint 16.

### ~~P-39. Fixture Clerk mock para QA/dev local~~ ✅ FECHADO
**Resolvido em 2026-07-04** (docs-only, sem código de app).

Investigação da fonte do `@clerk/shared/dist/keys.js` mostrou que
`isPublishableKey` valida só (1) prefixo `pk_test_`/`pk_live_` e (2)
que o segmento base64-decoded termina em `$` — sem checagem de rede
na inicialização. `parsePublishableKey` decoda a mesma coisa e
extrai o `frontendApi` sem contactar o Clerk. A rejeição
"Publishable key not valid" só aparece quando a chave falha esses
2 checks.

**Fix aplicado:** substituídos os placeholders `pk_test_xxxx...` /
`sk_test_xxxx...` em [.env.example](../.env.example#L21) pela dupla:
- `pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk` (base64 decoda para
  `fake.clerk.accounts.dev$` — passa `isPublishableKey`)
- `sk_test_dummy_do_not_use_in_prod` (Zod `min(1)` passa; SDK só
  valida quando chama Clerk API, retornando `clerk_key_invalid`)

Comentário de 10 linhas acima das vars explica quando usar dummy
(dev/QA local, worktree isolado, Playwright) vs quando exigir chaves
reais (staging/prod). E direciona pro bypass `NODE_ENV=test` em
[tests/e2e/fixtures/auth.ts](../tests/e2e/fixtures/auth.ts) pros E2E.

**Verificação manual:**
```
$ cp .env.example .env.local
$ ln -sf ../node_modules node_modules  # worktree resolve modules
$ rm -rf .next && npm run dev
> next dev
  ▲ Next.js 14.2.35
  - Environments: .env.local
 ✓ Ready in 1228ms
 HEAD / 200 in 3212ms
 HEAD /sign-in 200 in 754ms
```
Sem "Publishable key not valid". Header `x-clerk-auth-reason:
dev-browser-missing` confirma middleware Clerk rodando. Runtime
warning `Missing CLERK_ENCRYPTION_KEY` aparece mas é sobre outra
var (não relacionada à pub key) e não crasha.

**Escopo NÃO tocado:** src/middleware.ts, ClerkProvider,
`src/lib/env.ts` (Zod continua exigindo min(1)). Mock provider sob
flag `NEXT_PUBLIC_CLERK_MOCK` não foi necessário — path (A) já
resolve o caso de uso.

**Débitos residuais (R1/R2) fechados inline no housekeeping cycle
2026-07-05:**
- **R1 (CLERK_ENCRYPTION_KEY)** — dummy adicionada ao `.env.example`
  no bloco Clerk com comentário explicando que a var não passa pelo
  Zod schema (SDK Clerk lê direto) e silencia o warn em `next dev`.
  Prod continua exigindo `openssl rand -base64 32`. Sem código de app
  tocado.
- **R2 (Roteiro baseline stale)** — `docs/Roteiro_QA_Homologacao_Staging.md`
  §0 (linha 36) e §5 (linha 565) atualizados pra 715/0/168 (883 total)
  com nota sobre variância 709 vs 715 dependendo de `ANTHROPIC_API_KEY`.

**Débitos residuais originais mantidos como histórico:**
- `docs/Roteiro_QA_Homologacao_Staging.md` §0 baseline de testes
  ainda dizia "609 passing / 10 failed" — desatualizado (baseline
  atual 715/168). ✅ Fechado no housekeeping 2026-07-05.
- Runtime warning `CLERK_ENCRYPTION_KEY` aparecia com dummies —
  não crashava, só aviso do SDK. ✅ Fechado no housekeeping 2026-07-05
  via dummy documentada no `.env.example`.

### ~~P-40. Conflito .eslintrc.json em worktree~~ ✅ FECHADO
**Resolvido em 2026-07-04** (config-only). Fix defensivo:
adicionado `"root": true` no topo de `.eslintrc.json` do repo. ESLint
para de subir a árvore de diretórios procurando eslintrc — qualquer
config em pasta parent (existente ou futura) é ignorada. Escolhida
solução B em vez de renomear parent (que ficaria fora do controle
do repo).

Investigação confirmou que hoje NÃO existe `.eslintrc.json` em
`/Users/fredmarqueziniyahoo.com.br/Claude/` — o conflito reportado
em 2026-07-04 provavelmente foi transitório (algum editor/tool
gravando um eslintrc temporário). `root: true` é boa prática de
qualquer forma pra configs raiz de projeto.

Validação: `npm run lint` zero na paterna + `npm run lint` zero
em worktree efêmera criada de HEAD com node_modules symlinkado.
Baseline testes preservado (6 falhas pré-existentes em
communication-summary-errors por env vars — reproduzem na paterna
antes e depois do fix).

QA automation exception aplicada (config-only sem impacto runtime).

**Débito residual (R3) fechado inline no housekeeping cycle 2026-07-05:**
- **R3 (variance 715 vs 709)** — chip P-40 mediu 709 no ambiente dele;
  P-41 mediu 715 com dummies homogêneas. Adicionada nota explícita no
  `CLAUDE.md` §Baseline e `docs/Metodologia_Desenvolvimento_Venzo.md`
  §5.2 esclarecendo que a diferença é sensibilidade a
  `ANTHROPIC_API_KEY` (6 tests em `communication-summary-errors.test.ts`),
  não regressão de código. Ambos aceitáveis como baseline verde.

### ~~P-41. Baseline de testes desatualizado no CLAUDE.md~~ ✅ FECHADO
**Resolvido em 2026-07-04** (inline na paterna, docs-only). Baseline
atualizado em 3 pontos:
- `CLAUDE.md` — nova seção "## Baseline de testes atual (2026-07-04)"
  inserida antes de "## Débitos técnicos", registrando 715 passing / 0
  failing / 168 skipped (883 total), com nota de que snapshots
  históricos por sprint são preservados
- `docs/Metodologia_Desenvolvimento_Venzo.md` §5.2 — baseline reescrito
  para os números corretos + explicação sobre "sem env vars ~11 files
  falham no import" (não regressão)
- Memory `crm-app-setup-state.md` — adicionado bullet "Baseline testes
  (2026-07-04)" apontando pra CLAUDE.md como fonte da verdade

QA automation exception aplicada (docs-only, sem código de app).

---

## 🎯 QA Automation report — main @ a4726fa


com `Promise.all([...].close())` desde Sprint 15D — não precisou
ajuste. Estimativa Fred: 30min-2h de execução manual (autenticar
Railway + colar ~10 env vars + validar).

### ~~P-37. Roteiro de QA fragmentado entre chat/docs~~ ✅ FECHADO
**Resolvido em 2026-07-04.** Cenários de homologação estavam
espalhados entre chat (task #22/#23 do HANDOFF), `Backlog_Pos_MVP.md`,
`HANDOFF_Estado_Atual_2026-07-01.md`, `Runbook_Staging.md`,
`DEPLOY_Vercel_Guide.md` e `DEPLOY_Railway_Worker.md`. PO tinha que
juntar as fontes na mão a cada release. Fix documental:

[`docs/Roteiro_QA_Homologacao_Staging.md`](Roteiro_QA_Homologacao_Staging.md)
novo — checklist único e executável estruturado em 7 seções (§0
pré-deploy bloqueadores · §1 smoke 5min · §2 funcional ~1h · §3
segurança · §4 degradado · §5 automatizado (referência) · §6
rollback · §7 sign-off) + 3 anexos (env vars por ambiente, endpoints
com rate limit, referências rápidas). Cada checkbox tem passo +
critério pass/fail explícito. Comandos executáveis onde faz sentido
(curl, npm test, prisma migrate status). Cenários do Sprint 15D
inbound, RBAC granular (Sprint 15E), IA multi-provider (P-23),
Command Palette (P-16), Pipeline 7 estágios, drilldown por tenant
(P-06), segurança (multi-tenancy cross-tenant, chave IA vazamento,
audit_logs, anti-escalada RBAC) cobertos com pass/fail explícito.

**Variações completas** — 4 blocos preenchidos (§2.3.a /admin/ai 8
variações · §2.3.b drilldown P-06 6 variações · §2.4 Inbound Sprint
15D 8 variações · §2.6 Command Palette 9 variações). Extraído
diretamente do código real:
- `src/app/admin/ai/page.tsx` + `src/lib/ai/admin-alerts.ts`
  (Card A/B/C/D + 4 tipos de alerta CIRCUIT_OPEN/MISSING_KEY/
  FALLBACK_FREQUENT/COST_ABOVE_THRESHOLD).
- `src/app/platform/tenants/[id]/ai/page.tsx` +
  `.../features/page.tsx` (5 seções tela 1 + tela 2 features).
- `src/server/services/inbound-parser.service.ts` (5 matchers:
  webhook-custom-json 0.99 / typeform-v1 0.95 / rd-station-v1 0.9 /
  html-table 0.9 / plain-key-value 0.85) + `.../inbound-lead-creator.
  service.ts` (`MIN_CONFIDENCE=0.4`, 4 reasons de rejeição).
- `src/components/search/CommandPalette.tsx` +
  `src/server/trpc/routers/search.ts` (debounce 200ms, 4 buckets,
  navegação teclado ↑/↓/Enter/ESC, RBAC gracioso).

Total: 691 linhas. Cada variação: passo executável + pass/fail
explícito + comando curl/SQL onde aplicável. Zero placeholder
residual.

Manutenção: quando cenário virar release-blocker recorrente, promover
pra §3. Quando cenário virar teste automatizado, mover pra §5.
Referenciado em CLAUDE.md changelog e HANDOFF §7.

### ~~P-22. Convite de usuário sem indicação do tenant de destino~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `a1affec`.** Novo router
`src/server/trpc/routers/tenants.ts` com procedure `current`
retornando `{id, name, slug, plan, impersonating}`. Modal invite
em `src/app/admin/users/page.tsx` exibe "Convidando para o
tenant: {nome}" abaixo do título; se `impersonating != null`,
badge amarelo "⚠ Modo impersonação — confirme o destino". +6
testes em `tests/unit/tenants-current.test.ts`.

### ~~P-21. Erro Zod renderizado como JSON cru na UI~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Helper `src/lib/trpc/error-format.ts`
novo exporta `friendlyTrpcError(err)` que extrai a primeira mensagem
de `err.data.zodError.fieldErrors` (com fallback pra `formErrors` e
pra `err.message`). O `errorFormatter` em `src/server/trpc/trpc.ts`
já expõe `zodError.flatten()` desde o Sprint 0 — só faltava o cliente
consumir. Rollout em 20 arquivos migrando `e.message` (e
`.error.message` em display de estado de mutation/query) pra
`friendlyTrpcError(e)`. Rotas cobertas: `/admin/users`,
`/admin/products`, `/admin/listas`, `/admin/alerts`, `/admin/branding`,
`/admin/email-inbound`, `/contacts`, `/onboarding`, `/imports`,
`/search`, `/pipeline/new`, `/pipeline/[id]`, `/pipeline/@modal`,
`/platform/tenants`, `/platform/broadcasts`, `/platform/dashboard`,
`/platform/impersonate`, `/p/[tenantSlug]/contact`, `/p/tc/[token]`,
+ 5 componentes (`CompanyForm`, `CommunicationIntake`,
`PipelineKanban`, `PipelineMobile`, `TasksSection`,
`quick-create-trigger`). Antes: usuário via `[{"code":"custom",…}]`;
depois: "E-mail inválido" limpo. +8 testes em
`tests/unit/friendly-trpc-error.test.ts` (fieldError único,
múltiplos campos, formErrors puro, não-Zod, sem data, fallback vazio,
arrays vazias intercaladas, strings vazias intercaladas). Baseline
mantido — 533 passing (10 falhas + 2 skipped pré-existentes por env
vars faltando em field-encryption + communication-summary-errors,
confirmadas em HEAD antes do fix).

### ~~P-20. Tarefas na oportunidade sem criar/editar/deletar~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `030a9de`.** Backend ganhou
`tasks.update` e `tasks.delete` (soft delete via `deletedAt`) com
filtro por `tenantId` no `findFirst` (defesa em profundidade),
audit com `tenantIdOverride` e RBAC via
`withCapability('opportunity', 'update')`. Frontend extraído para
`src/components/pipeline/TasksSection.tsx` com Modal do design
system (form: título, descrição, prazo, prioridade, responsável),
botão "+ Nova tarefa", clique na linha abre modal em modo edit,
botão × dispara `AlertDialog` de confirmação. Toasts Venzo em
todas as mutações. `ActivitiesTimeline` extraído inline no page.tsx
como componente separado. +10 testes em
`tests/unit/tasks-router.test.ts`. 443/449 passing (4 falhas + 2
skipped pré-existentes por env vars).

### P-19. Upload de documentos + templates é placeholder manual
**Severidade:** 🔴 Alta (feature quebrada). Identificado em
2026-06-30 por Fred: "os campos de anexar documentos devem
permitir clicar e abrir a janela de seleção de arquivo".

**Sintoma real (bem pior que o descrito):** dois pontos da UI
pedem o gestor **digitar manualmente**:
- **`/pipeline/[id]` → Anexar documento**
  (`src/components/pipeline/DocumentsSection.tsx`): usuário
  digita URL/path do arquivo, tamanho em bytes e SHA-256 hex
  de 64 chars. Não tem `<input type="file">`.
- **`/admin/templates`** (`src/app/admin/templates/page.tsx`):
  idem — `storageKey` textual manual.

Referência de código que funciona: `/admin/branding`
(`src/app/admin/branding/page.tsx:747`) tem dropzone
funcional com `<input type="file" hidden>` + ref + drop
handler + `handleFile()` que faz upload via tRPC.

**Backend já existe** em `src/server/services/storage-s3.service.ts`:
- `uploadObject(key, body, contentType)` — upload server-side
- `presignDownload(key, expires)` — URL temporária
- `s3Enabled()` — check credenciais
- Fallback pra inline base64 quando S3 não configurado (dev)

**Falta:** `presignUpload(key, contentType, expires)` para PUT
direto do cliente (opcional — pode usar upload via backend).

**Fix escopo cheio (end-to-end):**
1. Adicionar `presignUpload()` ao `storage-s3.service.ts` (opcional
   — decisão do implementador)
2. Router tRPC novo `documents.getUploadIntent` (retorna
   `{storageKey, uploadUrl?}` ou `{storageKey, mode: 'proxy'}`)
3. Componente `<FileDropzone>` reusável em
   `src/components/ui/file-dropzone.tsx` (extraído do padrão
   Branding) com: click abre picker, drag-drop, progress bar,
   validação size/mime, cálculo SHA-256 via Web Crypto API
4. Refactor `DocumentsSection.tsx`: substitui form manual por
   `<FileDropzone>`; após upload, chama `documents.confirmUpload`
   com `{storageKey, filename, sizeBytes, sha256, category}`
5. Refactor `/admin/templates`: idem, categoria fixa TEMPLATE
6. Fallback dev sem S3: aceita upload direto no backend + salva
   em `/tmp/venzo-uploads/<tenant>/<uuid>` (só dev; produção
   exige S3)

**Escopo:**
- 2 componentes novos (`FileDropzone`, tRPC `documents.getUploadIntent`)
- Refactor de 2 telas (`DocumentsSection`, `admin/templates`)
- 1 método novo no service S3 (opcional)
- Testes: dropzone renderiza, click dispara picker, mime/size
  validation, SHA-256 calculado, fallback dev sem S3

**Esforço:** ~1.5-2 dias.

**Débitos residuais possíveis:** upload em outros lugares
(anexos em Activity? Attachments em Contract? Investigar durante
o refactor e listar como P-20+ se surgirem).

### ~~P-13. 401 do middleware vira "Unable to transform response from server"~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `4fcf4f6`.** Custom
`sessionAwareFetch` em `src/lib/trpc/session-guard.ts` intercepta
responses no `httpBatchLink`; num HTTP 401, loga `console.warn`
com a mensagem do body e chama `window.location.reload()` em
800ms. Flag `handling401` estática garante que batch tRPC com
N procedures só dispara um reload. No-op em rotas públicas
(`/sign-in`, `/sign-up`, `/onboarding`, `/privacy`, `/terms`,
`/p/…`, `/`). +17 testes em `tests/unit/session-guard.test.ts`.
Middleware `src/middleware.ts` não foi tocado — formato JSON
custom preservado pra facilitar debug em Network tab.

### P-18. IA multi-provider por feature + fallback (Sprint 15F)
**Severidade:** 🔴 Alta — design arquitetural. Identificado em
2026-06-30 por Fred: "a tela de IA cadastra apenas 1 serviço, mas
o design era várias IAs, cada uma específica pra um caso, com
fallback quando uma falha".

Spec completa: [Sprint_15F_IA_Multi_Provider.md](Sprint_15F_IA_Multi_Provider.md).

**Escopo:** cascata de resolução `TenantAiFeature.override →
AiFeature.default → Tenant.global`, provider adapters unificados
(Anthropic/OpenAI/Google/Perplexity), `callAiWithFallback()`,
circuit breaker por-(provider, tenant), UI `/admin/ai` refactor
em 4 cards, Platform Marketplace edit, feature flag rollout
gradual.

**Depende de:** P-14 fechado (per-tenant AI key). ✅ Já fechado.

**Esforço:** 5–7 dias. Sprint dedicado.

### ~~P-19. Upload real de documentos + templates~~ ✅ FECHADO
**Resolvido em 2026-06-30** pelos commits `aa71f25` (infra),
`22b63fc` (backend) e `cbbb4c8` (rollout).

**Sintoma original:** Sprint 8 deixou os forms de anexar documento
(`/pipeline/[id]` → DocumentsSection) e cadastrar template
(`/admin/templates`) pedindo URL/path, tamanho e SHA-256 digitados
à mão. Impossível de usar — ninguém sabe SHA-256 de cabeça.

**Fix entregue em 3 commits atômicos:**

1. **`aa71f25`** — `src/components/ui/file-dropzone.tsx` reusável:
   click + drag-and-drop, SHA-256 via Web Crypto (`crypto.subtle
   .digest`), validação mime (`.ext` / `wildcard/*` / `mime/exact`)
   + tamanho, `role=alert` inline, a11y (`role=button`, `tabIndex=0`,
   Enter/Space, `aria-label`, `aria-disabled`). Polifill de
   `Blob.arrayBuffer` via `FileReader` em `tests/setup.ts` pra
   jsdom. +13 testes.

2. **`22b63fc`** — router `documents` ganhou `getUploadIntent` e
   `uploadProxy`. Intent gera `storageKey` no padrão
   `tenant/${ctx.tenantId}/documents/<uuid>-<sanitizedName>`. Proxy
   valida cross-tenant checando prefixo (defesa em profundidade
   sobre Prisma extension), decoda base64 → Buffer, delega pra
   `uploadObject` do storage-s3.service. Fallback grava em
   `/tmp/venzo-uploads/<key>` quando S3 ausente. `sanitizeFilename`
   remove diacríticos (NFKD + strip combining), colapsa `..`
   (path traversal), converte `/\` em `_`, limita a 120 chars.
   `withCapability('opportunity','update')` (admin sempre atende).
   Audit `document.upload_intent` + `document.upload` com
   `tenantIdOverride`. +11 testes.

3. **`cbbb4c8`** — `DocumentsSection` e `admin/templates` refeitos.
   Fluxo: dropzone calcula SHA-256 → `getUploadIntent` gera key →
   `uploadProxy` sobe bytes → `documents.create` (ou
   `templates.create`) persiste metadata real. `fileToBase64` usa
   chunked `String.fromCharCode.apply` pra evitar stack overflow
   em arquivos >64KB. Link "abrir ↗" externo substituído por
   prefixo SHA-256 curto (visualização depende de P-20).

**Decisão de arquitetura:** upload via server (proxy) em vez de
presigned URL direto pro cliente. Overhead aceitável pra <20 MB
e evita configuração de CORS bucket. Registrar como P-20 se
volume justificar.

**Testes:** 457/463 (+24 vs baseline — 4 pré-existentes de env
vars). Type-check zero novo (apenas o pré-existente P-18 em
`feature-gate.ts:94`). Lint zero.

**Débitos residuais registrados como P-20:**
- Procedure `documents.presignDownload` (S3) + `presign` fallback
  local pra Activity attachments (Sprint 4 mesmo problema)
- Upload em Contract attachments (existirá se módulo evoluir)
- Explorar presigned upload direto (PUT do cliente) quando algum
  arquivo passar de 20 MB — hoje o proxy via base64 é OK

---

## 📅 Sprints planejados (próximas 4–6 semanas)

### ~~Sprint 15A — Platform Console~~ ✅ FECHADO 2026-06-29
Spec: `docs/Sprint_15A_Platform_Console.md`

### ~~Sprint 15B — AI Operations + Plataforma Estratégica~~ ✅ FECHADO 2026-06-30
Spec: `docs/Sprint_15B_AI_Ops_Platform.md`

### ~~Sprint 15C — Usabilidade: Forms, Listas Configuráveis e QuickCreate~~ ✅ FECHADO 2026-06-30
Spec: `docs/Sprint_15C_Usabilidade_Forms.md`

### ~~Sprint 15D — Inbound Marketing Pipeline~~ ✅ FECHADO 2026-07-01
Spec: `docs/Sprint_15D_Inbound_Marketing.md`

Entregue em 6 fases (commits `87f5a1b` → `1747f30`):
- Migration 0029 (UserRole ganha GESTOR_INBOUND + opportunity fields
  is_inbound/inbound_* + owner_id nullable + inbound_capture_config +
  inbound_leads_rejected + seed feature inbound-lead-parser)
- Parser híbrido `src/server/services/inbound-parser.service.ts` com 5
  matchers regex (webhook JSON / Typeform / RD Station / HTML table /
  plain key:value) + fallback IA via `dispatchChat`. DataMaskingService
  preservado.
- Service `inbound-lead-creator.service.ts` + worker BullMQ
  `inbound-lead-create` (dedup company/contact, anti-spam blacklist,
  cria opp em PROSPECT sem owner + audit com tenantIdOverride).
- Endpoint público POST `/api/v1/inbound/lead?secret=…` com rate limit
  PUBLIC_FORM_LIMIT (Sprint 11).
- Router tRPC `inbound` (getConfig, updateConfig, regenerateWebhookSecret,
  queueList/queueCount, sellersWithLoad, assignInbound, historyList,
  rejectedList, rejectedDiscard).
- Novas RBAC actions: `opportunity:assign`, `opportunity:set_inbound_owner`,
  `inbound:view_queue`, `inbound:configure`. GESTOR_INBOUND novo role.
- UI `/inbox/prospects` (kanban lista com Popover de alocação por carga).
- UI `/admin/email-inbound` refeita com Tabs (E-mail / Forms / Histórico).
- Novo relatório `/reports/inbound-vs-outbound` (funil comparativo,
  conversion rate, ticket médio, cycle time) + service puro
  `inbound-analytics.service.ts`.
- 38 testes novos. Baseline 619/627 passing (6 falhas pré-existentes).

Pendências residuais registradas em novos débitos (P-27 a P-31 abaixo).

### Sprint 15E — RBAC Granular (Permissões Configuráveis) ✅ FECHADO 2026-07-01
Spec: `docs/Sprint_15E_RBAC_Granular.md` v3 + `docs/permission-matrix.md`

**4 fases entregues.** Refactor estrutural — roles como perfis padrão
+ 61 permissions granulares individuais por user + cache em
`users.cached_permissions`/`cached_permissions_at`. Migration 0030
backfilla `GESTOR_INBOUND` → `ADMIN` + 4 overrides inbound (com
ON CONFLICT DO NOTHING). 34 procedures migradas de `withCapability`/
`withRoles` pra `withPermission`. Router `permissions.*` novo com
grant/revoke/restore + guard anti-escalada §6.5 (caller só delega o
que tem; Platform Owner é exceção). UI `/admin/users/[id]/permissions`
com 3 estados visuais + contagem transparente + histórico inline.
Sidebar condicional em 3 items (Fila inbound / E-mail inbound /
Importação) via `hasPermissionByRole`.

**Breaking changes conscientes:**
- ANALISTA perde `opportunity:read_others` → só vê próprias opps
- GESTOR perde `partner:approve_engagement` → matrix agora só admin+diretor
- DIRETOR_OPERACOES ganha `task:*` explícito

**approval_rules** ganha `approver_permission` (alternativa a
`approver_roles` com CHECK XOR) — dual approver preserva compat.

**Rollout ordenado obrigatório:** migrate 0030 → `npm run
rbac:backfill-cache` → ativar `RBAC_GRANULAR_ENABLED=true`. Sem
backfill, `permissions.whoHas` retorna [] (bloqueia notificações
inbound).

Ver `CLAUDE.md` pra histórico completo (4 commits `c91ff3e` →
Fase 4). Memory `rbac-granular-pattern.md` salva com regras pra
futuras features ("permission nova > role nova").

### Sprint 15F — IA Multi-Provider por Feature + Fallback ✅ BACKEND FECHADO 2026-06-30
Spec: `docs/Sprint_15F_IA_Multi_Provider.md`

Ver histórico completo no `CLAUDE.md`. Backend + UI dos 4 Cards em
`/admin/ai` entregues; rollout gradual (`MULTI_AI_ENABLED` já ativo).

### Sprint 15G — Estrutura Comercial e Visibilidade Hierárquica

Spec: `docs/Sprint_15G_estrutura_comercial.md` (chip-prompts) +
`docs/Sprint_15G_amendments.md` (A1–A7 aprovadas 2026-07-06).

Fase 1a — **Fundação schema + Repository** ✅ FECHADO 2026-07-07
(commit `<preenchido no merge>`, branch `claude/sprint-15g-fase-1a`):

- Migration 0031 (`prisma/migrations/0031_estrutura_comercial/`):
  * `CREATE EXTENSION IF NOT EXISTS ltree` idempotente
  * Enum `UnitMemberRole` (`MANAGER` | `MEMBER`)
  * 3 tabelas: `sales_unit_types` (categorias com `UNIQUE(tenant, level)`
    + `UNIQUE(tenant, name)`), `sales_units` (path=ltree, depth, parentId,
    CHECK A7 `path::text != '' AND ~ '^[a-zA-Z0-9._]+$'`), `sales_unit_members`
    (role, is_primary, assignedBy)
  * Partial UNIQUE A5: `sales_unit_members_one_primary_per_user WHERE
    is_primary = true` — 2 primary por user impossível mesmo sob write
    concorrente
  * Índices GiST no `sales_units.path` (suporta `<@`, `@>`) + índices
    padrão em tenant/parent/type + partial index de ativos
  * RLS via helper `enable_tenant_rls()` do 0002_rls nos 3 modelos
  * **Backfill A1 idempotente** (`ON CONFLICT DO NOTHING` em cada INSERT):
    cada tenant existente ganha 1 SalesUnitType "Unidade" nível 1 + 1
    SalesUnit "Padrão" raiz + todos os users ativos como membros. Users
    com role em (ADMIN, DIRETOR_*, GESTOR) → `MANAGER`; senão `MEMBER`.
    Todos com `is_primary=true`. Objetivo: quando chip Fase 2 ligar
    `SALES_STRUCTURE_ENABLED`, GESTOR/DIRETOR/ADMIN continuam vendo o
    que já viam pré-15G via `read_team` sobre a subtree (Emenda A1)
  * `assigned_by=NULL` no backfill (sem user real de origem)
  * Rollback documentado no cabeçalho da migration

- Prisma schema (`prisma/schema.prisma`):
  * Novo enum `UnitMemberRole`
  * 3 models: `SalesUnitType` (@@map sales_unit_types), `SalesUnit`
    (@@map sales_units, path como `Unsupported("ltree")`), `SalesUnitMember`
    (@@map sales_unit_members)
  * Relações inversas em `Tenant` (salesUnitTypes, salesUnits,
    salesUnitMembers) e `User` (salesUnitMemberships,
    salesUnitAssignments com onDelete SetNull pro assignedBy)
  * Doc inline no `SalesUnit`: nunca criar direto pelo Prisma
    (Emenda A7 — path ltree exige cálculo determinístico)

- Repository (`src/server/db/repositories/sales-unit.repository.ts`):
  * `SalesUnitRepository.create(input)` — via `$queryRaw` INSERT +
    lookup do parent (com filtro por tenantId — cross-tenant defense).
    Path sem parent = `root.<shortId>`; com parent = `parent.path.<shortId>`.
    Depth = parent.depth + 1 (ou 1 se raiz)
  * `getSubtreeMemberIds(managerId, tenantId)` — retorna array de userIds
    acessíveis a partir de todas as units onde o user é MANAGER (`role =
    'MANAGER'` no WHERE); inclui o próprio + descendentes via `sub_unit.path
    <@ mgr_unit.path`. Fallback pra `OWN` é responsabilidade do caller
  * `getTree(tenantId)` — árvore ordenada por path com typeName +
    memberCount
  * `getAncestors(unitId, tenantId)` — breadcrumb ordenado por
    `nlevel(path)` asc, exclui a própria unit (`anc.path != target.path`)
  * `getChildren(unitId, tenantId)` — filhos diretos (`parent_id = ?`,
    não recursivo)
  * Comentário JSDoc no topo alerta a convenção A7

- Helper `src/lib/utils/short-id.ts` — `generateShortId()` via
  `crypto.randomBytes` sobre alfabeto [a-z0-9], 8 chars. Bate com a
  regex A7 do CHECK. Constraint `sales_units_tenant_short_id_unique`
  protege colisões.

- Env flag `SALES_STRUCTURE_ENABLED: envBoolean(false)` (`src/lib/env.ts`)
  documentada em `.env.example`. Nenhum consumer runtime — chip Fase 2
  usa. Default false pra rollout gradual (opposite do `RBAC_GRANULAR_ENABLED`
  que veio pós-15E com default true).

- 20 testes novos (12 repository + 8 ltree-path):
  * `tests/unit/sales-unit-repository.test.ts`: create com/sem parent,
    shortId fallback, parent inexistente (`throw claro`), INSERT vazio,
    getSubtreeMemberIds happy path + filtro MANAGER + descendentes N-nível
    + tenantId em 4 JOINs, getTree/getAncestors/getChildren shape
  * `tests/unit/ltree-path-generation.test.ts`: formato do short-id,
    1000 gerações únicas, regex A7 sempre respeitada, path raiz vs
    filho vs 5 níveis, boundary "label vazio nunca sai porque short-id
    tem 8 chars"

- Baseline: **964 passing (+20 novos) / 0 failing / 174 skipped (1138
  total)**. Type-check zero. Lint zero. Zero regressão no baseline
  pré-chip (944/0/174 → 964/0/174 delta exatamente = 20 tests novos).

- Chip **NÃO fez** (escopo Fase 1b + Fase 2+):
  * Zero mudança em `src/lib/auth/permissions-catalog.ts` ou
    `src/lib/auth/rbac.ts`
  * Nada de `resolveOpportunityScope` service
  * Zero touch em `opportunities`/`reports` routers
  * UI `/admin/commercial-structure` — Fase 4
  * Seed de demonstração 3 níveis — Fase 4

- Débitos residuais para próximos chips:
  * **Fase 1b**: permissions catalog + role defaults (Sprint 15E
    replaced `opportunity:read_others` por `read_team` + `read_all`)
  * **Fase 2**: service `sales-structure.service.ts` + `resolveOpportunityScope`
    consumindo `SalesUnitRepository.getSubtreeMemberIds` + respeitando
    flag `SALES_STRUCTURE_ENABLED` + PARCEIRO early-return (Emenda A4)
  * **Fase 3**: opportunities + reports routers usam scope resolver;
    A2 backfill de overrides `read_others` → `read_team/read_all`
    com `ON CONFLICT DO NOTHING` + cache invalidation
  * **Fase 4**: UI CRUD `/admin/commercial-structure` + seed de
    demonstração (Diretoria → Regional → Equipe) + cenários pass/fail
    no `Roteiro_QA_Homologacao_Staging.md`

### Sprint 15G Fase 1b — Catálogo + Roles matriz ✅ FECHADO 2026-07-07
Spec: `docs/Sprint_15G_estrutura_comercial.md` §6 +
`docs/Sprint_15G_amendments.md` A2.

**Escopo cirúrgico (Fase 1b — só catálogo + matrix + backfill A2):**
- `src/lib/auth/permissions-catalog.ts`: `opportunity:read_others`
  removida; adicionadas 4 novas — `opportunity:read_team`,
  `opportunity:read_all`, `sales_structure:read`, `sales_structure:manage`
  (nova category `commercial`). Total 61 − 1 + 4 = **64 permissions**.
- `src/lib/auth/rbac.ts` — `ROLE_DEFAULT_PERMISSIONS` atualizado
  conforme matriz §6:
  * ADMIN=63 (era 60), DIRETOR_COMERCIAL=41 (era 39),
    DIRETOR_OPERACOES=27 (era 25), DIRETOR_FINANCEIRO=19 (era 18),
    GESTOR=32 (era 31), ANALISTA=24 (era 23), PARCEIRO=5 (inalterado)
  * DIRETOR_F NÃO tem `read_team` (não gerencia squad) mas tem
    `read_all` (auditoria financeira tenant-wide)
  * GESTOR NÃO tem `read_all` (SEU squad via `read_team`); admin
    concede override individual quando necessário
  * ANALISTA continua sem visão tenant-wide (breaking 15E preservado)
  * `sales_structure:manage` só ADMIN (mínima superfície de ataque)
- `scripts/15g-migrate-permissions.ts` novo + `npm run 15g:migrate-permissions`.
  Backfill idempotente: users com override granted de `read_others`
  ganham override granted de `read_team` (`ON CONFLICT DO NOTHING`),
  overrides revoked de `read_others` são simplesmente deletados,
  `cachedPermissionsAt = NULL` força recompute. Audit log por tenant
  com `tenantIdOverride` + metadata `{userIds, migrated_count,
  legacy_permission, target_permission}`. Segunda execução loga
  "nada a migrar" e não faz mutations.
- Routers **minimamente tocados** por dependência de type-check:
  `src/server/trpc/routers/opportunities.ts` e `.../reports.ts`
  trocaram literal `'opportunity:read_others'` por `hasPermission(read_team)
  || hasPermission(read_all)` (2 linhas cada, comportamento
  preservado sob nova matrix para TODOS os roles não-PARCEIRO —
  ADMIN/DIRETOR_C/DIRETOR_O têm ambas; DIRETOR_F tem read_all; GESTOR
  tem read_team; ANALISTA sem nenhuma segue vendo só próprias).
  Filtro real por team (via SalesUnit) fica pra Fase 3.

**Não escopo desta fase** (Fase 1a: schema + ltree; Fase 2:
sales-structure.service + router; Fase 3: opportunities/reports.ts
wireup real por team; Fase 4: UI).

**Testes:** **+22 novos** distribuídos em 3 arquivos:
`permissions-catalog-15g.test.ts` (8 casos — read_others ausente,
4 novas presentes com label PT-BR, total=64, category "commercial",
integridade), `role-default-permissions-15g.test.ts` (10 casos —
matriz célula por célula + contagens por role + NENHUM role tem
read_others), `15g-migrate-permissions-script.test.ts` (4 casos —
fluxo normal com 3 users e 2 tenants + idempotência + ON CONFLICT
DO NOTHING + cache invalidation incluindo revoked users).

Testes existentes atualizados: `permissions-catalog.test.ts`
(count 61→64 + swap read_others → read_team/read_all nas listas
positivas + adição em rejeição do isValidPermission),
`role-default-permissions.test.ts` (matriz e cascade atualizadas
pra 15G), `permissions-router.test.ts` (count 61→64),
`rbac-kill-switch.test.ts` (1 caso trocou read_others por read_team).

**Baseline preservado:** pré-chip = 875 passing / 4 pré-existentes
por env vars em `field-encryption.test.ts` / 174 skipped.
Pós-chip = **896 passing (+21 líquido: 22 novos − 1 assertion legado
"ANALISTA NÃO tem read_others" que virou parte do bloco -15g)** /
4 pré-existentes / 174 skipped. Zero regressão confirmada via
`git stash`. Type-check zero. Lint zero.

**Rollback:** reverter 4 arquivos (`permissions-catalog.ts`,
`rbac.ts`, `opportunities.ts` snippet, `reports.ts` snippet) +
apagar script + 3 testes novos. Rollback preserva dados no DB
(read_others removida no catálogo mas overrides antigos ainda
persistem enquanto não rodar `15g:migrate-permissions`).

---

## 🚀 Roadmap médio prazo (Sprints 16–20)

### Sprint 16 — Hardening de Produção
**5–7 dias.** Pré-requisito pra **production launch**.

Trabalho:
- **Sentry wiring real:** DSN configurado, sourcemaps no build,
  release tracking, breadcrumbs, profiling. Substitui o stub
  do Sprint 0 que só tem `SENTRY_DSN` no env mas não inicializado.
- **Axiom wiring real:** structured logging, log shipping,
  dashboards de queries lentas / erros por endpoint / latência
  por tenant. Hoje é stub.
- **Lighthouse em CI:** workflow + threshold + STAGING_URL
  (resolve P-05)
- **k6 load test:** cenários documentados no
  `Arquitetura_e_Plano_Implantacao_CRM.docx` §6.5:
  - Base: 200 simultâneos, p95 < 300ms
  - Pico: 1000 simultâneos, p95 < 800ms, erro < 0.1%
  - Stress por módulo: pipeline list, reports, busca semântica
- **Smoke E2E contra staging:** Playwright + fixtures, login com
  Clerk real (não bypass), test pack mínimo (login → criar opp →
  avançar estágio → fechar)
- **Cloudflare WAF:** configurar regras OWASP Top 10 (Sprint 11
  spec'd, infra não setup)
- **Documentar runbooks operacionais:** restore de backup Neon,
  incident response, rotacionar PAT/credentials

### Sprint 17 — Comissões Automáticas End-to-End
**4–5 dias.** Sprint 7 entregou parceiros + comissão por vínculo,
mas falta fluxo de pagamento:

- Cálculo de comissões devidas (por contrato fechado / por mês)
- Conciliação manual (Platform Owner marca "pago")
- Integração com sistema financeiro externo (export para Omie/Conta
  Azul/Sage) via webhook ou export
- Dashboard de comissões pendentes / pagas por parceiro
- Carteira de comissões: histórico, declaração mensal pra IRPJ

### Sprint 18 — WhatsApp Business Integração Nativa
**5–7 dias.** Hoje é colar texto pra IA resumir. Próximo passo:

- WhatsApp Business API (Cloud API Meta)
- Mensagens entram via webhook automático (sem colar)
- Vinculação por número de telefone do contato
- Resposta inline na app (admin escreve, sistema envia via WhatsApp)
- Threading: agrupa mensagens por contato + opportunity
- Cost tracking: WhatsApp cobra por conversação (24h window)

### Sprint 19 — Marketplace de Templates de Proposta
**4–5 dias.** Templates de proposta hoje são por tenant. Próximo:

- Marketplace público de templates compartilháveis entre tenants
- Tenant Enterprise pode publicar template como "público"
- Outros tenants podem importar
- Sistema de rating + comentários
- Curadoria pelo Venzo (templates oficiais)
- Substituição de variáveis (nome do cliente, valores, datas)

### Sprint 20 — Agente Autônomo de Prospecção (Beta)
**7–10 dias.** Feature pesada de IA com modelo agentic:

- Input: ICP do cliente (Ideal Customer Profile)
- Agente busca empresas no LinkedIn/CNPJ Receita Federal
- Score de match com o ICP
- Sugere first-touch message personalizada
- Trial fechado pra clientes ENTERPRISE
- Cost: per-prospect (Stripe Metered Billing)

---

## 🌅 Roadmap longo prazo (Sprint 21+)

### Stripe Metered Billing (add-ons usage-based)
Cobrança por uso (tokens IA, prospects buscados, broadcasts enviados).
Hoje é só subscription mensal flat. Depende do AI Marketplace
(Sprint 15B) estar maduro.

### Customer Portal Stripe customizado
Self-service de billing pelos tenants (mudar plano, atualizar cartão,
ver invoices, cancelar). Sprint 12 entregou o link pro Stripe Portal
default; customizar com branding Venzo + recovery flows.

### Calendar Sync bidirecional (Google + Outlook)
Conectar agenda do vendedor com tarefas/atividades do CRM.
Notificações no celular via push (Sprint 10) + email.

### Voice / Audio: meetings via Whisper
Upload de áudio de reunião → transcrição via Whisper → resumo
estruturado via Claude → tarefas no CRM. Substitui receptor de texto
do Sprint 4.

### Mobile native app
PWA cobre 95% hoje. Mobile native (React Native ou Capacitor)
adiciona:
- Notificações nativas mais ricas
- Acesso à câmera pra fotos de cartão de visita / OCR
- Offline-first mais robusto que PWA
- Push token nativo (não Web Push)

Decisão: avaliar custo vs benefício após 12 meses de PWA em produção.

### Open API + GraphQL (opcional)
REST já entregue Sprint 12. Avaliar GraphQL pra integrações complexas
com SAP/Salesforce/HubSpot que querem fetch agregado.

### Compliance avançado
- SOC 2 Type II (auditoria externa, ~6 meses)
- ISO 27001
- Penetration test trimestral
- Bug bounty program (HackerOne)
- WCAG AAA (atualmente AA)

---

## 🤔 Decisões de arquitetura pendentes

### D-01. framer-motion?
**Contexto:** Sprint 14.5 item 6 evitou swipe-down do bottom sheet
por não ter framer-motion. Hoje só CSS transitions. Quando precisar
de mais microinterações (drag-drop do kanban, animação de página,
swipe sheet), framer-motion vira candidato.

**Decisão pendente:** adotar oficialmente ou ficar em CSS puro?
~130kb gzipped não é trivial.

### D-02. Storybook standalone?
**Contexto:** Sprint 14 entregou design system mas sem Storybook.
Componentes documentados em código.

**Decisão pendente:** investir em Storybook (manutenção contínua,
hospedagem, integração CI) ou aceitar docs in-code? Vale se time
crescer pra > 5 devs.

### D-03. i18n?
**Contexto:** App 100% pt-BR. Voz Venzo em português.

**Decisão pendente:** quando começar i18n (next-intl ou react-i18next)?
Recomendado **após** primeiro cliente fora do Brasil ou interesse
concreto de expansão LATAM.

### D-04. PWA vs Mobile native?
Ver roadmap longo prazo. Decisão pós-12 meses em produção.

### D-05. Hospedagem de produção
**Atual:** assumido Vercel + Neon (mencionado em CLAUDE.md como
"hosted").

**Decisão pendente:** confirmar Vercel ou avaliar:
- AWS ECS + RDS PostgreSQL (mais controle, +ops)
- Render / Fly.io (mais barato pequena escala)
- Cloudflare Pages + D1 (edge-first, mas requer reescrita Prisma)

Para MVP: Vercel + Neon é o caminho de menor atrito. Decidir antes
do Sprint 16 (hardening prod).

### D-06. Tier de plano e pricing
**Atual:** enum `TenantPlan` tem TRIAL/STARTER/PRO/ENTERPRISE mas
preços não definidos em código (só `STRIPE_PRICE_*` env stubs).

**Decisão pendente:** preços finais por plano + matriz de features
incluídas (a entrada de catálogo do Sprint 15B `default_inclusion`
JSONB precisa ser preenchida com dados reais).

---

## 🐛 Débitos técnicos identificados

### T-01. Audit log silencioso em vários routers
Ver P-04 (curto prazo). Memory `audit-trpc-context-loss.md`.

### T-02. PWA não rodando local
Sprint 14 dev log mostra `(serwist) Serwist is disabled` —
Service Worker desabilitado em desenvolvimento. Em produção precisa
verificar manualmente após Sprint 16 (hardening) que ele inicializa
corretamente.

### T-03. `MAINTENANCE_WINDOW` vs broadcasts
Sprint 14.5 implementou `NEXT_PUBLIC_MAINTENANCE_MESSAGE` como
env. Sprint 15B substitui por broadcasts targeting. Migrar
deprecando o env após 15B (não breaking — só remover o
componente quando todos os tenants tiverem o novo).

### T-04. Sentry/Axiom stubs
Sprint 0 incluiu env vars mas não inicialização real. Sprint 16
resolve.

### T-05. Seed scripts vs produção
`prisma/seed.ts` popula 3 tenants pra dev. Em produção não roda
(corretamente). Mas falta `prisma/seed-platform.ts` (Sprint 15A) e
`prisma/seed-ai-features.ts` (Sprint 15B) que **precisam** rodar uma
vez na produção como migration de dados.

### T-06. Permissões ANALISTA não cobertas pela suite de teste
Sprint 5 menciona visibilidade ANALISTA em reports (só vê própria
linha + média anônima), mas E2E `pipeline-7-stages.spec.ts` testa só
ADMIN. Suite de teste de RBAC por role faltando — risco de
regressão silenciosa em permissões.

### T-07. Backup do Neon
Neon faz backup automático mas não há **export externo** programado.
Sprint 16 documenta no runbook + cria worker `daily-backup-export`
(dump pra S3 + retenção 90d).

---

## 📊 Visão consolidada

| Categoria | Itens | Esforço aprox |
|---|---|---|
| **Curto prazo** (P-01 a P-05) | 5 fixes | ~13h (~2 dias) |
| **Sprint 15A** | Platform Console operacional | 5–7 dias |
| **Sprint 15B** | AI Ops + Estratégico | 4–5 dias |
| **Sprint 15C** (proposto) | CRUD UI completo | 3–4 dias |
| **Sprint 16** | Hardening produção | 5–7 dias |
| **Sprint 17–20** | Features estratégicas | 5–10 dias cada |
| **Longo prazo** | Compliance, mobile, etc | 12+ meses |
| **Decisões pendentes** | 6 decisões arquiteturais | revisão |
| **Débitos técnicos** | 7 itens (T-01 a T-07) | distribuído |

**Próximo ciclo prioritário sugerido:**
1. **Curto prazo P-01 + P-02 + P-03 + P-04** (~2 dias) — fecha
   débitos mais imediatos
2. **Sprint 15A** (5–7d) — habilita operação de produto
3. **Sprint 16** (5–7d) — hardening prod antes do go-live público
4. **Sprint 15B** (4–5d) — habilita escala de IA
5. Decisão D-05 (hospedagem) antes do go-live
6. Sprint 15C / 17+ conforme demanda

Total ciclo prioritário: **~4–6 semanas** até produção robusta.
