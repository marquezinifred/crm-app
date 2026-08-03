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

- **Main HEAD:** `123129d` (docs). **Baseline testes:** **1463 passing / 0 failing /
  185 skipped** sem `DATABASE_URL_TEST` (CI/dev normal). Type-check zero, lint zero.
  Com DB de teste, a integração RODA e passa (harness consertado no P-104).
- **Prod:** deployment `crm-r1qadw8u6` (Ready, aliased `crm-app-pi-eight.vercel.app`),
  Neon `production-live` (`ep-rapid-fog-ajm1hdvb`). Health `db:ok`.
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

### Prioridade 2 — Débitos do 15G.5 (achados no smoke de prod, spec §9.2-9.5)
- **P-105** (média) — guard read-only lança `ForbiddenError` dentro da Prisma
  extension → sobe como **500** (não 403); mapErrors não reconhece o wrap do Prisma.
  Mensagem certa, código errado. Fix: `mapErrors` desembrulhar (`err.cause instanceof
  ForbiddenError`) + teste que assevera `code==='FORBIDDEN'`.
- **P-106** (baixa/média) — app **trava inteiro** com `navigator.onLine` falso
  (React Query `networkMode:'online'` pausa queries + OfflineBanner). Fix: heartbeat
  real no `/api/v1/health` e/ou `networkMode:'always'`. É do design system (14.5).
- **P-107** (média) — `/pipeline/transferencias-em-andamento` colide com o
  intercepting route `@modal/(.)[id]` → "Invalid uuid" no SPA nav. Fix: `(.)[id]`
  validar UUID antes do Sheet/byId (early-return null), OU mover a rota 3c.
- Residuais menores: **P-100** (TIMED_OUT dup worker×service), **P-101/102/103**
  (cosméticos Fase 3), **R3-R7** (follow-ups guard 2c).

### Prioridade 3 — Sprint 15H (Metas + Reconcile Approvals) — PO já aprovou (Opção A)
Spec pronta: **[Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)**.
- **Bloco A** — reconcile de approvals órfãs (P-77): worker daily `approvals-reconcile`
  03:00 BRT + service + UI `/admin/approvals-orphaned` + migration **0033**. **Depende
  do P-36** (worker). Rollout com flag OFF + dry-run log-only primeiro.
- **Bloco B** — `sales_quotas` por unidade (migration **0034**) + router + UI
  `/admin/sales-quotas` + drill-down `/reports/quota-tree`.
- **Bloco C** — estender `opportunities.list` com `owner.primaryUnit.name` (ativa o
  badge da Fase 4b do 15G).
- Decomposição: 6 chips Modo B (spec §7). Migrations 0033/0034 (numeração já
  reconciliada com 15G.5 que ficou com 0032).

## 3. Housekeeping antigo (paralelo, sem urgência)
P-81 (runbook recovery Neon), P-82 (loop 401 → tela dedicada, Sprint 16), P-83
(partial UNIQUE `(tenant_id,email)`), P-84 (convidar reativa soft-deleted),
P-03/P-05 (visual baseline / Lighthouse — dependem de staging).

## 4. Limpeza pendente (dados de teste criados em prod hoje)
Criei no tenant `marquezini` pra validar o 15G.5 ao vivo (via APIs A7):
- Unidades **Teste Transferência / Teste A / Teste B** + memberships.
- Opp `8f021e6a` teve o dono trocado pra **gmail** (accept de teste) — devolver pro
  frederico se quiser.
- Branch Neon `r1-15g5-test` — auto-deleta ~Aug 5 (não precisa fazer nada).
Gestão pode limpar via script A7 (`SalesStructureService.removeMember` + soft-delete
das units) quando o Fred autorizar.

## 5. Referências
- Metodologia: [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- Backlog/planejamento: [Planejamento_Debitos_Pos_Rollout_15G.md](Planejamento_Debitos_Pos_Rollout_15G.md)
- 15G.5 (spec + débitos §9.1-9.5): [Sprint_15G5_Transferencia_Oportunidade.md](Sprint_15G5_Transferencia_Oportunidade.md)
- 15H spec: [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)
- Rollout 15G.5: [ROLLOUT_Sprint_15G5_Prod.md](ROLLOUT_Sprint_15G5_Prod.md)

---

**Arranque 2026-08-03.** 15G.5 no ar e provado. Próximo: infra (P-36+P-85) + débitos
15G.5 (P-105/106/107) → depois Sprint 15H. Gestão coordena; chips implementam.
