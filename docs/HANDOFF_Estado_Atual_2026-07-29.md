# Handoff — 2026-07-29

Sprint 15G.5 (Workflow de Transferência de Oportunidade — P-87) com **código
completo e em produção com a flag OFF**. Falta fechar 2 gates antes de ligar a
feature. Substitui [HANDOFF_Estado_Atual_2026-07-17.md](HANDOFF_Estado_Atual_2026-07-17.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `e5da586` (R2). 17 commits do 15G.5 na main.
- **Baseline testes:** **1449 passing / 0 failing / 185 skipped** — cenário SEM
  `DATABASE_URL_TEST` (integration skipada, = CI e dev normal). Type-check zero,
  lint zero.
- **⚠️ Com `DATABASE_URL_TEST` presente** (ex.: `.env.test` local): a suíte de
  integração passa a RODAR e **falha** (harness quebrado — ver §4/P-104). Isso
  NÃO afeta CI (sem DB) nem o baseline verde acima.
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

## 4. 🔴 Gate R1 bloqueado — harness de integração quebrado (P-104)

Rodando os integration tests contra um DB real (branch Neon efêmero `r1-15g5-test`,
expira ~Aug 5) pela **primeira vez no projeto**, TODA a suíte de integração (9
testes em 4 arquivos, incl. `tenant-isolation.test.ts` do Sprint 1) falha com
`"outside tenant context"` — o fail-closed do P-79 em `db/client.ts:419-426`.

- **Não é bug do guard nem do 15G.5.** Prod funciona (o bundler do Next deduplica
  os imports; o extension não fail-closa tráfego legítimo lá).
- **Causa provável:** dupla instância do `AsyncLocalStorage`. `client.ts` importa
  `./tenant-context` (relativo); os testes importam `@/server/db/tenant-context`
  (alias). Se o Vitest não deduplica → `runWithTenant` seta o contexto numa
  instância, o extension lê de outra → parece "sem contexto".
- **Impacto:** o runtime do guard 2c segue **não-validado por integração** (era o
  ponto do R1). Por isso o **flag flip continua gated**.
- **Chip de fix em andamento** (`task_ac4f2535`): padronizar o import / ajustar
  Vitest / envolver setup em `runAsSystem`, **sem enfraquecer o P-79** (é fix de
  segurança). Meta: `opportunity-transfer-guard.test.ts` 7/7 verde.

## 5. Ação humana / próximos passos pro flag flip

1. **R1** — chip de harness fecha → re-rodar `opportunity-transfer-guard.test.ts`
   contra o `.env.test` (branch Neon) → 7/7 verde.
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
| **P-104** | média | Harness de integração quebrado (afeta suíte inteira) — chip em andamento |
| **P-36** | — | Worker BullMQ Railway (bloqueia timeout automático) |
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

**Fim 2026-07-29.** 15G.5 código completo + em prod inerte. Ligar a feature depende
de R1 (harness) + P-36 (worker). Prod seguro com flag OFF.
