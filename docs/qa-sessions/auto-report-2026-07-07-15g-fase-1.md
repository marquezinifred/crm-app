# QA Automation Report — Sprint 15G Fase 1 (main @ 8b66bdc)

Data: 2026-07-07
Executor: qa-automation skill via subagent
Baseline PRÉ: `44ca49e` (docs process, pré-merges 15G)
Baseline PÓS: `8b66bdc` (Merge Sprint 15G Fase 1b)

Merges cobertos:
- `dbc193a` — Merge Sprint 15G Fase 1a: migration 0031 estrutura comercial + SalesUnitRepository
- `8b66bdc` — Merge Sprint 15G Fase 1b: catálogo permissions + rbac matriz + backfill A2

Modo QA: **Modo B (bloco)** — merge Fase 1a + Fase 1b em conjunto contra baseline pré-15G.

---

## 1. Baseline (pré/pós/diff)

| Nível | Pré (`44ca49e`) | Pós (`8b66bdc`) | Delta | Esperado | Status |
|-------|-----------------|-----------------|-------|----------|--------|
| Test files | 104 passed / 18 skipped (122) | 109 passed / 18 skipped (127) | +5 files | +5 files | ✅ |
| Tests passing | **944** | **985** | **+41** | +41 | ✅ |
| Tests failing | 0 | 0 | 0 | 0 | ✅ |
| Tests skipped | 174 | 174 | 0 | 0 | ✅ |
| Tests total | 1118 | 1159 | +41 | +41 | ✅ |

**Baseline verde preservado.** Delta exato (+41): 20 Fase 1a + 21 líquido Fase 1b.

Novos test files (5): `sales-unit-repository`, `ltree-path-generation`, `permissions-catalog-15g`, `role-default-permissions-15g`, `15g-migrate-permissions-script`.

---

## 2. Type-check

| Estado | Errors |
|--------|--------|
| Pré | 0 |
| Pós | 0 |
| Delta | 0 |

`npx tsc --noEmit` exit=0 em ambos os commits.

---

## 3. Lint

| Estado | Warnings / errors |
|--------|-------------------|
| Pré | 0 |
| Pós | 0 |
| Delta | 0 |

`npm run lint` reporta "No ESLint warnings or errors" em ambos.

---

## 4. Coverage das áreas tocadas

Executado no HEAD pós (`8b66bdc`) com include estendido pra pegar `scripts/`:

| Arquivo | Lines | Branches | Funcs | Alvo | Status |
|---------|-------|----------|-------|------|--------|
| `src/server/db/repositories/sales-unit.repository.ts` | 100% | 100% | 100% | ≥90% br / 100% funcs | ✅ |
| `src/lib/auth/permissions-catalog.ts` | 100% | 100% | 100% | 100% | ✅ |
| `src/lib/auth/rbac.ts` | 92.19% | 93.33% | 40% | ≥90% na matriz | ✅ (matriz) |
| `scripts/15g-migrate-permissions.ts` | 94.01% | 93.33% | 100% | ≥80% br | ✅ |
| `src/lib/utils/short-id.ts` | 100% | 100% | 100% | 100% | ✅ |

**Notas:**
- `rbac.ts` funcs 40% reflete que os testes 15G exercitam só `ROLE_DEFAULT_PERMISSIONS` (matriz literal) — outras funções (`hasCapability`, `canCreateOpportunity` etc) são cobertas por suites legadas fora do subset selecionado. Cobertura da matriz Sprint 15G especificamente (linhas 273+) atinge alvo ≥90%.
- `scripts/` fora do `coverage.include` padrão (`src/**` only); rodei re-execução dedicada com `--coverage.include=scripts/**/*.ts` pra capturar o número.

Nenhuma área tocada abaixo do alvo. Zero débito residual de coverage.

---

## 5. Regressões críticas

Rodei explicitamente 12 suites potencialmente afetadas + baseline completo. **Zero regressão detectada.**

Suites verificadas em regressão dedicada:
- `permissions-catalog.test.ts` — 7 casos passing
- `permissions-catalog-15g.test.ts` — 8 casos passing
- `role-default-permissions.test.ts` — 20 casos passing
- `role-default-permissions-15g.test.ts` — 10 casos passing
- `permissions-router.test.ts` — 11 casos passing
- `rbac-kill-switch.test.ts` — 15 casos passing (P-62 preservado)
- `tenant-backstop.test.ts` — 25 casos passing (P-42 preservado)
- `env-boolean-parsing.test.ts` — 10 casos passing (P-60 preservado)
- `env-schema-regression.test.ts` — 1 caso passing (proíbe `z.coerce.boolean(`)
- `sales-unit-repository.test.ts` — 12 casos passing (novo)
- `ltree-path-generation.test.ts` — 8 casos passing (novo)
- `15g-migrate-permissions-script.test.ts` — 4 casos passing (novo)

Total dedicado: **131/131 passing**.

| Teste | file:line | Erro | Causa | Fix | Prioridade |
|-------|-----------|------|-------|-----|------------|
| — | — | — | — | — | — |

**Vazio.** Zero regressão.

---

## 6. Padrões arquiteturais

| Padrão | Status | Evidência |
|--------|--------|-----------|
| **P-42 backstop** (`assertTenantWritePayload`) | ✅ Intacto | `git log 44ca49e..8b66bdc -- src/server/db/client.ts` vazio; função e 3 call sites em `client.ts:31,192,199,207` preservados |
| **envBoolean §4.9** (proíbe `z.coerce.boolean`) | ✅ | `SALES_STRUCTURE_ENABLED: envBoolean(false)` em `src/lib/env.ts:124`; `env-schema-regression.test.ts` passa |
| **Kill-switch P-62 SALES_STRUCTURE_ENABLED** | 🟡 Consumer runtime não implementado (esperado — Fase 2) | `grep -rn 'SALES_STRUCTURE_ENABLED' src/` retorna só `src/lib/env.ts:124`. Flag existe no schema mas não tem consumer que module comportamento — Fase 2 vai plumbar em `visibilityWhere()` do opportunities.ts. Registrado como débito **candidato P-73** (info-only, não bloqueia Fase 1). |
| **RBAC §4.5 anti-escalada** (guard grant/revoke/restore) | ✅ Preservado | `src/server/trpc/routers/permissions.ts:33,51,60,297` — guard `callerHas = await hasPermission(callerId, permission)` intacto |
| **CHECK A7 `sales_units_path_not_empty`** | ✅ | `prisma/migrations/0031_estrutura_comercial/migration.sql:88-91` — `CHECK (path::text != '' AND path::text ~ '^[a-zA-Z0-9._]+$')` |
| **Partial unique A5 `one_primary_per_user`** | ✅ | `migration.sql:134-136` — `CREATE UNIQUE INDEX sales_unit_members_one_primary_per_user ... WHERE is_primary = true` |
| **A1 SQL backfill idempotente** | ✅ | `migration.sql:35` (`CREATE EXTENSION IF NOT EXISTS ltree`), :164, :188, :218 (`ON CONFLICT DO NOTHING` em cada INSERT de backfill) |
| **A2 script backfill idempotente + audit** | ✅ | `scripts/15g-migrate-permissions.ts:132-138` — loop `for (const [tenantId, userIds] of usersByTenant.entries())` + `audit({ tenantIdOverride: tenantId, recordId: '15g-fase1b-<tenantId>' })`; suite dedicada de 4 casos cobre idempotência (segunda execução no-op) e ON CONFLICT DO NOTHING |
| **Cross-tenant queries em SalesUnitRepository** | ✅ | 6 `$queryRaw` — todos filtram por `tenant_id`. 25 menções tenantId no arquivo. Verificado bloco a bloco (INSERT no `create`, `getSubtreeMemberIds` join com dupla verificação `mgr_unit.tenant_id` + `sub_unit.tenant_id` + `mgr_membership.tenant_id`, `getTree`, `getAncestors` `target.tenant_id`, `getChildren`) |

---

## 7. Integridade docs

- **`docs/Backlog_Pos_MVP.md` bloco Sprint 15G:** presente e coerente
  - Seção `### Sprint 15G — Estrutura Comercial e Visibilidade Hierárquica` linha 2492
  - Sub-seção `Fase 1a — Fundação schema + Repository ✅ FECHADO 2026-07-07` linha 2497
  - Sub-seção `### Sprint 15G Fase 1b — Catálogo + Roles matriz ✅ FECHADO 2026-07-07` linha 2596
- **Conflict markers residuais:** 0 (grep de `<<<<<<<|>>>>>>>|=======` em `Backlog_Pos_MVP.md` retorna 0 matches de conflict; `=======` só aparece como separador de comentário em `rbac.ts` e migration)
- **TODO/FIXME nos novos arquivos:** 0 (grep em repository, catalog, rbac, script, short-id, migration + 5 test files novos = zero matches)

---

## 8. Playwright

Rodado `npx playwright test tests/e2e/smoke.spec.ts --project=chromium-desktop`:

```
Running 3 tests using 3 workers
  ✓  2 tests/e2e/smoke.spec.ts:13:5 health endpoint retorna ok ou 503 (4.3s)
  ✓  1 tests/e2e/smoke.spec.ts:8:5 home renderiza (5.4s)
  ✓  3 tests/e2e/smoke.spec.ts:21:5 auto-cadastro público de contato renderiza form (5.6s)

  3 passed (7.0s)
```

**3/3 passing.** Zero regressão E2E smoke.

Warning informativo do webserver (não bloqueia):
- `Clerk: Missing CLERK_ENCRYPTION_KEY` — pré-existente (Sprint 15G Fase 1 não toca Clerk); registrado como débito residual do handoff staging (fora de escopo QA).

---

## 9. Débitos residuais candidatos

| ID | Descrição | Severidade | Observação |
|----|-----------|------------|------------|
| **P-73** (candidato) | `SALES_STRUCTURE_ENABLED` sem consumer runtime | 🟢 Info | Esperado — Fase 2 vai plumbar em `visibilityWhere()`. Flag documentada no schema. Não invalida promessa de rollback rápido porque o repository ainda não é consumido em produção. Sem ação necessária pra Fase 1. |

Nenhum débito bloqueante. Zero débito AMARELO ou VERMELHO.

---

## 10. Verdict final

## 🟢 VERDE

**Justificativa (3-5 frases):**

Baseline pré/pós bate 1:1 com o esperado (944 → 985 = **+41 exato**, zero failing, zero delta em skipped). Todos os 8 padrões arquiteturais críticos preservados — P-42 backstop intacto, envBoolean §4.9 aplicada em `SALES_STRUCTURE_ENABLED`, RBAC §4.5 guard anti-escalada preservado, CHECK A7 + partial unique A5 na migration, A1 SQL backfill e A2 script backfill ambos idempotentes com `ON CONFLICT DO NOTHING` / audit `tenantIdOverride`. Cross-tenant validation confirma que todas as 6 `$queryRaw` em `SalesUnitRepository` filtram por `tenant_id` (incluindo join triplo em `getSubtreeMemberIds` — a query mais crítica de segurança). Coverage das 5 áreas tocadas atinge/supera os alvos (100% em repository/catalog/short-id, 94% branches no script, 92% na matriz rbac.ts). Type-check zero, lint zero, Playwright smoke 3/3.

**Recomendação: 🟢 Libera Fase 2.**

Nenhuma evidência de regressão. Backend fundação Sprint 15G está sólido. Fase 2 pode começar com confiança — próximos passos incluem consumir `SalesUnitRepository.getSubtreeMemberIds` no `visibilityWhere()` de `opportunities.ts` e ligar `SALES_STRUCTURE_ENABLED` como kill-switch runtime (fechando o débito P-73 candidato acima ao mesmo tempo).

---

## Anexo — Comandos executados

```bash
# Baseline PRÉ
git checkout 44ca49e
npm test -- --run           # 944/0/174
npx tsc --noEmit            # exit 0
npm run lint                # exit 0

# Baseline PÓS
git checkout 8b66bdc
npm test -- --run           # 985/0/174
npx tsc --noEmit            # exit 0
npm run lint                # exit 0

# Coverage áreas tocadas (7 files)
npx vitest run --coverage \
  tests/unit/sales-unit-repository.test.ts \
  tests/unit/ltree-path-generation.test.ts \
  tests/unit/permissions-catalog.test.ts \
  tests/unit/permissions-catalog-15g.test.ts \
  tests/unit/role-default-permissions.test.ts \
  tests/unit/role-default-permissions-15g.test.ts \
  tests/unit/15g-migrate-permissions-script.test.ts

# Coverage script (include estendido)
npx vitest run --coverage \
  --coverage.include='scripts/**/*.ts' \
  tests/unit/15g-migrate-permissions-script.test.ts

# Regressões
npx vitest run <12 suites afetadas>   # 131/131 passing

# Padrões arquiteturais — verificação estática via grep + git log
git log 44ca49e..8b66bdc -- src/server/db/client.ts   # (vazio → P-42 intacto)

# Playwright smoke
npx playwright test tests/e2e/smoke.spec.ts --project=chromium-desktop   # 3/3

# Restauração
git checkout claude/laughing-vaughan-00231d           # HEAD = 8b66bdc
```
