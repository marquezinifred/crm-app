# Handoff — 2026-07-11 (fim da tarde)

Chips Semana 1 (P-88 + P-89 + P-86) concluídos + QA Modo B **VERDE**.
Prontos pra deploy prod — aguardando ação humana pra `vercel --prod`.

Substitui [HANDOFF_Noturno_2026-07-08.md](HANDOFF_Noturno_2026-07-08.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `bd6e096` — 3 commits novos em cima de `4a411fa`
  - `bd6e096` fix(P-86): wire dropdown Papel + botao Desativar em /admin/users
  - `f727125` fix(P-89): pipeline/new redirect + button disabled apos success
  - `11539c3` fix(P-88): sidebar RBAC gate em Users/Products/Listas
- **Baseline testes:** **1111 passing / 0 failing / 175 skipped (1286 total)** — delta +24 vs pré-chips (1088/0/174)
- **Type-check:** zero errors
- **Lint:** zero warnings
- **Playwright smoke:** 3/3 passing
- **QA Modo B:** 🟢 VERDE, sem regressão detectada, coverage nos alvos
- **Deploy Vercel Production:** ⚠️ **ainda no deploy `dpl_2Gxv3sk...` (6 dias atrás)** — chips não deployados prod ainda
- **Worker BullMQ Railway:** ainda não subiu (P-36 pendente, não bloqueia hoje)

## 2. O que rolou hoje

**Modo canônico ativo:** gestão + chips + QA Modo B único integrado.

3 chips rodaram em paralelo em background (arquivos disjuntos, sem worktree):

| Chip | Commit | Escopo | Delta tests |
|------|--------|--------|-------------|
| **P-88** | `11539c3` | Sidebar RBAC gate em /admin/users, /admin/products, /admin/listas | +8 |
| **P-89** | `f727125` | pipeline/new redirect + button disabled | +6 |
| **P-86** | `bd6e096` | wire dropdown Papel + AlertDialog Desativar em /admin/users | +10 |

**QA Modo B único** rodou depois → verdict 🟢 VERDE (report em `docs/qa-sessions/auto-report-2026-07-11-chips-semana-1.md`).

**Bônus do P-86:** toast success "Convite enviado." adicionado ao Convidar (fora do escopo original, melhoria consistente).

## 3. Nota importante do P-88 pra atenção

Com o fix P-88, **DIRETOR_COMERCIAL / DIRETOR_OPERACOES / DIRETOR_FINANCEIRO também deixam de ver** items "Usuários / Produtos / Listas" no menu — não têm `user:update` nem `catalog:update` (só `:read`).

Consistente com backend (`adminOnlyProcedure` = só ADMIN passa em write). Se algum dia precisar diretores com acesso **somente-leitura** a essas telas, exigirá permissions novas (`user:read_admin_page` ou similar). Fora do escopo.

## 4. Ação humana pendente pra você (quando voltar)

### 🔴 Deploy prod dos 3 chips (~3min)

Os fixes estão na main mas não em prod. Rodar:

```bash
cd ~/Claude/crm-app
vercel --prod
```

Aguarda ~3-4min pro build + deploy. Confirma:
```bash
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health
vercel ls --prod | head -3
```

Deployment ID novo deve aparecer com "Age" recente (segundos/minutos).

### 🟡 P-80 (Neon separation) — 30-45min

Você me disse que faz quando tiver 30-45min. Passos:
1. Neon Console → CRM-DEV → Branches → Create branch `production-live` a partir de `staging`
2. Copia connection string do novo branch
3. Vercel Dashboard → Settings → Environment Variables → edit `DATABASE_URL` (Production) → cola nova connection string → Save
4. `vercel --prod` pra Functions pegarem env atualizada
5. Smoke test: `curl https://crm-app-pi-eight.vercel.app/api/v1/health`

### 🟡 P-85 (Clerk Production instance) — 1-2h

Mais complexo. Quando tiver disponibilidade:
1. Clerk Dashboard → criar Production instance
2. Reconfigurar JWT template (claims `public.tenantId`, `public.role`, `public.platformRole`)
3. Reconfigurar webhook endpoint apontando pra `crm-app-pi-eight.vercel.app/api/clerk/webhook`
4. Trocar `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_...` → `pk_live_...`) e `CLERK_SECRET_KEY` no Vercel Production
5. Migrar 5 usuários existentes via Clerk User Migration API OU comunicar re-registro
6. `vercel --prod` + smoke test + testar login

## 5. Débitos residuais dos chips (opcionais)

| ID | Item | Severidade |
|----|------|-----------|
| P-90 (novo) | Coverage funcs em `admin/users/page.tsx` (36%) — estender testes com filtros/render de tabela | 🟢 Baixa |
| — | Variação +1 skipped sem causa identificada nos 3 arquivos — observação pra futuro chip | 🟢 Documental |

Nenhum bloqueia deploy.

## 6. Estado consolidado dos débitos pós-rollout Sprint 15G

| ID | Status | Commit / Ação |
|----|--------|---------------|
| **P-86** | ✅ Fechado hoje | `bd6e096` — aguarda deploy prod |
| **P-88** | ✅ Fechado hoje | `11539c3` — aguarda deploy prod |
| **P-89** | ✅ Fechado hoje | `f727125` — aguarda deploy prod |
| P-80 | 📋 Ação humana | Neon separation — 30-45min |
| P-85 | 📋 Ação humana | Clerk Production — 1-2h |
| P-87 | 📋 Sprint 15G.5 | Workflow transferência — 6-7 dias dedicados |
| P-82 | 📋 Sprint 16 | Loop 401 → tela dedicada |
| P-81 | 📋 Housekeeping | Runbook recovery pós-restore Neon |
| P-83 | 📋 Housekeeping | Partial UNIQUE (tenant_id, email) |
| P-84 | 📋 Housekeeping | Convidar reativa soft-deleted |
| P-90 (novo) | 📋 Housekeeping | Coverage funcs admin/users |

## 7. Roadmap curto (revisado)

**Amanhã (~2-3h de sua ação humana):**
1. `vercel --prod` — deployar os 3 chips
2. P-80 (Neon separation)
3. P-85 (Clerk Production instance)

**Sprint 15G.5 (semana que vem, 6-7 dias):**
- P-87 completo (migration 0032 + 7 procedures + worker cron + 3 telas + notificações)
- Sprint dedicado — não cabe em chip nem no 15H

**Sprint 15H (após 15G.5, 8-10 dias):**
- Blocos A + B + C originais (P-77 reconcile + Metas + owner.primaryUnit.name)

**Housekeeping paralelo (qualquer momento):**
- P-83, P-84, P-81, P-90

## 8. Comandos úteis pra retomar

```bash
# Estado do repo
cd ~/Claude/crm-app
git log --oneline -5
git status

# Testes
npm test          # esperado 1111/0/175

# Deploy prod (quando você autorizar)
vercel --prod
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health

# QA report dos chips
cat docs/qa-sessions/auto-report-2026-07-11-chips-semana-1.md
```

## 9. Referências

- **Planejamento débitos v3:** [Planejamento_Debitos_Pos_Rollout_15G.md](Planejamento_Debitos_Pos_Rollout_15G.md)
- **QA report dos chips:** [qa-sessions/auto-report-2026-07-11-chips-semana-1.md](qa-sessions/auto-report-2026-07-11-chips-semana-1.md)
- **Handoff anterior:** [HANDOFF_Noturno_2026-07-08.md](HANDOFF_Noturno_2026-07-08.md)
- **Metodologia:** [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- **Rollout Sprint 15G:** [ROLLOUT_Sprint_15G_Prod.md](ROLLOUT_Sprint_15G_Prod.md)

---

**Fim do dia 2026-07-11.** Aguarda ação humana pra deploy prod + P-80 + P-85 quando você voltar.
