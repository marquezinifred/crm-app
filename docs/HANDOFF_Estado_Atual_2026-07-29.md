# Handoff — 2026-07-29

Sprint 15G.5 (Workflow de Transferência de Oportunidade — P-87) com **código
completo e em produção com a flag OFF**. Falta fechar 2 gates antes de ligar a
feature. Substitui [HANDOFF_Estado_Atual_2026-07-17.md](HANDOFF_Estado_Atual_2026-07-17.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `37c40eb` (R1-fix). 18 commits do 15G.5 na main.
- **Baseline testes:** **1463 passing / 0 failing / 185 skipped** — cenário SEM
  `DATABASE_URL_TEST` (integration skipada, = CI e dev normal). Type-check zero,
  lint zero.
- **Com `DATABASE_URL_TEST` presente** (ex.: `.env.test` local): a suíte de
  integração agora RODA e **passa** (23 passed / 5 skipped) — harness consertado
  (P-104 fechado, ver §4).
- **Deploy Vercel Production:** `dpl_7yazhGtCiinu9TfDvVhA8bMA4TUY` (HEAD `b7e4a43`,
  flag OFF). Health verde. Feature de transferência **inerte** em prod.
- **Banco prod:** `production-live` (`ep-rapid-fog-ajm1hdvb`) com **migration 0032
  aplicada**.
- **Worker BullMQ Railway (P-36):** ainda não subiu — bloqueia o timeout
  automático de transferências (não bloqueia o resto).

## 2. O que rolou (Sprint 15G.5 completo)

Modo canônico: gestão (coordena) + chips via `spawn_task` (sessões separadas) +
QA Modo B por fase + **QA Modo A no chip de módulo core (guard 2c)**. Zero código
escrito pela gestão.

- **Fase 1** — schema (migration 0032) + `TransferScopeService` (autoridade
  estrutural ltree, T13/T14/T10). QA Modo B 🟢.
- **Fase 2** — router `opportunityTransfers` (2a) + worker timeout + notificações
  (2b) + **guard de write na Prisma extension (2c, Modo A)**. QA Modo B (2a+2b) 🟢
  + QA Modo A (2c, adversarial na branch) 🟢. P-99 cobre o notification service.
- **Fase 3** — 3 telas (disparo/read-only/histórico em `/pipeline/[id]`; fila do
  destinatário `/inbox/transferencias-recebidas`; acompanhamento do disparador
  `/pipeline/transferencias-em-andamento`) + 2 queries de listagem + `activeTransfer`
  flag-gated no `byId`. QA Modo B 🟢.
- **Fase 4 (parcial)** — migration 0032 → prod + deploy código (flag OFF) + smoke.
  R2 fechado; R1 bloqueado; doc de rollout escrito.

Spec + emendas T1–T19: [Sprint_15G5_Transferencia_Oportunidade.md](Sprint_15G5_Transferencia_Oportunidade.md).
Rollout: [ROLLOUT_Sprint_15G5_Prod.md](ROLLOUT_Sprint_15G5_Prod.md).
QA reports: `docs/qa-sessions/auto-report-2026-07-2{0,1,4}-*.md`.

## 3. Ordem crítica do rollout (lição)

`opportunities.byId` tem `include: { currentTransfer }` **incondicional** (não
gateado pela flag). Então o Prisma exige a tabela `opportunity_transfers` no banco
**mesmo com a flag OFF** — a **migration 0032 tem que ir pra prod ANTES do código**,
senão `/pipeline/[id]` quebra. Foi respeitado no deploy. Regra geral pra futuros
sprints com kill-switch: o flag protege a LÓGICA, não o SCHEMA que o Prisma client
referencia. Ver memory `migration-before-code-deploy`.

## 4. ✅ Gate R1 fechado — harness de integração consertado (P-104 resolvido)

Rodando os integration tests contra um DB real (branch Neon efêmero `r1-15g5-test`,
expira ~Aug 5) pela **primeira vez no projeto**, TODA a suíte de integração (9
testes em 4 arquivos, incl. `tenant-isolation.test.ts` do Sprint 1) falhava com
`"outside tenant context"` — o fail-closed do P-79 em `db/client.ts:419-426`.

- **Não era bug do guard nem do 15G.5.** Prod sempre funcionou.
- **Causa raiz real (não era a hipótese):** **thunk lazy** — os testes passavam
  `() => prisma.x()` que era avaliado FORA do escopo do `runWithTenant`, perdendo
  o `AsyncLocalStorage`. (Não era relativo-vs-alias; esse deduplica no Vitest.)
  Ver memory `als-lazy-thunk-fail-closed`.
- **Fix (`37c40eb`):** 100% em testes/fixtures — `client.ts` e o P-79 **intocados**.
  `opportunity-transfer-guard.test.ts` → **7/7 verde** (carve-outs T19 provadas no
  runtime). Suíte de integração inteira verde (23 passed / 5 skipped). P-42
  (tenant-backstop) 25/25.
- **R1 é gate FECHADO.** Junto com R2, os dois gates de teste do flip estão verdes.

## 5. Ação humana / próximos passos pro flag flip

1. ✅ **R1** — fechado (7/7 no runtime real). ✅ **R2** — fechado.
2. **P-36** — subir o worker BullMQ no Railway (necessário pro timeout automático;
   spec `docs/DEPLOY_Railway_Worker.md`). Sem ele, transferências não expiram
   sozinhas.
3. **Flip:** setar `OPPORTUNITY_TRANSFER_ENABLED=true` no Vercel Production +
   redeploy + smoke autenticado (disparar/aceitar/rejeitar/cancelar) + monitorar
   `audit_logs` (`opportunity.owner_transferred`) 24-48h. Procedimento detalhado
   no `ROLLOUT_Sprint_15G5_Prod.md`.

## 6. Débitos abertos

| ID | Sev | Item |
|----|-----|------|
| **P-104** | ✅ fechado | Harness de integração (thunk lazy) — `37c40eb`, suíte inteira verde |
| **P-36** | — | Worker BullMQ Railway (bloqueia timeout automático, NÃO o flip) |
| **P-85** | — | Clerk Production instance (bloqueado por domínio — decisão Fred) |
| P-100 | baixa | Caminho TIMED_OUT duplicado worker×service |
| P-101/102/103 | baixa | Cosméticos Fase 3 (isLoading vs isPending, act() warning, branch coverage) |
| R3–R7 | baixa | Follow-ups do guard 2c (spec §9.2) |
| P-81/82/83/84 | baixa | Housekeeping antigo (runbook recovery, loop 401, partial UNIQUE email, reativar soft-deleted) |

## 7. Recursos ativos a lembrar

- **Branch Neon `r1-15g5-test`** (`ep-ancient-hall-ajs42nhq`) — efêmero, expira
  ~2026-08-05. Usado pelo chip R1-fix. `.env.test` local aponta pra ele (gitignored).
- **Chip R1-fix** `task_ac4f2535` rodando.

## 8. Comandos úteis

```bash
cd ~/Claude/crm-app
git log --oneline -5
npm test                    # 1449/0/185 (SEM .env.test)
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health
# R1 (com .env.test presente):
npx vitest run tests/integration/opportunity-transfer-guard.test.ts
```

---

**Fim 2026-07-29.** 15G.5 código completo + em prod inerte. **R1 + R2 fechados**
(gates de teste verdes). Ligar a feature depende só de P-36 (worker, pro timeout)
+ o flag flip. Prod seguro com flag OFF.
