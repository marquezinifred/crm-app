# RBAC Migration Map — Sprint 15E Fase 2

**Data:** 2026-07-01
**Escopo:** Substituição de 34 procedure declarations (13 router files) das APIs legadas `withCapability`/`withRoles` pra `withPermission` (Sprint 15E).

O baseline "47" citado na spec era o `grep -c withRoles\|withCapability` bruto — que soma 13 imports + 34 declarações. Este documento mapeia declaração a declaração e destaca as 5 mudanças semânticas propositais.

Legenda:
- **Rename mecânico** — mesma semântica, formato novo `resource:action`
- **Semantic split** — permission nova mais estreita (às vezes muda quem tem por default)
- **Enforcement adicional** — quando aplica novo filtro row-level via `hasPermission('opportunity:read_others')`

---

## Companies (`companies.ts`) — 4 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| `list`, `byId` | `withCapability('company', 'read')` | `withPermission('company:read')` |
| `create` | `withCapability('company', 'create')` | `withPermission('company:create')` |
| `update` | `withCapability('company', 'update')` | `withPermission('company:update')` |
| `remove` | `withCapability('company', 'delete')` | `withPermission('company:delete')` |

## Contacts (`contacts.ts`) — 4 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| `list`, `byId` | `withCapability('contact', 'read')` | `withPermission('contact:read')` |
| `create` | `withCapability('contact', 'create')` | `withPermission('contact:create')` |
| `update` | `withCapability('contact', 'update')` | `withPermission('contact:update')` |
| `remove` | `withCapability('contact', 'delete')` | `withPermission('contact:delete')` |

## Contracts (`contracts.ts`) — 3 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| `list`, `byId` | `withCapability('contract', 'read')` | `withPermission('contract:read')` |
| `create` | `withCapability('contract', 'create')` | `withPermission('contract:create')` |
| `update` | `withCapability('contract', 'update')` | `withPermission('contract:update')` |

## Proposals (`proposals.ts`) — 4 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| Read procedures | `withCapability('proposal', 'read')` | `withPermission('proposal:read')` |
| `create` | `withCapability('proposal', 'create')` | `withPermission('proposal:create')` |
| `update` | `withCapability('proposal', 'update')` | `withPermission('proposal:update')` |
| `approve` | `withCapability('proposal', 'approve')` | `withPermission('proposal:approve')` |

## Opportunities (`opportunities.ts`) — 5 rename mecânico + **filter async**

| Procedure | Antes | Depois |
|---|---|---|
| `list`, `kanban`, `byId` | `withCapability('opportunity', 'read')` | `withPermission('opportunity:read')` + `visibilityWhere` async |
| `create` | `withCapability('opportunity', 'create')` | `withPermission('opportunity:create')` |
| `update` | `withCapability('opportunity', 'update')` | `withPermission('opportunity:update')` |
| `advance` | `withCapability('opportunity', 'advance_stage')` | `withPermission('opportunity:advance_stage')` |
| `cancel` | `withCapability('opportunity', 'cancel')` | `withPermission('opportunity:cancel')` |

**Enforcement adicional (§6.4 spec):** `visibilityWhere(userId, role, partnerCompanyId)` virou `async` e agora chama `await hasPermission(userId, 'opportunity:read_others')` pra decidir se retorna `{}` (vê tudo) ou `{ OR: [{ownerId: userId}, {team: {some: {userId}}}] }` (vê próprias). PARCEIRO segue com row-level filter (não é permission-based).

**Breaking change:** ANALISTA perde visibilidade de opps alheias. Admin pode conceder `opportunity:read_others` via override individual sem mudar role. Documentado em CLAUDE.md.

## Activities + Tasks (`activities.ts`) — 3 procedures + semantic split de tasks

Duas rotas neste arquivo: `activitiesRouter` e `tasksRouter`.

| Procedure | Antes | Depois |
|---|---|---|
| activities.`list` | `withCapability('opportunity', 'read')` | `withPermission('opportunity:read')` |
| activities.`create`, `confirmSummary` | `withCapability('opportunity', 'update')` | `withPermission('opportunity:update')` |
| activities.`summarize` | `withCapability('ai', 'use_summary')` | `withPermission('ai:use_summary')` |
| tasks.`create` (**semantic split**) | `withCapability('opportunity', 'update')` | `withPermission('task:create')` |
| tasks.`update`, `updateStatus` (**semantic split**) | `withCapability('opportunity', 'update')` | `withPermission('task:update')` |
| tasks.`delete` (**semantic split**) | `withCapability('opportunity', 'update')` | `withPermission('task:delete')` |

**Semantic split rationale:** matrix concede `task:*` a DIRETOR_OPERACOES mas não `opportunity:update` — padrão "handoff/pós-venda gerencia tarefas mas não edita pipeline". Antes essa distinção era impossível.

## Documents (`documents.ts`) — 2 semantic split (P-19)

| Procedure | Antes | Depois |
|---|---|---|
| `getUploadIntent`, list, byId (leituras) | `withCapability('opportunity', 'read')` | `withPermission('document:read')` |
| `create`, `addVersion`, `uploadProxy` | `withCapability('opportunity', 'update')` | `withPermission('document:upload')` |

**Semantic split rationale:** antes qualquer user com `opportunity:update` podia subir documento (proxy grosso). Agora `document:upload` amplamente concedido mas `document:delete` só ADMIN (proteção contra perda acidental — soft delete ideal).

## Reports (`reports.ts`) — 1 semantic split + **filter async**

| Procedure | Antes | Depois |
|---|---|---|
| Todas queries (funnel, winLoss, timePerStage, performance, revenue, inbound×outbound) | `withCapability('opportunity', 'read')` | `withPermission('reports:read')` + `visibility` async |

**Semantic split:** `reports:read` é o gate mínimo (matrix: ADMIN + DIRETOR_* + GESTOR + ANALISTA). Cada procedure aplica adicionalmente `hasPermission('opportunity:read_others')` via `visibility` pra limitar linhas de dados. ANALISTA vê só própria linha em `performanceByOwner` (Sprint 5 preservado).

Débito residual: `reports:financial` (esconder colunas de valor R$/margem) ainda **não é enforced** — todas queries retornam valores. UI deve gate condicional em cima. Registrar como P-XX.

## Inbox (`inbox.ts`) — 1 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| `list`, `byId`, `retryAutoLink`, `linkManually`, `reject` | `withCapability('opportunity', 'read')` | `withPermission('opportunity:read')` |

## Imports (`imports.ts`) — 1 semantic split

| Procedure | Antes | Depois |
|---|---|---|
| `create`, `confirm`, `cancel` | `withCapability('company', 'create')` (**proxy grosso**) | `withPermission('import:run')` |

**Semantic split rationale:** antes qualquer user com `company:create` podia rodar import CSV/XLSX. Agora `import:run` é permission granular (matrix: ADMIN + GESTOR — line manager que valida antes de rodar).

## Partners (`partners.ts`) — 1 rename mecânico

| Procedure | Antes | Depois |
|---|---|---|
| `registerTcAcceptance` (inline) | `withCapability('partner', 'invite')` | `withPermission('partner:invite')` |

Outras procedures em `partners.ts` usam `adminOnlyProcedure` — não migradas neste sprint. Débito residual pra Sprint 15G.

## Partner Engagements (`partner-engagements.ts`) — 2 (1 mecânico + 1 semantic)

| Procedure | Antes | Depois |
|---|---|---|
| `request` | `withCapability('partner', 'invite')` | `withPermission('partner:invite')` |
| `decide` (aprovar/rejeitar) | `withRoles('ADMIN', 'DIRETOR_COMERCIAL', 'DIRETOR_OPERACOES', 'GESTOR')` | `withPermission('partner:approve_engagement')` |

**Semantic change:** GESTOR perde `partner:approve_engagement` por default (matrix: ADMIN + DIRETOR_C + DIRETOR_O apenas). Rationale: gestor não pode auto-aprovar próprio parceiro; diretor precisa validar. Admin pode conceder override individual pra gestores específicos.

## Inbound (`inbound.ts`) — 3 (2 mecânico + 1 semantic)

| Procedure | Antes | Depois |
|---|---|---|
| `getConfig`, `updateConfig`, `regenerateWebhookSecret` | `withCapability('inbound', 'configure')` | `withPermission('inbound:configure')` |
| `queueList`, `queueCount`, `sellersWithLoad`, `historyList`, `rejectedList`, `rejectedDiscard` | `withCapability('inbound', 'view_queue')` | `withPermission('inbound:view_queue')` |
| `assignInbound` (**semantic split**) | `withCapability('opportunity', 'set_inbound_owner')` | `withPermission('inbound:assign_prospects')` |

**Semantic split rationale:** antes usava permission scoped em opportunity (`set_inbound_owner`) que era uma workaround pra Sprint 15D. Agora `inbound:assign_prospects` é dedicated, mais claro semanticamente.

---

## Total

- **34 declarations migradas** em 13 router files
- **13 rename mecânico** puro (mesma semântica)
- **7 semantic splits** (permission mais estreita ou mais precisa)
- **2 procedures ganharam enforcement adicional** via `hasPermission('opportunity:read_others')` — opportunities + reports

Chamadas legadas restantes:
- `adminOnlyProcedure` (74 usos em 13 files) — mantido como `withRoles('ADMIN')` compat. ADMIN por default tem todas as permissions do catálogo (exceto `audit:read_platform` Platform-only), então comportamento é preservado. Débito Sprint 15G.
- 2 comentários mencionando `withCapability`/`withRoles` que só documentam a mudança (não são calls reais).

## Rollback rápido

Se algum procedure quebrar em produção, reverter arquivo específico via `git revert <hash> -- src/server/trpc/routers/<file>.ts` traz de volta `withCapability`. A infraestrutura Fase 1 (`hasCapability`, `ROLE_CAPABILITIES`) preservada exatamente com essa intenção.

## Verificação

```bash
# Zero withRoles/withCapability CALLS restantes (só comentários):
grep -rn "withCapability(\|withRoles(" src/server/trpc/routers --include="*.ts"

# Type-check zero + lint zero preservados.
npm run type-check
npm run lint

# Test baseline preservado (604 passing / 4 falhas pré-existentes env vars).
npm test
```
