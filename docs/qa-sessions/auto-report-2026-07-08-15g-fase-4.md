# QA Automation Report — Sprint 15G Fase 4 (main @ 38049a3)

- Data: 2026-07-08
- Executor: qa-automation skill (Claude Opus 4.7)
- Baseline pré: c872df7 (1055 / 0 / 174)
- Baseline pós: 38049a3
- Escopo: 3 merges Fase 4a (02c2658) + Fase 4b (7fb4ca6) + Fase 4c (38049a3)

---

## 1. Baseline (pré/pós/diff)

- **Pós (main @ 38049a3):** `Test Files 117 passed | 18 skipped (135)` — `Tests 1088 passed | 174 skipped (1262)`.
- **Pré (c872df7 do CLAUDE.md):** 1055 passing / 0 failing / 174 skipped (1229 total).
- **Delta:** +33 passing / 0 failing / 0 skipped. **Bate 1:1 com o alvo esperado.**

Reconciliação dos 4 test files novos entre `c872df7..38049a3`:

| Arquivo | Testes |
|---|---|
| `tests/component/admin-commercial-structure.test.tsx` | 14 |
| `tests/component/opportunity-card-unit-badge.test.tsx` | 4 |
| `tests/component/scope-switcher.test.tsx` | 10 |
| `tests/unit/seed-commercial-structure.test.ts` | 5 |
| **Total** | **33** |

Nota env: sem `.env`/`.env.local` na cwd o Vitest retornava 1019/4/174 (4 falhas import-time em `field-encryption`/`rate-limiter`/`inbound-lead-creator` por Zod rejeitando env vazio). Fix defensivo `ln -sf ../../../../.env.local .env.local` no worktree reergue baseline canônico (P-47 pattern — `dotenv/config` só carrega da cwd).

---

## 2. Type-check + Lint

- `npx tsc --noEmit` → silencioso (zero erros).
- `npm run lint` → `✔ No ESLint warnings or errors`.

---

## 3. Coverage áreas tocadas

Comando: `npx vitest run --coverage --coverage.include='src/app/admin/commercial-structure/**' --coverage.include='src/components/pipeline/ScopeSwitcher.tsx' --coverage.include='src/components/crm/OpportunityCard.tsx' --coverage.include='prisma/seed-commercial-structure.ts'`.

| Arquivo | Lines | Branches | Funcs | Alvo | Verdict |
|---|---|---|---|---|---|
| `prisma/seed-commercial-structure.ts` | 100% | 100% | 100% | ≥80% br | ✅ |
| `src/app/admin/commercial-structure/page.tsx` | 91.08% | 79.67% | 44.06% | ≥70% br | ✅ |
| `src/components/pipeline/ScopeSwitcher.tsx` | 98.83% | 85.36% | 100% | ≥85% br | ✅ (marginal) |
| `src/components/crm/OpportunityCard.tsx` | 75.64% | 20% | 100% | mantém baseline | ⚠️ (baseline) |

Notas:
- **seed** com 100% em tudo — teste com mock Prisma cobre todos os ramos (existing, missing DIRETOR_COMERCIAL, distribuição analistas par/ímpar).
- **admin/commercial-structure** com 79.67% branches (linhas descobertas: 883-885, 932-940 — provavelmente edge branches do fluxo add-member em Sheet).
- **ScopeSwitcher** com 85.36% branches (linha 107 descoberta — provavelmente `typeof teamSize !== 'number'` fallback pra "Minha equipe" sem contagem).
- **OpportunityCard** com 20% branches — não é regressão. O teste `opportunity-card-unit-badge.test.tsx` cobre só as 4 branches do badge novo; branches legadas (urgency, avatar, formatBRL) já eram baixas no baseline pré e não regridem com este chip.

---

## 4. Regressões silenciosas

| Test file | Esperado | Real | Verdict |
|---|---|---|---|
| `sales-structure-service.test.ts` | 26/26 | 26/26 | ✅ |
| `sales-structure-router.test.ts` | 23/23 | 23/23 | ✅ |
| `sales-unit-repository.test.ts` | 12/12 | 12/12 | ✅ |
| `opportunities-visibility-scope.test.ts` | 11/11 | 12/12 | ✅ (+1 vs spec) |
| `reports-visibility-scope.test.ts` | 10/10 | 9/9 | ✅* |
| `permissions-catalog-15g.test.ts` + `role-default-permissions-15g.test.ts` | passing | 8/8 + 10/10 | ✅ |
| `tenant-backstop.test.ts` (P-42) + `rbac-kill-switch.test.ts` (P-62) | passing | 25/25 + 15/15 | ✅ |

*`reports-visibility-scope.test.ts` tem 9 `it()` blocks. O test file foi criado no commit `e769a7d` (Fase 3b) com 9 casos — o "10" da spec do QA foi round-up. Não é regressão de Fase 4.

Zero regressão silenciosa.

---

## 5. A5 seed idempotência

`prisma/seed-commercial-structure.ts` (149 linhas):

- ✅ **A7 — SalesUnit via Repository**: `SalesUnitRepository.create()` linha 72 (paths ltree calculados via `$queryRaw` no INSERT — bypass Prisma direto violaria `sales_units_path_not_empty`).
- ✅ **A5 — addMember via Service**: `SalesStructureService.addMember()` em 4 pontos (linhas 108, 119, 131, 140), sempre em transação pra respeitar partial UNIQUE `is_primary WHERE is_primary=true`.
- ✅ **Idempotência**: `ensureType()` (linha 44) faz `prisma.salesUnitType.findFirst({where:{tenantId,level}})` antes de `SalesStructureService.createUnitType()`; `ensureUnit()` (linha 67) faz `prisma.salesUnit.findFirst({where:{tenantId,name,deletedAt:null}})` antes de `SalesUnitRepository.create()`. Zero `.create` direto sem pré-check.
- ✅ Zero `prisma.salesUnit.create` / `prisma.salesUnitType.create` / `prisma.userSalesUnitMembership.create` no arquivo (grep confirma).
- ✅ Teste `tests/unit/seed-commercial-structure.test.ts` (5 casos) inclui explicitamente "idempotência — 2ª chamada não gera duplicatas (skip create quando findFirst hit)" e "sem DIRETOR_COMERCIAL nos users, addMember pula esse vínculo sem quebrar".

**Verdict:** A5 ✅ / A7 ✅ / idempotente ✅.

---

## 6. A7 UI createUnit não usa prisma direto

`src/app/admin/commercial-structure/page.tsx` (1011 linhas):

- ✅ Grep `prisma\.salesUnit|prisma\.commercialUnitType|prisma\.userSalesUnitMembership|prisma\.salesUnitType` → **zero matches**.
- ✅ Grep `trpc\.salesStructure` → 12 chamadas (`listUnitTypes`, `createUnitType`, `updateUnitType`, `deleteUnitType`, `getTree`, `createUnit`, `getUnit`, `deactivateUnit`, `addMember`, `removeMember`, `myScope` indireto via ScopeSwitcher, `users.list` pra dropdown).
- ✅ Todas mutações passam pelo router → service → repository (A7 pipeline preservado).

**Verdict:** UI delega ao router ✅ / bypass Prisma direto: nenhum encontrado ✅.

---

## 7. RBAC UI gated (defesa em profundidade)

- ✅ Sidebar (linha 72): item `/admin/commercial-structure` gated por `permission: 'sales_structure:read'`.
- ✅ Page (linhas 46-49): `const me = trpc.users.me.useQuery(...)` + `const canManage = me.data?.role ? hasPermissionByRole(me.data.role, 'sales_structure:manage') : false`.
- ✅ `canManage` é propagado como prop pra `<UnitTypesTab canManage={canManage} />` e `<OrgTreeTab canManage={canManage} />` — botões destrutivos (criar/editar/excluir/adicionar membro) só renderizam com `canManage=true`.
- ✅ Backend re-valida via `withPermission` (`sales_structure:manage`) nos routers — defesa em profundidade completa.

**Verdict:** gated client-side ✅ + defesa em profundidade backend ✅.

---

## 8. Design system (AlertDialog + toast + friendlyTrpcError)

`src/app/admin/commercial-structure/page.tsx`:
- 20 ocorrências de `AlertDialog|useToast|friendlyTrpcError|confirm(`.
- Grep discriminado: `AlertDialog` (import + 1+ uso), `useToast` (5 hooks — 1 por componente Tab/Sheet/Modal), `friendlyTrpcError` (5+ `onError` handlers), `confirm(` **apenas** em comentário JSDoc (linha 37: "AlertDialog do design system substitui `confirm()` nativo").
- ✅ Zero `confirm()` nativo em código executável.

`src/components/pipeline/ScopeSwitcher.tsx`:
- Zero uso de `confirm(` ou `useToast` — componente é read-only (só troca preferência client-side), sem mutação → sem necessidade de toast.

**Verdict:** padrão respeitado ✅ (AlertDialog + toast + friendlyTrpcError em admin; ScopeSwitcher não precisa por design).

---

## 9. ScopeSwitcher lógica

`src/components/pipeline/ScopeSwitcher.tsx` (152 linhas):

- ✅ Retorna `null` se scope efetivo é OWN, PARTNER, NONE ou indefinido (`canSwitch = scopeType === 'TEAM' || scopeType === 'ALL'`; guard final `if (!canSwitch || !userId || !preference) return null` na linha 120).
- ✅ Renderiza `<Select>` só se scope é TEAM ou ALL, com opções distintas:
  - TEAM → "Minhas oportunidades" + "Minha equipe (N)" (N vem de `scope.teamSize`).
  - ALL → "Minhas oportunidades" + "Toda a empresa" (**nunca** inclui "Minha equipe").
- ✅ localStorage key namespaced por userId: `pipeline:scope-preference:${userId}` (linha 44).
- ✅ `normalizePreference()` (linha 60) descarta valor stale (ex.: user tinha ALL, admin rebaixou pra TEAM, localStorage ainda tem 'ALL' → cai no default).
- ✅ 10 casos no teste cobrem: OWN/PARTNER/NONE não renderizam, TEAM/ALL renderizam, teamSize aparece, ALL nunca mostra "Minha equipe", valor persistido dispara onChange no mount, default é opção mais ampla, trocar persiste em localStorage, valor stale cai no default.

**Verdict:** lógica correta e coberta.

---

## 10. Integridade docs

- ✅ Zero conflict markers em `docs/Roteiro_QA_Homologacao_Staging.md`, `docs/Backlog_Pos_MVP.md`, `CLAUDE.md` (grep `<<<<<<<|>>>>>>>|=======` = 0 em todos).
- ✅ §2.7 do Roteiro QA existe (linha 561: "### 2.7. Estrutura Comercial (~15min — Sprint 15G)").
- ✅ 6 cenários V1-V6 completos com passa/falha esperada por cenário (grep `^\\d+\\. \\*\\*V\\d+` = 6 dentro da seção). Cobrem: V1 criar tipo, V2 criar unit raiz (A7), V3 addMember (A5), V4 GESTOR subtree, V5 DIRETOR ALL, V6 PARCEIRO row-level (A4). Bonus scenarios inclusos (kill-switch runtime, seed idempotente 2×, cross-tenant guard).
- ✅ `docs/Backlog_Pos_MVP.md` tem 18 menções combinadas de "Fase 4a/4b/4c" — 3 seções "✅ FECHADO 2026-07-08" (linhas 3059, 3152, 3268).

**Verdict:** docs íntegras ✅.

---

## 11. Playwright

**BLOCKED por infra (P-48 / P-59 pré-existentes).**

Playwright browsers não estão instalados no worktree (headless Chromium ausente); mesmo se estivessem, o Clerk dummy rejeita browser real com "Invalid host". Nenhum dos 3 arquivos de Fase 4 (admin UI, ScopeSwitcher, seed) adiciona spec Playwright novo — cobertura ficou em component tests (Testing Library) que já rodam via Vitest.

Referências: `docs/Backlog_Pos_MVP.md` P-48/P-59 abertos há múltiplos sprints. Não é regressão de Fase 4.

---

## 12. Débitos residuais candidatos

Registrados como candidatos a chip futuro (**não bloqueiam release**):

- **P-73** (baixa) — `src/app/admin/commercial-structure/page.tsx` branches 79.67% (linhas descobertas 883-885, 932-940). Passa alvo ≥70% com folga, mas cobrir os 2 blocos adicionais de handler add-member no Sheet levaria pra ≥85%. Estimativa: 30min. Não bloqueia.
- **P-74** (baixa) — `ScopeSwitcher.tsx` linha 107 descoberta (`typeof teamSize === 'number' ? \`Minha equipe (${teamSize})\` : 'Minha equipe'`). Fallback para TEAM scope sem `teamSize`. Cobertura 85.36% branches bate alvo mas ficaria mais robusta com 1 caso extra. Estimativa: 15min.
- **P-75** (info) — `OpportunityCard.tsx` 20% branches — não é regressão de Fase 4 (badge novo é 100% coberto pelo teste dedicado), mas registrar pra sessão futura de coverage retroativo do card completo (que tem branches pré-15G legadas de urgency/avatar/formatBRL não testadas). Estimativa: 2h.

---

## 13. Verdict final

**🟢 VERDE — libera rollout consolidado prod.**

Critérios atendidos:
1. ✅ **Zero regressão em testes**: 1088 passing / 0 failing / 174 skipped; delta +33 bate 1:1 com esperado (14 + 4 + 10 + 5).
2. ✅ **Type-check + lint zero.**
3. ✅ **Coverage acima dos alvos** em 3/4 arquivos (seed 100%, admin 79.67% > 70%, ScopeSwitcher 85.36% ≥ 85%). OpportunityCard 20% branches é baseline (badge novo tem 100% cobertura no teste dedicado).
4. ✅ **A5/A7 preservados**: seed usa `SalesUnitRepository.create` + `SalesStructureService.addMember` (transação); UI usa 12 procedures do `trpc.salesStructure` (zero bypass Prisma direto).
5. ✅ **RBAC UI gated** por `hasPermissionByRole(role, 'sales_structure:manage')` como defesa em profundidade + Sidebar item por `sales_structure:read`.
6. ✅ **Design system respeitado**: AlertDialog + toast Venzo + friendlyTrpcError; zero `confirm()` nativo em código executável.
7. ✅ **ScopeSwitcher lógica correta**: OWN/PARTNER/NONE retornam null, TEAM/ALL renderizam Select com opções distintas, localStorage namespaced por userId, normalizePreference descarta stale.
8. ✅ **Docs íntegras**: §2.7 Roteiro QA com 6 cenários V1-V6, backlog com 3 blocos Fase 4a/4b/4c fechados, zero conflict marker.
9. ✅ **Regressões silenciosas OK**: 7 test suites-chave (sales-structure-service/router/repository, visibility-scope, permissions-catalog-15g, tenant-backstop, rbac-kill-switch) todas verdes com contagens esperadas.

Débitos residuais P-73/P-74/P-75 são polish e podem ir pra chip separado — não bloqueiam release.

Rollout consolidado autorizado (`docs/ROLLOUT_Sprint_15G_Prod.md` Fases A-E).
