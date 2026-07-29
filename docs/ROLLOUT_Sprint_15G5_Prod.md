# Rollout Sprint 15G.5 — Workflow de Transferência de Oportunidade (Prod)

Kill-switch `OPPORTUNITY_TRANSFER_ENABLED` (default `false`) permite deploy do
código **inerte** em prod e ativação gradual com rollback trivial (virar a flag).

Spec: `docs/Sprint_15G5_Transferencia_Oportunidade.md`.

---

## Estado atual (2026-07-29)

| Passo | Estado |
|-------|--------|
| Migration `0032_opportunity_transfers` → `production-live` (`ep-rapid-fog-ajm1hdvb`) | ✅ **aplicada** |
| Deploy código (`dpl_7yazhGtCiinu9TfDvVhA8bMA4TUY`, HEAD `b7e4a43`) | ✅ **READY**, aliased `crm-app-pi-eight.vercel.app` |
| `OPPORTUNITY_TRANSFER_ENABLED` em prod | **AUSENTE** → default `false` → feature inerte |
| Smoke `/api/v1/health` | ✅ `db: ok` (warm ~124ms) |
| **R1 + R2** (gates de teste do flip) | ✅ **FECHADOS** (2026-07-29) — ver abaixo |
| **Flag flip** (`=true`) | ⏳ **PENDENTE** — falta só P-36 (worker, soft) + o flip |

O código está 100% em prod, **dormente**: guard de write inerte (lê a flag e
retorna cedo), procedures retornam FORBIDDEN, badge não renderiza (`activeTransfer`
sempre `null` com flag OFF — T16), botões de disparo se auto-escondem.

---

## Ordem obrigatória do rollout (por que migration vem ANTES do código)

⚠️ **`opportunities.byId` tem `include: { currentTransfer }` INCONDICIONAL** (não
gateado pela flag — o resumo `activeTransfer` é que é gateado, o include roda
sempre). Logo a query exige a tabela `opportunity_transfers` + coluna
`current_transfer_id` no banco **mesmo com a flag OFF**. Subir o código antes da
migration quebraria todo `/pipeline/[id]` em prod (relation/coluna inexistente).

**Sequência correta (a que foi executada):**
1. `prisma migrate deploy` → aplica `0032` no `production-live`.
2. `vercel --prod` → deploy do código (flag OFF).
3. Smoke `/api/v1/health` (tolerar 1ª falha por cold-start do Neon; re-testar).
4. [depois] Flip da flag — **gated por R1/R2**.

### Comando prod-safe da migration (NUNCA imprimir o secret)

Não usar `cut`/`tr`/`echo` sobre a connection string (padrão que vazou senha no
P-32). Fazer sourcing sem echo, num único bloco (env não persiste entre shells):

```bash
vercel env pull .env.prod.tmp --environment=production --yes
set -a; . ./.env.prod.tmp; set +a      # carrega DATABASE_URL sem imprimir
npx prisma migrate status               # verificar: só 0032 pendente
npx prisma migrate deploy               # aplicar
rm -f .env.prod.tmp                      # remover o arquivo de secret
```

`migrate status` deve mostrar o endpoint `ep-rapid-fog-ajm1hdvb` (prod) e
`0032_opportunity_transfers` como única pendente — **gate de segurança** contra
aplicar no DB errado.

---

## Flag flip (ativação) — PENDENTE, com 2 gates

Os dois gates de teste do QA Modo A do guard 2c (spec §9.2) estão **fechados**:

- ✅ **R1** — integration do guard contra Postgres real (branch Neon `r1-15g5-test`):
  **7/7 verde** (2026-07-29, commit `37c40eb`). Provou anti-recursão + carve-outs
  T19 no runtime. Fechou de quebra o **P-104** (harness de integração: thunk lazy
  perdia o AsyncLocalStorage; fix em testes/fixtures, P-79 intocado). Re-rodar:
  ```bash
  # com .env.test apontando pro branch Neon de teste:
  npx vitest run tests/integration/opportunity-transfer-guard.test.ts
  ```
- ✅ **R2** — kill-switch OFF executável (`isTransferGuardEnabled`, parse literal
  P-60). Commit `e5da586`, verde.

**Falta só P-36** (worker Railway) pro timeout automático — **não bloqueia** o flip
(sem ele, PENDING vencidas se resolvem manualmente).

### Procedimento do flip (quando R1+R2 verdes)

1. Vercel Dashboard → Settings → Environment Variables → **Add**
   `OPPORTUNITY_TRANSFER_ENABLED = true` (Production).
2. `vercel --prod` (redeploy pra Functions pegarem a env) **ou** promover deploy.
3. Smoke autenticado: disparar uma transferência de teste (ancestor → destino),
   aceitar com newOwner da subárvore, confirmar read-only do dono, cancelar/rejeitar.
4. Monitorar `audit_logs` (`opportunity.owner_transferred`) + Sentry 24-48h.

> **Worker de timeout:** o `opportunity-transfer-timeout.worker` só expira PENDING
> vencidas quando o worker BullMQ estiver rodando (Railway — P-36 pendente). Sem o
> worker, transferências não expiram sozinhas; disparador/destinatário resolvem
> manualmente. Não bloqueia o flip, mas o timeout automático só vale com P-36.

---

## Rollback

- **Antes do flip:** nada a fazer — feature já está OFF.
- **Depois do flip:** setar `OPPORTUNITY_TRANSFER_ENABLED=false` (ou remover a var)
  + redeploy. Guard volta inerte, badges somem, PENDING existentes ficam no banco
  (retomam ao religar; o worker expira as vencidas). **Reversível sem migração** —
  o schema 0032 fica inerte no banco.
- A migration 0032 é aditiva (tabela/enum/colunas novas); não precisa reverter no
  rollback da feature.

---

## Referências

- Spec + emendas T1-T19: `docs/Sprint_15G5_Transferencia_Oportunidade.md`
- QA Modo A guard 2c (R1/R2): `docs/qa-sessions/auto-report-2026-07-24-15g5-2c-guard.md`
- QA Modo B Fase 3: `docs/qa-sessions/auto-report-2026-07-24-15g5-fase3.md`
- Padrão Neon 2 branches (P-80): `docs/HANDOFF_Estado_Atual_2026-07-17.md`
- Rollout 15G (referência do padrão): `docs/ROLLOUT_Sprint_15G_Prod.md`
