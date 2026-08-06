# Handoff / Arranque — 2026-08-03 ("CRM Dev V4")

Sessão nova = **mesmo papel e processo** da anterior (migração só pra economizar
tokens). Substitui [HANDOFF_Estado_Atual_2026-07-29.md](HANDOFF_Estado_Atual_2026-07-29.md).

---

## 0. Modus operandi — LER E SEGUIR (não-negociável)

Referência canônica: **[Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)**
+ memory `role-separation` (carrega automática). Em resumo:

- **Esta sessão = gestão / QA / arquiteto.** NÃO escreve código de app. Mapeia
  débitos, escreve specs/planos, revisa entregas (QA conceitual), coordena
  merges/migrations/deploys/commits.
- **Chips = dev.** Implementação vai SEMPRE via `mcp__ccd_session__spawn_task`
  (sessões separadas), NUNCA como subagente interno (Agent tool). Cada chip recebe
  prompt self-contained (caminhos absolutos, contexto, critério de aceite).
- **QA também é chip** (spawn_task). **Modo B** default (chips disjuntos → merge →
  1 QA integrado). **Modo A** exceção pra mudança em **módulo core** (ex.:
  `db/client.ts`, choke point / área P-42) → QA na branch ANTES do merge.
- **QA automatizado usa o skill `qa-automation`** (decisão Fred 2026-08-03): o prompt
  do chip de QA manda ele **invocar `anthropic-skills:qa-automation`** — orquestra
  Vitest (unit) + Supertest (integration) + Playwright (E2E), analisa falhas com
  ref arquivo/linha, mede cobertura e produz veredito/plano. Não descrever o passo a
  passo de teste na mão; delegar ao skill. O `qa-runner` fica pro **smoke manual/
  exploratório** ponta-a-ponta (tipo o smoke autenticado do 15G.5 em prod), quando
  aplicável.
- **Edits permitidos pela gestão:** `docs/**`, `CLAUDE.md`, memory. **Operações
  permitidas:** `prisma migrate deploy`, `git commit/push`, ops Vercel/Neon,
  queries de diagnóstico. **Proibido pela gestão:** editar `.ts/.tsx`, schema,
  migrations, tests (isso é chip).
- Regras arquiteturais não-negociáveis: Metodologia §4 (multi-tenancy defesa em
  profundidade, `where: { tenantId: ctx.tenantId }` explícito SEMPRE, DataMasking
  antes de IA, audit com `tenantIdOverride`, RBAC granular, `envBoolean` em flags,
  backstop P-42, soft delete).
- **Nunca parsear secret** (memory `feedback_never_parse_secrets`): só `grep -q` +
  echo constante; jamais `awk/sed/regex`/`echo` do valor. Setar env var booleana em
  prod é pelo **dashboard Vercel** (CLI piped grava vazio — memory
  `vercel-env-add-cli-empty`).

---

## 1. Estado técnico atual

- **Main HEAD:** `2b5519c` (housekeeping P-82/83/84 + QA + docs). **Baseline testes:**
  **1488 passing / 0 failing / 185 skipped** sem `DATABASE_URL_TEST` (pós-merge P-82/83/84;
  era 1463). Type-check zero, lint zero. Com DB de teste, a integração RODA e passa.
- **Prod:** deployment `crm-4e39szxjf` (Ready, aliased
  `crm-app-pi-eight.vercel.app`), Neon `production-live` (`ep-rapid-fog-ajm1hdvb`),
  **migration `0033` aplicada**. Health `db:ok`. Rollout P-82/83/84 + débitos 15G.5 (P-105/106/107/110) FEITO 2026-08-03.
- **15G.5 (transferência de oportunidade): ENTREGUE, LIGADO e PROVADO em prod.**
  `OPPORTUNITY_TRANSFER_ENABLED=true` (flag **Sensitive** no Vercel → `vercel env
  pull` mostra vazio, é esperado; o valor real está setado). Fluxo validado ponta a
  ponta em prod: disparo → aceite (troca owner) → guard read-only → cancelar/rejeitar;
  caminhos negativos com mensagens corretas.

## 2. Plano priorizado (decisão do Fred 2026-08-03)

Ordem: **(1) infra/prod + (3) débitos 15G.5 → depois (2) 15H.**

### Prioridade 1 — Infra/produção (destravam o resto)
- **P-36 — worker BullMQ no Railway.** Bloqueia: 15H-Bloco A (reconcile), timeout
  automático do 15G.5, workers de alerta/email. Guia: `docs/DEPLOY_Railway_Worker.md`.
  É **ação humana/infra** (Fred sobe o worker; gestão coordena/valida).
- **P-85 — Clerk Production instance.** Prod ainda usa Clerk **DEV**
  (`guiding-bobcat-23.clerk.accounts.dev` — badge "Development mode" no login).
  Pode ser feito no domínio Vercel atual (não precisa de domínio próprio — ver
  `Planejamento_Debitos_Pos_Rollout_15G.md` §P-85). Segurança/prod-readiness antes
  do 1º cliente-piloto.

### Prioridade 2 — Débitos do 15G.5 — ✅ TODOS ENTREGUES + QA VERDE (2026-08-03)
Os 4 mergeados (`5d8d791`) e **EM PROD** (deploy `crm-4e39szxjf`, health db:ok, sem migration):
- **P-105** ✅ (merge `8764ea6`) — causa real: NÃO era o Prisma embrulhar (5.22 não
  embrulha) e sim **divergência de identidade de classe** (guard lança do closure do
  `globalThis.prisma` que sobrevive a HMR → `instanceof` falha). Fix `findForbiddenError`
  casa por `instanceof` OU `name==='ForbiddenError'` OU cadeia de `cause`. Teste assevera
  `code==='FORBIDDEN'`. QA Modo B verde.
- **P-106** ✅ (merge `4851787`) — `networkMode:'always'` (queries+mutations) +
  OfflineBanner por heartbeat real no `/api/v1/health` (offline só após 2 falhas; 200
  lento NÃO marca offline — blindado contra cold-start P-110). QA Modo B verde.
- **P-107** ✅ (merge `d2d5e84`) — guard UUID (`zUuid.safeParse`) no `(.)[id]/page.tsx`
  (hooks incondicionais + `enabled` + `return null` pós-hooks). Cobre qualquer segmento
  estático futuro sob `/pipeline`. QA Modo B verde.
- **P-110** ✅ (merge `4cc3e80`, **Modo A**) — retry de conexão no cold-start do Neon
  (`db/client.ts` + `connection-retry.ts`). Só P1001/P1002, tenant/backstop/guard
  byte-a-byte, ALS preservado, host sanitizado. **QA adversarial na branch: 🟢 SEGURO**
  (6 ataques refutados). Relatórios: `docs/qa-sessions/auto-report-2026-08-03-*`.
- Residuais menores ainda abertos: **P-100** (TIMED_OUT dup worker×service),
  **P-101/102/103** (cosméticos Fase 3), **R3-R7** (follow-ups guard 2c),
  **P-111** (integration do guard P-105 devolvendo `code FORBIDDEN` não exercido
  contra DB — rodar contra branch Neon efêmero no padrão do R1).

**Baseline pós-4-débitos:** Modo B 1488→1512 (+24); P-110 +23 (`connection-retry`).
Type-check e lint zero. `db/client.ts` alterado só pelo P-110 (Modo A, QA verde).

### Prioridade 3 — Sprint 15H (Metas + Reconcile Approvals) — PO já aprovou (Opção A)
Spec pronta: **[Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)**.
- **Bloco A** — reconcile de approvals órfãs (P-77): worker daily `approvals-reconcile`
  03:00 BRT + service + UI `/admin/approvals-orphaned` + migration **0033**. **Depende
  do P-36** (worker). Rollout com flag OFF + dry-run log-only primeiro.
- **Bloco B** — `sales_quotas` por unidade (migration **0034**) + router + UI
  `/admin/sales-quotas` + drill-down `/reports/quota-tree`.
- **Bloco C** — estender `opportunities.list` com `owner.primaryUnit.name` (ativa o
  badge da Fase 4b do 15G).
- Decomposição: 6 chips Modo B (spec §7). Migrations **0034/0035** (renumeradas:
  o housekeeping P-83 pegou `0033` em 2026-08-03; 15G.5 ficou com 0032).

## 3. Housekeeping antigo (paralelo, sem urgência)
**Revisão de alinhamento 2026-08-03:** os 4 itens foram verificados contra o
código atual — todos ainda reproduziam (nenhum obsoleto). Estado:
- **P-81** ✅ ENTREGUE (gestão) — `docs/Runbook_Recovery_Pos_Neon_Restore.md`
  (detecção Clerk×banco, SQL de reinserção seletiva, `rbac:backfill-cache`
  obrigatório, checklist por role).
- **P-83 + P-84** ✅ ENTREGUE + QA VERDE + **ROLLOUT FEITO em prod (2026-08-03)** — migration
  **0033** partial UNIQUE `(tenant_id,email) WHERE deleted_at IS NULL` aplicada no
  `production-live` + reativação de soft-deleted no `users.invite` + UI + testes.
  QA: `docs/qa-sessions/auto-report-2026-08-03-housekeeping-p82-p83-p84.md`. Falta smoke
  autenticado (reconvidar e-mail desativado — Fred).
- **P-82** ✅ ENTREGUE + QA VERDE + **ROLLOUT FEITO em prod (2026-08-03)** —
  `authState=NOT_PROVISIONED` no `enforceAuth` + session-guard redireciona pra
  `/account-not-found` (sign-out) em vez de reload em loop. Falta smoke autenticado.
- **P-03/P-05** (visual baseline / Lighthouse) — seguem dependendo de staging.

**QA integrado Modo B (2026-08-03):** 🟢 OK seguir, zero regressão. Baseline
**1463 → 1488 (+25)**, 0 failing, 185 skipped estável. Type-check/lint/`prisma
validate` limpos. Migration 0033 revisada estaticamente.

⚠️ P-83 consumiu a migration `0033` → **15H renumerado pra 0034/0035** (ver §2 P3).

**Débitos residuais registrados no QA:**
- **P-108** (baixa) — `context.ts` sem cobertura unit (0%); `authState` só roda
  em request-time/integração. Extrair função pura testável OU teste de integração
  gated por `DATABASE_URL_TEST`. Consumidor (`assertAuthContext`) já 100% coberto.
- **P-109** (informativo) — drift declarativo Prisma: `@@unique` cheio no schema
  vs índice PARCIAL no banco (mesmo padrão aceito do clerk_id/0026). `prisma
  migrate dev` futuro pode acusar drift fantasma — esperado.
- **P-110** (baixa/média, achado no smoke 2026-08-03) — dashboard mostrou erro cru
  do Prisma (`Can't reach database server` + hostname Neon) num cold-start do
  compute serverless (autosuspend). Transitório, recuperou sozinho (1213ms→127ms).
  **Reincidiu durante o rollout** (`prisma migrate status` deu P1001 até aquecer o
  compute via health) — ou seja, afeta UI **e** ops. Robustez: (1) retry/backoff em
  falha transitória de conexão; (2) estado amigável "reconectando…" sem vazar
  Prisma/host na UI (primo do P-106). **Mitigação ops recomendada:** ajustar/desabilitar
  o autosuspend do compute Neon prod (reduz cold-starts recorrentes).

## 4. Dados de teste em prod — ✅ LIMPO (2026-08-03)
Estrutura criada no tenant `marquezini` pra validar o 15G.5 ao vivo já foi removida
(script A7 via `runAsSystem`, sem tocar em `audit_logs`):
- Unidades **Teste Transferência / Teste A / Teste B** + 5 memberships → apagadas.
- 2 transferências de teste (APPROVED da `8f021e6a` + CANCELLED da `92edb21f`) → apagadas.
- Opp `8f021e6a` → dono revertido **gmail → frederico**, `currentTransferId=null`.
- Verificação: 0 unidades `Teste*` restantes; prod no estado original + 15G.5 ligado.

**Branch Neon `r1-15g5-test`:** expiração **adiada pra 2026-09-01 17:07 GMT-3** (era Aug 5).
ID `br-plain-hat-aj7j1eb5`, **filha de `staging`** no projeto **CRM-DEV** (dev) — isolada de
produção, carrega dados de staging/teste (**sem PII de prod**). Compute ociosa/autosuspendida
(custo ≈ 0). Decisão foi só adiar, não persistir. **Revisitar no kickoff do 15H:** promovê-la
a `DATABASE_URL_TEST` canônica (habilita a suíte de integração que hoje skipa — necessária pro
teste do **P-105** e pro 15H; candidata limpa já que não tem dado de prod) ou deixar
auto-deletar.

## 5. Referências
- Metodologia: [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- Backlog/planejamento: [Planejamento_Debitos_Pos_Rollout_15G.md](Planejamento_Debitos_Pos_Rollout_15G.md)
- 15G.5 (spec + débitos §9.1-9.5): [Sprint_15G5_Transferencia_Oportunidade.md](Sprint_15G5_Transferencia_Oportunidade.md)
- 15H spec: [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)
- Rollout 15G.5: [ROLLOUT_Sprint_15G5_Prod.md](ROLLOUT_Sprint_15G5_Prod.md)

---

**Arranque 2026-08-03.** 15G.5 no ar e provado. Próximo: infra (P-36+P-85) + débitos
15G.5 (P-105/106/107) → depois Sprint 15H. Gestão coordena; chips implementam.
