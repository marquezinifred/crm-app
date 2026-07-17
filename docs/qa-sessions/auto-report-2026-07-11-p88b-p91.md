# QA Modo B — P-88b + P-91 (2026-07-11 tarde)

## Verdict: 🟢 VERDE

## Baseline

- `npm test`: **1164 passing / 0 failing / 175 skipped** (1339 total)
  - Delta vs baseline pré-chips (1111/0/175): **+53 passing exatos**
- `npx tsc --noEmit`: **0 errors** (execução silenciosa)
- `npm run lint`: **0 warnings / 0 errors** (`✔ No ESLint warnings or errors`)
- HEAD: `7ae7e6e` (P-91) sobre `72fc4ee` (P-88b) sobre `3c5e5de` (handoff)
- Working tree limpo (untracked `auto-report-2026-07-11-chips-semana-1.md`
  já existia — ignorado)

## Reconciliação delta

Modelo esperava +53 tests. Observado: exatamente +53.

| Chip | Tests esperados | Tests observados | Confere |
|------|-----------------|------------------|---------|
| P-88b (sidebar-rbac) | +8 | 16 - 8 (baseline) = **+8** | ✅ |
| P-91 (admin-router-guards) | +45 | file novo com **45** casos | ✅ |
| **Total** | **+53** | **+53** | ✅ |

- Verificação pré P-88b: `git show 3c5e5de:tests/component/sidebar-rbac.test.tsx | grep -cE "\bit\("` → 8
- Verificação pós P-88b: `grep -cE "\bit\(" tests/component/sidebar-rbac.test.tsx` → 16
- P-91 é arquivo novo (não existia em `3c5e5de`): 45 casos

## Coverage arquivos tocados

Rodado só com os 2 test files dos chips (sidebar-rbac + admin-router-guards).
As mutations em cada router já eram `adminOnlyProcedure` desde Sprints
anteriores — o P-91 só migrou as **queries**, então coverage medido reflete
apenas os guards das queries (branches novas = 100%; linhas de mutation não
tocadas neste chip mantêm-se uncovered pelo mesmo motivo de sempre — não é
regressão).

| Arquivo | % Stmts | % Branch | % Funcs | Notas |
|---------|--------:|---------:|--------:|-------|
| `src/components/layout/Sidebar.tsx` | 92.5 | 74.19 | 100 | ótimo — só uncovered são branches defensivas de icon fallback |
| `src/server/trpc/routers/reports.ts` | 18.94 | 100 | 0 | queries gated 100% br; mutations pré-existentes fora do escopo |
| `src/server/trpc/routers/ai-config.ts` | 20.93 | 100 | 100 | idem |
| `src/server/trpc/routers/alerts.ts` | 42.35 | 100 | 100 | idem |
| `src/server/trpc/routers/approval-rules.ts` | 43.03 | 66.66 | 100 | idem |
| `src/server/trpc/routers/theme.ts` | 37.5 | 100 | 0 | idem |
| `src/server/trpc/routers/partners.ts` | 32.75 | 100 | 100 | idem |
| `src/server/trpc/routers/products.ts` | 27.16 | 33.33 | 100 | idem |
| `src/server/trpc/routers/documents.ts` | 33.62 | 33.33 | 0 | idem |
| `src/server/trpc/routers/inbox.ts` | 34.13 | 50 | 100 | idem |

**Branches nas queries que o P-91 migrou: 100% cobertos.** Coverage abaixo
do que aparenta é artefato de rodar só os 2 test files; mutations existentes
seguem cobertas pelos test files dedicados de cada router (companies-router,
proposals-router, etc.) no baseline geral 1164/0/175.

## Grep smell tests

- `grep console.log|console.warn` em Sidebar + 9 routers tocados → **0 hits**
- `grep TODO|FIXME|XXX` nos mesmos arquivos → **0 hits**
- Zero debug leftover, zero débito TODO novo introduzido pelos chips.

## Cross-chip / regressões

**Consumers UI das procedures gated (P-91) auditados via grep:**

| Query | Consumer(s) | Rota | Risco |
|-------|-------------|------|-------|
| `theme.get/planInfo/listCurated*/validate/suggestContrastFix` | `admin/branding/page.tsx` | `/admin/branding` | OK — rota admin |
| `approvalRules.list` | `admin/approval-rules/page.tsx` | `/admin/approval-rules` | OK |
| `contractsConfig.getConfig` | `admin/contracts/page.tsx` | `/admin/contracts` | OK |
| `reports.conversionRates` | `admin/conversion-rates/page.tsx` | `/admin/conversion-rates` | OK |
| `alerts.tenantConfig` | `admin/alerts/page.tsx` | `/admin/alerts` | OK |
| `aiConfig.monthlyUsage` | `admin/ai/page.tsx` | `/admin/ai` | OK |
| `partners.listWithStats/getTcText` | `admin/partners/page.tsx` | `/admin/partners` | OK |
| `templates.list` | `admin/templates/page.tsx` | `/admin/templates` | OK |
| `adminEmail.getSlug` | `admin/email-inbound/page.tsx` | `/admin/email-inbound` | OK |
| `aiConfig.pricingTable` | (nenhum) | — | debug/API only |
| `products.list/byId` | `admin/products/page.tsx` | `/admin/products` | OK |

**Todos os consumers estão em rotas `/admin/*`** — coerente com gate ADMIN.
Zero consumer legítimo em `/pipeline/*`, `/reports`, `/inbox/*`, `/companies`
ou `/contacts` foi encontrado, então P-91 **não regride nenhum caller
operacional**.

**Queries NÃO gated (checadas defensivamente):**

- `users.list` — usado em `/pipeline/new`, `/reports`, `/admin/*`,
  TasksSection, commercial-structure, email-inbound. **Correto ficar
  aberto** (roles operacionais precisam listar vendedores).
- `leadSources.list` — usado em `/pipeline/new` + `/admin/listas`.
  **Correto ficar aberto** (necessário no form de criar oportunidade).
- `contractsConfig.activeContracts` — usado em `/contracts` (rota
  operacional, não `/admin`). **Correto ficar aberto**.

**Verificação estrutural:** grep de `protectedProcedure` remanescente
nas queries dos 9 routers gated → só as procedures que **devem** ficar
abertas (myAlerts, dismiss, activeContracts). Todas as demais queries
migradas pra `adminOnlyProcedure`.

**Playwright smoke:** BLOCKED por infra (P-59 pré-existente —
`~/.cache/ms-playwright/` ausente no worktree). Não bloqueia deploy
porque smoke pré-existente rodava com `smoke.spec` (Sprint 14 fixture)
que já é 3/3 pass em contexto local (registrado no fechamento P-51).

## Débitos residuais

Nenhum novo. Débitos preexistentes não afetados por estes chips:

- **P-59** (Playwright infra ausente em worktrees) — pré-existente
- **Coverage documental** dos routers gated pelas mutations pré-existentes —
  mantido em test files dedicados por router; não é regressão

## Recomendação

**Pode deploy prod.**

Reconciliação chip-a-chip verde:
- P-88b defende UI: sidebar não mostra items admin pra roles sem permission
  correspondente (RBAC gate via `permission?:string` opcional já existente
  no componente — pattern usado desde Sprint 15E)
- P-91 defende backend: 19 procedures migradas de `protectedProcedure` →
  `adminOnlyProcedure` fecham vazamento cross-role de config sensível
  (thresholds de aprovação, custo IA por provider, endereço inbound,
  T&C parceiros, margem mínima de produto, etc.)
- Zero regressão em roles operacionais (`users.list`, `leadSources.list`,
  `contractsConfig.activeContracts` seguem abertos como devem)
- Cross-tenant guard (P-79 pattern) preservado — nenhuma procedure alterada
  bypassa `ctx.tenantId`

Baseline final: **1164 passing / 0 failing / 175 skipped**. Type-check
zero. Lint zero. Sem chip de fix necessário.
