# Relatório QA Automation — Sprint 15E RBAC Granular

**Data:** 2026-07-01
**Sessão:** `auto-2026-07-01-1512`
**Modo:** Geração (scaffolding, sem execução)
**Ferramenta:** skill `anthropic-skills:qa-automation`
**Branch:** `claude/stupefied-swirles-d55156` (worktree `stupefied-swirles-d55156`)
**Motivação:** Sprint 15E (~10 dias) sendo desenvolvido em chip paralelo
(`task_7965b8c7`); esta sessão prepara suite de tests que roda automaticamente
assim que o Sprint 15E for mergeado.

---

## Sumário executivo

| Item | Valor |
|---|---|
| ACs cobertos | 26 / 26 |
| Arquivos de teste novos | 17 (15 Vitest + 1 Supertest + 1 Playwright) |
| Tests skipados (aguardando merge) | 166 |
| Fixture compartilhada | `tests/helpers/rbac-fixtures.ts` |
| Baseline preservado | 609 passing / 10 pré-existentes / 2 skipped → **inalterado** |
| Type-check zero | ✓ (via `@ts-nocheck` nos arquivos que dependem de código futuro) |
| Lint zero | ✓ |
| Commits | 5 blocos + 1 relatório = 6 commits |

**Nota sobre baseline:** o `CLAUDE.md` diz "576 passing / 4 pré-existentes / 2
skipped", mas o repo atual (2026-07-01, pós HANDOFF_v2) rodando `npx vitest run`
retorna **609 passing / 10 failed / 2 skipped**. Os 10 fails são pré-existentes
(env vars ausentes em field-encryption, rate-limiter, ai-pricing, document-compare,
summary-parser, communication-summary-errors). Baseline atualizado neste relatório.

---

## Classificação dos 26 ACs por camada

| AC | Descrição resumida | Camada | Arquivo |
|---|---|---|---|
| AC-01 | Migration 0030 aplicada sem erro | **Vitest** (fs scan da SQL) | `rbac-migration-0030.test.ts` |
| AC-02 | permissions-catalog: 65 entries com shape correto | Vitest | `rbac-permissions-catalog.test.ts` |
| AC-03 | ROLE_DEFAULT_PERMISSIONS: contagens exatas (60/39/25/18/31/23/5) | Vitest | `rbac-role-defaults.test.ts` |
| AC-04 | hasPermission async: bypass, cache, revoked>granted>default | Vitest | `rbac-has-permission.test.ts` |
| AC-05 | hasPermissionByRole síncrono (sem overrides) | Vitest | `rbac-has-permission.test.ts` |
| AC-06 | cachedPermissions nullable (null vs []) | Vitest | `rbac-has-permission.test.ts` |
| AC-07 | Baseline grep withRoles/withCapability = 0 | Vitest (fs scan) | `rbac-procedures-baseline.test.ts` |
| AC-08 | 10 procedures × {403 sem perm, 200 com} | Vitest | `rbac-procedures-smoke.test.ts` |
| AC-09 | opportunities.list filtro por ownerId sem read_others | Vitest | `rbac-opportunities-visibility.test.ts` |
| AC-10 | opportunities.byId alheia sem read_others → 404 | Vitest | `rbac-opportunities-visibility.test.ts` |
| AC-11 | opportunities.count respeita mesmo filtro | Vitest | `rbac-opportunities-visibility.test.ts` |
| AC-12 | reports.performance/activities/tasks/documents cascata | Vitest | `rbac-cascade-filter.test.ts` |
| AC-13 | docs/rbac-migration-map.md existe com 47 linhas | Vitest (fs) | `rbac-procedures-baseline.test.ts` |
| AC-14 | permissions.listCatalog retorna 65 | Vitest | `rbac-permissions-router.test.ts` |
| AC-15 | permissions.forUser shape completo | Vitest | `rbac-permissions-router.test.ts` |
| AC-16 | grant/revoke/restore + audit + invalida cache | Vitest | `rbac-permissions-mutations.test.ts` |
| AC-17 | Guard anti-escalada (só delega o que tem) | Vitest | `rbac-permissions-mutations.test.ts` |
| AC-18 | whoHas filtra por cachedPermissions has | Vitest | `rbac-permissions-router.test.ts` |
| AC-19 | Cross-tenant forUser → NOT_FOUND | Vitest | `rbac-permissions-router.test.ts` |
| AC-20 | E2E /admin/users/[id]/permissions UI | **Playwright** | `rbac-permissions-ui.spec.ts` |
| AC-21 | approval_rules.approver_permission CHECK XOR + service | **Híbrido** Vitest + Supertest | `rbac-approval-rules-compat.test.ts` + `rbac-approval-rules-constraint.test.ts` |
| AC-22 | Backfill script idempotente | Vitest | `rbac-backfill-script.test.ts` |
| AC-23 | Kill-switch RBAC_GRANULAR_ENABLED | Vitest | `rbac-kill-switch.test.ts` |
| AC-24 | Sprint 15D compat (ex-GESTOR_INBOUND) | Vitest | `rbac-sprint-15d-compat.test.ts` |
| AC-25 | Nunca vazar sensíveis (audit/response) | Vitest | `rbac-audit-safety.test.ts` |
| AC-26 | Fora catálogo + race condition | Vitest | `rbac-race-and-catalog.test.ts` |

**Distribuição:**
- Vitest puro: 24 / 26 (92%)
- Playwright: 1 / 26 (AC-20)
- Supertest (integration): 1 / 26 (AC-21 CHECK constraint)

---

## Arquivos criados e tests por bloco

### Bloco 1 — Fundação (5 arquivos, 55 tests skipados)
```
tests/helpers/rbac-fixtures.ts               [ 249 linhas — 0 tests, só helpers ]
tests/unit/rbac-permissions-catalog.test.ts  [  8 tests skipados — AC-02      ]
tests/unit/rbac-role-defaults.test.ts        [ 16 tests skipados — AC-03      ]
tests/unit/rbac-has-permission.test.ts       [ 20 tests skipados — AC-04/5/6  ]
tests/unit/rbac-migration-0030.test.ts       [ 11 tests skipados — AC-01      ]
```

### Bloco 2 — Procedures (4 arquivos, 43 tests skipados)
```
tests/unit/rbac-procedures-baseline.test.ts       [  5 tests — AC-07/13 ]
tests/unit/rbac-procedures-smoke.test.ts          [ 20 tests — AC-08    ]
tests/unit/rbac-opportunities-visibility.test.ts  [ 12 tests — AC-09/10/11 ]
tests/unit/rbac-cascade-filter.test.ts            [  6 tests — AC-12    ]
```

### Bloco 3 — UI + router (3 arquivos, 26 tests skipados de Vitest + 10 de Playwright)
```
tests/unit/rbac-permissions-router.test.ts    [ 11 tests — AC-14/15/18/19 ]
tests/unit/rbac-permissions-mutations.test.ts [ 15 tests — AC-16/17       ]
tests/e2e/rbac-permissions-ui.spec.ts         [ 10 tests — AC-20 (Playwright) ]
```

### Bloco 4 — Compat + rollout (5 arquivos, 26 tests skipados)
```
tests/unit/rbac-approval-rules-compat.test.ts             [ 4 tests — AC-21 ]
tests/integration/rbac-approval-rules-constraint.test.ts  [ 5 tests — AC-21 CHECK ]
tests/unit/rbac-backfill-script.test.ts                   [ 6 tests — AC-22 ]
tests/unit/rbac-kill-switch.test.ts                       [ 5 tests — AC-23 ]
tests/unit/rbac-sprint-15d-compat.test.ts                 [ 6 tests — AC-24 ]
```

### Bloco 5 — Segurança (2 arquivos, 18 tests skipados)
```
tests/unit/rbac-audit-safety.test.ts     [  7 tests — AC-25 ]
tests/unit/rbac-race-and-catalog.test.ts [ 11 tests — AC-26 ]
```

**Total:** 17 test files + 1 helper = **18 arquivos novos**, **166 tests skipados** (156 Vitest + 10 Playwright).

---

## Estratégia de scaffolding

### Padrões seguidos

1. **`describe.skip` no topo de cada bloco** — sinaliza claramente que o teste
   depende de código ainda inexistente. Todos passam a rodar automaticamente ao
   remover `.skip`.
2. **`@ts-nocheck` no header dos arquivos que importam APIs do Sprint 15E** —
   evita regressão em `npx tsc --noEmit`. Padrão explicitamente documentado no
   comentário: "Remover junto com describe.skip após merge".
3. **Dynamic imports (`await import(...)`)** dentro de `it` — protege runtime
   caso módulo tenha side effect ou dependência circular. Padrão herdado de
   `audit-context-loss.test.ts`.
4. **Fixtures compartilhadas em `tests/helpers/rbac-fixtures.ts`** — factories
   `makeUser`, `makeOverride`, `makeCtx`, `makeOpp` + constantes
   `EXPECTED_ROLE_COUNTS`, `EXPECTED_CATALOG_SIZE`, `SMOKE_PROCEDURES` etc.
5. **Nomenclatura em pt-BR nos describes**, tests com prefixo `AC-XX` no
   comentário e no describe (fácil de mapear pra spec).
6. **Cross-tenant tests em todo arquivo relevante** — enforcement do princípio
   Sprint 15A "cross-tenant retorna NOT_FOUND, não FORBIDDEN".

### Padrões NÃO seguidos (deliberadamente)

- **`it.todo`** — descartado. Testes têm corpo completo com asserts;
  `describe.skip` protege da execução até o merge.
- **Testes contra Postgres real** (integration completa) — só o AC-21 CHECK
  constraint precisa. Restante mocka Prisma via `vi.mock` (padrão do
  `tasks-router.test.ts`).
- **Testes de UI unitários** (Testing Library) — AC-20 vira Playwright puro;
  smoke de UI sem browser é limitado e não bate o custo.

---

## Comandos de execução pós-merge

Após o merge do Sprint 15E, remover **em ordem** de cada arquivo:
1. O `describe.skip(...)` do topo dos blocos principais → `describe(...)`
2. O `@ts-nocheck` do header

Então:

```bash
# Suite Sprint 15E completa (Vitest — unit + integration mockado)
npx vitest run tests/unit/rbac-*.test.ts tests/integration/rbac-*.test.ts

# CHECK constraint (Supertest com Postgres real — precisa DATABASE_URL_TEST)
DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
  npx vitest run tests/integration/rbac-approval-rules-constraint.test.ts

# E2E UI (precisa E2E_TEST_TENANT_ID + fixtures do Sprint 11)
E2E_TEST_TENANT_ID=... E2E_TEST_USER_CLERK_ID=... \
  npx playwright test tests/e2e/rbac-permissions-ui.spec.ts

# Baseline completo (com Sprint 15E des-skipado)
npx vitest run
```

---

## Tempo estimado de execução pós-unskip

| Camada | Tests | Estimativa (local dev) | Estimativa (CI) |
|---|---:|---:|---:|
| Vitest unit (mocks) | 156 | ~8s | ~15s |
| Supertest integration (Postgres real) | 5 | ~2s | ~5s (depende do banco) |
| Playwright E2E | 10 | ~40s | ~90s (browser + seed) |
| **Total suite Sprint 15E** | **171** | **~50s** | **~110s** |

Assume Sprint 15E entrega: (1) `src/lib/auth/permissions-catalog.ts` com 65
entries, (2) `src/lib/auth/rbac.ts` refatorado com `hasPermission` async,
(3) migration 0030 aplicada, (4) 47 procedures migradas.

---

## Checklist pós-merge do Sprint 15E

Ordem sugerida ao developer que fechar o Sprint 15E:

1. [ ] `git checkout claude/stupefied-swirles-d55156 -- tests/helpers/rbac-fixtures.ts` (traz o helper)
2. [ ] Cherry-pick os 5 commits desta branch: `a7bf3a1`, `f8cf403`, `d1ab7bf`, `ea87f51`, `6a2d0d0`
3. [ ] Em cada arquivo `tests/unit/rbac-*.test.ts` + `tests/e2e/rbac-*.spec.ts` + `tests/integration/rbac-*.test.ts`:
   - Remover `// @ts-nocheck — Sprint 15E ainda não mergeado.` do header
   - Trocar `describe.skip(` por `describe(` (grep no arquivo)
4. [ ] Rodar `npx vitest run tests/unit/rbac-*.test.ts`
5. [ ] Se falhar em algum AC, cada arquivo tem no header o AC-XX correspondente — grep na spec `docs/Sprint_15E_RBAC_Granular.md`
6. [ ] Rodar `npx tsc --noEmit` — sem regressão
7. [ ] Rodar `npx vitest run` completo — baseline deve subir de 609 → ~775 passing (166 novos passando)

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| API do rbac.ts diverge do esperado (nomes de export) | Cada arquivo tem `await import('@/lib/auth/rbac')` — grep de erro traz mensagem específica |
| Migration 0030 tem SQL diferente do assumido | `rbac-migration-0030.test.ts` usa regex tolerante (case-insensitive, permite whitespace) |
| Contagens ROLE_DEFAULT_PERMISSIONS mudam pós-revisão PO | Fonte da verdade é `docs/permission-matrix.md` — se mudar lá, atualizar `EXPECTED_ROLE_COUNTS` no helper |
| SMOKE_PROCEDURES escolhidos não existirem no Sprint 15E | Só 10 procedures — trocar entry em `tests/helpers/rbac-fixtures.ts` |
| AC-20 E2E precisa 2 fixtures (ADMIN + ANALISTA) — só temos 1 | 2 tests marcados `test.skip(true, ...)` com TODO — spawnar chip P-XX pós-merge |
| Playwright AC-20 depende de seed E2E com N users e permissions | Já sinalizado nos test.skip mensagens; requer sub-sprint de staging |

---

## Débitos residuais registrados

Nenhum débito é bloqueador do Sprint 15E — todos são refinamentos futuros:

- **P-QA-01** — `tests/e2e/rbac-permissions-ui.spec.ts`: 2 tests com `test.skip(true, ...)`
  aguardando fixture `loginAsAnalista` (só temos `loginAsAdmin`). Requer sub-sprint
  quando fixtures E2E de multi-role forem construídas.
- **P-QA-02** — CI: adicionar step no workflow `.github/workflows/ci.yml` pra rodar
  a suite Sprint 15E dedicada (facilita bisect em CI se algum AC regredir).
- **P-QA-03** — `EXPECTED_ROLE_COUNTS` no helper depende de `permission-matrix.md`
  ser fonte da verdade. Se PO alterar a matrix pós-15E, atualizar constantes.

---

## Sumário para colar no PR do Sprint 15E

```markdown
## Testes

Este PR entrega a implementação. A suite automatizada de 166 tests já está
scaffolded na branch `claude/stupefied-swirles-d55156` (docs/QA_Automation_Report_Sprint_15E.md).

Após rebase:
1. Traga os 5 commits: `git cherry-pick a7bf3a1..6a2d0d0`
2. Em cada `tests/unit/rbac-*.test.ts`: remover `@ts-nocheck` do header +
   trocar `describe.skip(` → `describe(`
3. Baseline deve subir de 609 passing pra ~775

Cobertura: 26/26 ACs. Distribuição 24 Vitest + 1 Supertest + 1 Playwright.
```

---

## Referências

- Spec Sprint 15E: `docs/Sprint_15E_RBAC_Granular.md` (1271 linhas)
- Permission matrix: `docs/permission-matrix.md` (65 permissions × 7 roles)
- Handoff: `docs/HANDOFF_Sprints_15B_a_15E.md`
- Tests base padrão: `tests/unit/audit-context-loss.test.ts`, `tests/unit/tasks-router.test.ts`
- Fixture E2E: `tests/e2e/fixtures/auth.ts`
- Memory: `rbac-granular-pattern.md`, `migration-pitfalls.md`

**Sessão finalizada:** 2026-07-01 15:15 — pronto pra merge do Sprint 15E.
