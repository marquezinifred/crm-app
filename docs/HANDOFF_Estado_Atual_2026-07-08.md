# Handoff — 2026-07-08

Sprint 15G — Estrutura Comercial e Visibilidade Hierárquica — **fechado**.
4 fases, 12 chips, 4 QAs Modo B, 3 dias corridos. Baseline 944 → 1088
(+144 tests). Aguarda rollout consolidado prod.

Substitui [HANDOFF_Estado_Atual_2026-07-06.md](HANDOFF_Estado_Atual_2026-07-06.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `<commit atual pós merge Fase 4 + QA>` — CLAUDE.md atualizado com Sprint 15G ✅
- **Baseline testes** (paterna, env dummy consistente):
  - `npm test`: **1088 passing / 0 failing / 174 skipped** (1262 total)
  - `npx tsc --noEmit`: zero
  - `npm run lint`: zero
- **Deploy Vercel production:** ainda no `dpl_HjfvdgUskbzmj8bnVGVrUeUPziwD` (2026-07-06 — P-65+P-66 merged, baseline 944).
  - **Sprint 15G NÃO deployado** — aguarda rollout consolidado do Fred seguindo `docs/ROLLOUT_Sprint_15G_Prod.md`
- **Worker BullMQ Railway:** ainda não subiu (P-36 pendente ação Fred)

## 2. Sprint 15G — resumo executivo

**Objetivo cumprido:** substituir `opportunity:read_others` binário por
`read_team` (subárvore ltree) + `read_all` (tenant inteiro). Backend +
schema + UI + seed + roteiro QA.

**Entregue em 4 fases:**

| Fase | Chips | Baseline | QA |
|------|-------|----------|-----|
| 1 — Schema + permissions | 1a + 1b | 944 → 985 (+41) | 🟢 |
| 2 — Service + router | 2a + 2b | 985 → 1034 (+49) | 🟢 |
| 3 — Consumers migrados | 3a + 3b | 1034 → 1055 (+21) | 🟢 |
| 4 — UI + seed + roteiro | 4a + 4b + 4c | 1055 → 1088 (+33) | 🟢 |

**Total: 8 chips de código + 4 chips de QA = 12 chips. 4 verdicts VERDES.**

## 3. Padrões arquiteturais preservados (todos verdes no QA final)

- ✅ **A1 backfill idempotente**: migration 0031 cria unidade "Padrão" por tenant
- ✅ **A2 script idempotente**: `npm run 15g:migrate-permissions` migra overrides
- ✅ **A3 emenda cumprida**: reports migrados no Fase 3b, não pra 15H
- ✅ **A4 PARCEIRO early-return**: centralizado no service (0 duplicação nos routers)
- ✅ **A5 partial unique**: `$transaction` em addMember protege is_primary
- ✅ **A7 nunca prisma.salesUnit.create direto**: UI + seed usam Repository
- ✅ **P-42 backstop intocado**: `db/client.ts` sem mudança nas 4 fases
- ✅ **P-62 RBAC kill-switch**: preservado (25/25)
- ✅ **P-73 kill-switch runtime real**: fechado — consumer único em `sales-structure.service.ts:71`
- ✅ **Sprint 5 ANALISTA em performanceByOwner**: preservado (2 tests dedicados)
- ✅ **RBAC UI defesa em profundidade**: client-side + backend `withPermission`
- ✅ **Design system**: AlertDialog + toast + friendlyTrpcError (zero `confirm()` nativo)

## 4. Débitos residuais Sprint 15G (não bloqueiam rollout)

Todos opcionais — polish, sem impacto de segurança:

| ID | Origem | Item | Esforço | Severidade |
|----|--------|------|---------|-----------|
| P-73* | QA Fase 4 | admin/commercial-structure branches 79.67% (passa alvo 70%) | 30min | 🟢 |
| P-74* | QA Fase 4 | ScopeSwitcher linha 107 (fallback teamSize) | 15min | 🟢 |
| P-75* | QA Fase 4 | OpportunityCard 20% branches — pré-existente, badge novo 100% | 2h | 🟢 |

*IDs renumerados no backlog (P-73/74/75 do Fase 4 QA são distintos dos P-73-76 anteriores — sessão paterna pode consolidar em housekeeping).

## 5. Rollout Sprint 15G prod — próximo passo

**Ação humana Fred:** seguir `docs/ROLLOUT_Sprint_15G_Prod.md` Fases A-E:

1. **Fase A** — Preparação (verificar health + Neon PITR) — 5min
2. **Fase B** — Deploy código com flag OFF (`vercel --prod`) — 10min
3. **Fase C** — Migration 0031 (`npx prisma migrate deploy` — backfill A1 idempotente) — 5min
4. **Fase D** — Backfill permissions (`npm run 15g:migrate-permissions`) — 5min
5. **Fase E** — Ativar `SALES_STRUCTURE_ENABLED=true` no Vercel Dashboard — sem redeploy, efetivo em 2min. Monitorar 24-48h.

**Rollback trivial:** flag `false` volta pro path pré-15G. Sem redeploy.

## 6. Sprint 15H — pipeline

Spec inicial: `docs/Sprint_15H_Metas_e_Approvals.md`.

**Bloco A — Reconcile de Approvals (P-77)** — fecha débito arquitetural
descoberto no P-67. Worker daily `approvals-reconcile` marca approvals
órfãs (approver_id fixo desatualiza quando role/rule muda). Migration 0032.

**Bloco B — Metas por Unidade** — aproveita `SalesUnitRepository`. Tabela
`sales_quotas` + service + UI drill-down `/reports/quota-tree`. Migration 0033.

**Bloco C — Estender opportunities.list com owner.primaryUnit.name** —
badge Fase 4b passa a mostrar unidade real.

Total ~10 dias. **Aguarda:** rollout 15G estabilizar 48h em prod.

## 7. Ações humanas pendentes

| Item | Esforço | Bloqueia? |
|------|---------|-----------|
| **Rollout Sprint 15G prod** (5 fases guia executável) | ~45min ativo + 48h monitoramento | 🔴 Sprint 15H espera 48h estável |
| **P-36** Railway worker deploy | 30min-2h | Sprint 15H bloco A (worker approval-reconcile) |
| **P-25** Ativar `MULTI_AI_ENABLED=true` prod (Sprint 15F rollout) | 15min + 3-5d monitor | Independente |
| **Task #22** Validar visualmente P-08 a P-12 em prod | 30min | Independente |
| **Task #23** Testar IA end-to-end | Depende créditos Anthropic | Independente |

## 8. Comandos úteis pra retomar

```bash
# Estado do repo
cd /Users/fredmarqueziniyahoo.com.br/Claude/crm-app
git log --oneline -10
git status

# Testes
npm test                  # esperado 1088/0/174
npx tsc --noEmit          # zero
npm run lint              # zero

# Prod health (ainda no deploy 2026-07-06)
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health

# Rollout Sprint 15G (quando Fred estiver pronto)
cat docs/ROLLOUT_Sprint_15G_Prod.md
```

## 9. Referências rápidas

### Docs vivos
- **CLAUDE.md** — Sprint 15G bloco novo no topo
- **Metodologia** — [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md) (v corrigida com 2 modos)
- **Roteiro QA** — [Roteiro_QA_Homologacao_Staging.md](Roteiro_QA_Homologacao_Staging.md) §2.7 novo (6 cenários V1-V6)
- **Backlog** — [Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — Sprint 15G 4 fases fechadas + P-73/74/75 residuais

### Sprint 15G
- **Spec original PO** — [Sprint_15G_estrutura_comercial.md](Sprint_15G_estrutura_comercial.md)
- **Amendments A1-A7** — [Sprint_15G_amendments.md](Sprint_15G_amendments.md)
- **Rollout guide** — [ROLLOUT_Sprint_15G_Prod.md](ROLLOUT_Sprint_15G_Prod.md) 🔴 próxima ação
- **QA reports arquivados**:
  - [Fase 1](qa-sessions/auto-report-2026-07-07-15g-fase-1.md)
  - [Fase 2](qa-sessions/auto-report-2026-07-07-15g-fase-2.md)
  - [Fase 3](qa-sessions/auto-report-2026-07-07-15g-fase-3.md)
  - [Fase 4](qa-sessions/auto-report-2026-07-08-15g-fase-4.md)

### Sprint 15H (planejado)
- **Spec inicial** — [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)

### Memórias
- [rbac-granular-pattern.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-granular-pattern.md) — Sprint 15E
- [rbac-kill-switch-runtime.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md) — P-62/P-73 pattern
- [tenant-backstop-lesson.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/tenant-backstop-lesson.md) — P-42
- [migration-pitfalls.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/migration-pitfalls.md) — 5 padrões
- [env-boolean-parsing.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/env-boolean-parsing.md) — P-60
- [crm-app-setup-state.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/crm-app-setup-state.md) — contas + setup

## 10. Próximo passo recomendado

1. **Ler Metodologia §11.4 + §16.1** (gate deploy + case study QA pulado)
2. **Fred autoriza rollout prod?** Se sim → seguir `ROLLOUT_Sprint_15G_Prod.md` Fases A-E
3. **Após rollout estável 48h em prod:**
   - Fechar sprint 15G no HANDOFF novo (2026-07-10 ou depois)
   - Spawnar chips Sprint 15H (bloco A P-77 primeiro; bloco B metas depois)
4. **Enquanto rollout observa:**
   - Ações humanas pendentes P-36, P-25, tasks 22/23 podem ir em paralelo
   - Débitos P-73/74/75 residuais opcionais (housekeeping quando fizer sentido)

---

**Última atualização:** 2026-07-08 pós QA Fase 4 verde.
