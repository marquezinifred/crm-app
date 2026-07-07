# QA Automation Report — Sprint 15G Fase 2 (main @ fc30588)

**Data:** 2026-07-07
**Executor:** qa-automation skill (Claude Code)
**Modo:** automated (unit only — Playwright ausente no worktree)
**Worktree:** `.claude/worktrees/competent-jennings-a46365`
**Node/npm:** v26.0.0 / 11.12.1
**Vitest:** 2.1.9

**Baselines comparados:**
- **PRÉ:** `f903871` — "docs(qa): QA Modo B Sprint 15G Fase 1 verde"
- **PÓS:** `fc30588` — "Merge Sprint 15G Fase 2b: router sales-structure" (main atual)

**Merges cobertos:**
```
0668ac5 Merge Sprint 15G Fase 2a: SalesStructureService + resolveOpportunityScope
fc30588 Merge Sprint 15G Fase 2b: router sales-structure
```

**Env context:** worktree sem `.env.local` — apenas `.env.example`. Cenário CI-like documentado no CLAUDE.md § Baseline; failing pré-existente em `field-encryption.test.ts` é padrão do ambiente.

---

## 1. Baseline (pré/pós/diff)

| Métrica       | PRÉ (f903871) | PÓS (fc30588) | Delta |
|---------------|---------------|---------------|-------|
| Passing       | 916           | 965           | **+49** ✅ |
| Failing       | 4             | 4             | 0 (idênticos, pré-existentes) |
| Skipped       | 174           | 174           | 0 |
| Total tests   | 1094          | 1143          | +49 |
| Test files    | 127 (10 fail) | 129 (10 fail) | +2 (mesmos 10 fails pré-existentes) |

**Delta 1:1 com esperado**: 26 novos casos em `sales-structure-service.test.ts` + 23 novos casos em `sales-structure-router.test.ts` = **+49 testes exatamente**.

**4 failings pré-existentes idênticos**: todos em `tests/unit/field-encryption.test.ts` por ausência de `TENANT_FIELD_ENCRYPTION_KEY` no worktree. Confirmados no PRÉ (f903871) com mesma mensagem `Invalid environment variables`. Zero regressão de código real.

**10 test files failed pré-existentes**: falha no import por env vars ausentes (rate-limiter.service.ts:2:31, field-encryption.ts:2:31, etc.). Comportamento idêntico pré/pós. Cenário documentado no CLAUDE.md § "Baseline atual" como esperado quando roda sem `.env.local` na cwd.

---

## 2. Type-check

```bash
$ npx tsc --noEmit
TSC_EXIT=0
```

**Zero erros.** ✅

---

## 3. Lint

```bash
$ npm run lint
✔ No ESLint warnings or errors
LINT_EXIT=0
```

**Zero warnings/erros.** ✅

---

## 4. Resolução do conflito service.ts (implementação real preservada)

**Contexto:** Fase 2b entrou primeiro com stub temporário de `sales-structure.service.ts` (98 linhas, `throw "não implementado"` em todos os helpers) como contrato compartilhado. Fase 2a entregou implementação real (287 linhas). Merge resolveu com `git checkout --ours` preservando 2a.

**Verificações:**

| Check | Comando | Esperado | Resultado |
|-------|---------|----------|-----------|
| Stub eliminado | `grep -c "não implementado — aguardando Fase 2a"` | 0 | **0** ✅ |
| resolveOpportunityScope presente | `grep -c "resolveOpportunityScope"` | ≥1 | **3** ✅ |
| Tamanho do arquivo | `wc -l` | ~287 (impl real) | **287** ✅ (não 98 do stub) |
| P-73 kill-switch | `grep -n "env.SALES_STRUCTURE_ENABLED"` | presente | **linha 71** (1º check da função) ✅ |

**Impl real preservada no merge.** ✅

---

## 5. Coverage das áreas tocadas

Executado: `npx vitest run tests/unit/sales-structure-*.test.ts --coverage`

```
File                     | % Stmts | % Branch | % Funcs | % Lines | Uncovered
sales-structure.service.ts |  98.80  |  96.96   |  100    |  98.80  | 74-75
sales-structure.ts (router)|  100    |  100     |  100    |  100    | —
All files                  |  99.51  |  98.24   |  100    |  99.51  |
```

**Alvos batidos:**
- `sales-structure.service.ts` — alvo ≥90% branches / 100% funcs → **96.96% branches / 100% funcs** ✅
- `sales-structure.ts` (router) — alvo ≥85% branches / 100% funcs → **100% / 100%** ✅

**Uncovered lines 74-75** (service): edge case duplo dentro do bloco `if (!env.SALES_STRUCTURE_ENABLED)` quando `user.role === 'PARCEIRO' && !user.partnerCompanyId` → retorna scope `NONE`. Simetria funcional coberta nas linhas 98-100 (mesmo edge case no path flag=true). Não é bloqueador; débito residual opcional listado em §11.

---

## 6. Regressões críticas — suites de fundação

Executado: `npm test tests/unit/{sales-unit-repository,permissions-catalog-15g,role-default-permissions-15g,rbac-kill-switch,tenant-backstop}.test.ts`

| Suite | Testes | Status | Cobre |
|-------|--------|--------|-------|
| `sales-unit-repository.test.ts` | 12/12 | ✅ | Fase 1a — Repository consumido pelo Service |
| `permissions-catalog-15g.test.ts` | 8/8 | ✅ | Fase 1b — catálogo `sales_structure:*` |
| `role-default-permissions-15g.test.ts` | 10/10 | ✅ | Fase 1b — defaults por role |
| `rbac-kill-switch.test.ts` | 15/15 | ✅ | P-62 preservado |
| `tenant-backstop.test.ts` | 25/25 | ✅ | P-42 preservado |
| **TOTAL** | **70/70** | ✅ | **Zero regressão** |

**Suites novas:**
- `sales-structure-service.test.ts` — **26/26** ✅
- `sales-structure-router.test.ts` — **23/23** ✅

---

## 7. Cross-tenant validation (11 procedures)

**Router expõe 11 procedures**:
- `canReadStructure` (3): `listUnitTypes`, `getTree`, `getUnit`
- `canManageStructure` (7): `createUnitType`, `updateUnitType`, `deleteUnitType`, `createUnit`, `deactivateUnit`, `addMember`, `removeMember`
- `protectedProcedure` (1): `myScope`

**Cross-tenant guards:**
- Router delega pro Service em CRUD (updateUnitType, deleteUnitType, getUnit, createUnit, deactivateUnit, addMember, removeMember) — Service faz `findFirst({ where: { id, tenantId } })` antes de qualquer mutação; discrepância vira `NOT_FOUND` (evita enumeration).
- Verificado no code: `addMember` faz `Promise.all([prisma.salesUnit.findFirst({...tenantId}), prisma.user.findFirst({...tenantId})])` com NOT_FOUND se ambos ausentes.

**Testes cross-tenant explícitos:**
- `tests/unit/sales-structure-router.test.ts` — **9 refs a `NOT_FOUND`/cross-tenant** (excede o mínimo "3 procedures")
- `tests/unit/sales-structure-service.test.ts` — **7 refs a `NOT_FOUND`/cross-tenant**

**Cross-tenant coverage OK.** ✅

---

## 8. Padrões arquiteturais (P-73 fechado, A4, A5, A7, P-42, RBAC, audit)

### 8.1 P-73 fechado — kill-switch runtime real

**Requisito:** `env.SALES_STRUCTURE_ENABLED` consumido em `resolveOpportunityScope` como **PRIMEIRO check**.

```
sales-structure.service.ts:67  async resolveOpportunityScope(user, tenantId) {
sales-structure.service.ts:71    if (!env.SALES_STRUCTURE_ENABLED) {   ← 1º check ✅
sales-structure.service.ts:72      if (user.role === 'PARCEIRO') { ...
```

**Path flag=false** preserva comportamento pré-15G (PARCEIRO row-level + `opportunity:read_team|all` legado). **Path flag=true** ativa hierarquia (SalesUnitRepository.getSubtreeMemberIds). Rollback reversível.

**P-73 fechado.** ✅

### 8.2 A4 — PARCEIRO early-return em ambos os paths

```
sales-structure.service.ts:72   (flag=false) if (user.role === 'PARCEIRO') { ... return PARTNER/NONE }
sales-structure.service.ts:97   (flag=true)  if (user.role === 'PARCEIRO') { ... return PARTNER/NONE }
```

PARCEIRO nunca chega no path `hasPermission('opportunity:read_all|team')` — early-return rígido. **A4 preservado.** ✅

### 8.3 A5 — partial unique `is_primary` via `$transaction`

```
sales-structure.service.ts:233   await prisma.$transaction([...])
```

Docstring do `addMember` explicita: "quando `isPrimary=true`, roda em transação atômica — desmarca outras primary do user antes do upsert. Sem isso, dois writes concorrentes podem produzir 2 rows com `is_primary=true` no mesmo user."

**A5 preservado.** ✅

### 8.4 A7 — router NUNCA usa `prisma.salesUnit.create` direto

```
grep "prisma.salesUnit.create" src/server/trpc/routers/sales-structure.ts
27:  *  - Convenção A7: `createUnit` NUNCA usa `prisma.salesUnit.create`  ← comentário
229: * ⚠️ CRÍTICO Emenda A7: NUNCA usar `prisma.salesUnit.create` direto.  ← comentário
```

As 2 ocorrências são **comentários warning documentando "NUNCA"**, não chamadas reais.

```
grep -c "SalesUnitRepository" src/server/trpc/routers/sales-structure.ts
7  ← Repository usado consistentemente
```

**A7 preservado.** ✅

### 8.5 P-42 — backstop tenant-isolation preservado

```
git log f903871..fc30588 -- src/server/db/client.ts
(vazio — zero mudança)
```

Zero commit tocou `src/server/db/client.ts`. Backstop `assertTenantWritePayload` intacto. Suite `tenant-backstop.test.ts` verde (25/25). **P-42 preservado.** ✅

### 8.6 RBAC granular §4.5 — `withPermission` em todas mutations

```
sales-structure.ts:32  const canReadStructure = withPermission('sales_structure:read');
sales-structure.ts:33  const canManageStructure = withPermission('sales_structure:manage');
```

- 3 procedures de read → `canReadStructure` ✅
- 7 procedures de manage → `canManageStructure` ✅
- 1 procedure `myScope` → `protectedProcedure` (role-aware sem check adicional — spec §4.5)

**RBAC OK.** ✅

### 8.7 Audit §4.4 — `tenantIdOverride: ctx.tenantId` em toda mutation do router

```
sales-structure.ts:113  await audit({ ... tenantIdOverride: ctx.tenantId, ... })
sales-structure.ts:142  await audit({ ... tenantIdOverride: ctx.tenantId, ... })
sales-structure.ts:172  await audit({ ... tenantIdOverride: ctx.tenantId, ... })
sales-structure.ts:254  await audit({ ... tenantIdOverride: ctx.tenantId, ... })
sales-structure.ts:303  await audit({ ... tenantIdOverride: ctx.tenantId, ... })
```

5 audit calls no router (createUnitType, updateUnitType, deleteUnitType, createUnit, deactivateUnit). `addMember`/`removeMember` delegam pro Service que fez audit interno (spec §4.4 aceita — linha 322-323 do router: "o audit interno").

**Audit OK.** ✅

---

## 9. Integridade docs

- **Zero conflict markers** em `src/` ou `docs/Backlog_Pos_MVP.md` (`grep -rn "^<<<<<<< \|^>>>>>>> \|^=======$"` retornou vazio) ✅
- **Zero TODO/FIXME/XXX** em `sales-structure.service.ts` e `sales-structure.ts` (router) ✅
- **`docs/Backlog_Pos_MVP.md`** contém 16 referências a "Fase 2a"/"Fase 2b" — blocos presentes e concatenados ✅

---

## 10. Playwright

**BLOCKED por infra.** Worktree sem `node_modules/.bin/playwright`. Sprint 15G Fase 2 é backend-only (Service + Router, sem consumer runtime na UI ainda — Fase 3 spec). Zero regressão E2E esperada.

Registrar em Fase 3 QA que quando a UI consumir `salesStructure.myScope`, Playwright smoke.spec deve incluir cenário mínimo.

---

## 11. Débitos residuais candidatos

Nenhum bloqueador identificado. Débitos opcionais para consideração futura (não bloqueiam Fase 3):

| ID candidato | Descrição | Severidade |
|--------------|-----------|-----------|
| P-74 (opcional) | Cobrir lines 74-75 do `sales-structure.service.ts` (edge case: `!SALES_STRUCTURE_ENABLED` + PARCEIRO sem partnerCompanyId → NONE scope). Coverage já em 98.8%, simetria funcional coberta em 98-100 no path flag=true; ganho de cobertura marginal para 100%. | Baixa |

---

## 12. Verdict final

### 🟢 VERDE — libera Sprint 15G Fase 3

**Justificativa:**
1. ✅ Delta baseline = **+49 exato** (26 service + 23 router), zero regressão
2. ✅ 4 failings pré-existentes idênticos entre pré/pós (env vars — não relacionado ao merge)
3. ✅ Type-check zero, lint zero
4. ✅ Conflito service.ts resolvido preservando implementação real (287 linhas), stub eliminado
5. ✅ Coverage acima dos alvos: service 98.8%/96.96%/100% (alvo 90/90/100), router 100%/100%/100% (alvo 85/85/100)
6. ✅ **P-73 fechado** — kill-switch runtime real, primeiro check em `resolveOpportunityScope`, rollback reversível
7. ✅ A4 (PARCEIRO early-return), A5 ($transaction em addMember), A7 (Repository, não prisma direto) — todos preservados
8. ✅ P-42 backstop intacto (client.ts sem mudança, suite verde 25/25)
9. ✅ P-62 kill-switch RBAC granular preservado (15/15)
10. ✅ 5 suites de fundação (Fase 1a + Fase 1b + P-42 + P-62) verdes: 70/70
11. ✅ RBAC granular §4.5: `withPermission` correto nos 10 procedures + `protectedProcedure` em `myScope`
12. ✅ Audit §4.4: `tenantIdOverride` em todas as 5 mutation calls do router
13. ✅ Cross-tenant coverage: 9 refs no router + 7 no service (acima do mínimo)
14. ✅ Zero conflict markers, zero TODO/FIXME em arquivos novos

**Decisão:** Libera início da Sprint 15G Fase 3 (consumer runtime na UI + integração com `opportunities.list`/`kanban`).

**Sem chip de fix necessário.** Débito P-74 opcional pode virar low-priority backlog.

---

*Report gerado automaticamente pela qa-automation skill em 2026-07-07 19:53 BRT.*
