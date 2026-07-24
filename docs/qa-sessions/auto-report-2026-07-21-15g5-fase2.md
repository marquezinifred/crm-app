# QA Modo B — Sprint 15G.5 Fase 2 (router + worker) — 2026-07-21

## Verdict: 🟢 VERDE — **2a + 2b prontos, seguir para o chip 2c (guard extension, Modo A)**

Os dois chips de backend da Fase 2 estão integrados na main (`de70f0e` 2a +
`1d88447` 2b). Baseline **1321 / 0 / 178** bate 1:1 com o esperado; type-check e
lint zero. Router `opportunityTransfers` (7 procedures) com kill-switch (T3),
cross-tenant explícito (T6), audit com `tenantIdOverride` (T4), máquina de estado
(T8), race → CONFLICT (T1), anti-escalada no approve (T10) e troca de owner via
audit **nunca stageHistory** (T17) — todos presentes e testados. Worker de timeout
idempotente, best-effort por tenant e no-op sob flag OFF. **Coverage do router
98,34%**; worker 82,29% (uncovered = wrapper BullMQ, convenção do repo). Delta de
testes reconcilia **+57 exatos**, zero failing, zero regressão.

O escopo desta Fase 2 é só backend router + worker; **o guard de write na Prisma
extension (chip 2c) ainda não existe e não foi penalizado** (sequenciado por
último, Modo A, per T18). Dois débitos residuais registrados abaixo (P-99, P-100),
nenhum bloqueante.

---

## Commits verificados (estado integrado real)

- `de70f0e` **feat(15g5-2a)** — router `opportunityTransfers` (7 procedures) +
  `transfer-notification.service.ts` (4 arquivos, **1489 ins / 0 del**)
- `1d88447` **feat(15g5-2b)** — worker timeout + 7 templates de notificação
  (6 arquivos, **845 ins / 2 del** — as 2 deleções são as 2 linhas `console.info`
  de boot dos workers em `index.ts`, estendidas com o texto do transfer-timeout;
  nada de comportamento removido)
- Worktree `claude/blissful-heisenberg-ed3375` contém ambos os commits no topo
  (`de70f0e` → `1d88447` → `87cc8e3` docs T18). Verificação sobre o merge real.
- **Diffs 100% aditivos** — únicos arquivos compartilhados tocados: `_app.ts`
  (+2: import + registro), `index.ts` (+listener/cron/close), `queues.ts` (+8:
  queue name + job data), `templates.ts` (+263, sem deleção). Nenhum template ou
  rota pré-existente modificado.

---

## Baseline (itens 1–3 do checklist)

| Gate | Resultado | Esperado | Status |
|------|-----------|----------|--------|
| `npx vitest run` | **1321 passing / 0 failing / 178 skipped** (1499 total) | ~1321 / 0 / 178 | ✅ bate 1:1 |
| Test Files | **133 passed / 19 skipped** (152) | — | ✅ |
| `npx tsc --noEmit` | **0 errors** (exit 0) | 0 | ✅ |
| `npm run lint` | **✔ No ESLint warnings or errors** (exit 0) | 0 | ✅ |

- **Zero failing** — inclusive `field-encryption` passou (o symlink `.env` da
  worktree tem `TENANT_FIELD_ENCRYPTION_KEY` válida ≥32 chars; cenário "dev com
  env" da CLAUDE.md §Baseline). Nenhuma falha pré-existente, nada quebrado.

### Reconciliação delta (+57 exatos)

Baseline pré-Fase 2 = **1264** (report Fase 1, `1a7d7a3`; `ff44698` e `87cc8e3`
são docs-only, não movem contagem de teste). Contagem real por vitest:

| Chip | Test file (novo) | Casos | Confere |
|------|------------------|------:|---------|
| 2a (`de70f0e`) | `opportunity-transfers-router.test.ts` | **31** | ✅ |
| 2b (`1d88447`) | `opportunity-transfer-timeout.test.ts` | **8** | ✅ |
| 2b (`1d88447`) | `transfer-notification-templates.test.ts` | **18** | ✅ |
| | **Total** | **+57** | |

`1264 + 57 = 1321`. Delta fecha exato → **nenhum teste removido/quebrado, nenhuma
regressão oculta**.

---

## Checklist de aceite — item a item

### 4. Router 2a (`src/server/trpc/routers/opportunity-transfers.ts`) — ✅ PASS

| Sub-item | Evidência | Status |
|----------|-----------|--------|
| 7 procedures | `request`, `cancel`, `approve`, `reject`, `pendingForMe`, `myOutgoing`, `historyForOpportunity` — todas presentes | ✅ |
| Todas gated `opportunity:transfer` | `const canTransfer = withPermission('opportunity:transfer')` (l.53); as 7 usam `canTransfer.` como base | ✅ |
| T3 kill-switch em CADA procedure | `assertFeatureEnabled()` no topo das 4 mutations **e** das 3 queries (l.135/262/329/422/491/518/546). Lê `env.OPPORTUNITY_TRANSFER_ENABLED`. OFF → `FORBIDDEN "Recurso indisponível."` | ✅ |
| Consumer runtime único da flag | `assertFeatureEnabled()` é o único leitor da flag no router (padrão P-73) | ✅ |
| T6 cross-tenant explícito | Toda query filtra `tenantId: ctx.tenantId` (l.138, 265, 332, 425, 494, 521, 548). Cross-tenant → `NOT_FOUND` (anti-enumeration) | ✅ |
| T4 audit `tenantIdOverride` | `request`/`cancel`/`approve`/`reject` gravam `audit({ …, tenantIdOverride: ctx.tenantId })` (l.239/311/406/471) | ✅ |
| T1 race → P2002 → erro amigável | `isUniqueViolation()` (código `P2002`) no catch do `$transaction` → `CONFLICT "Já existe transferência pendente…"` (l.226); pré-check barato via `currentTransferId` (l.189) | ✅ |
| T17 approve NÃO escreve stageHistory | `approve` só grava `audit('opportunity.owner_transferred')` + `opportunity.update({ownerId, currentTransferId:null})`; nenhuma escrita em `opportunityStageHistory`. Teste confirma via mock sem esse model (l.408) | ✅ |
| T8 revalida `status===PENDING` | `cancel`/`approve`/`reject` checam `status !== PENDING → CONFLICT` antes de transicionar (l.281/348/441) | ✅ |
| T10 anti-escalada no approve | `canReceiveAsNewOwner(target, newOwner, tenant)` antes de setar owner (l.356) → `FORBIDDEN` se newOwner fora da subárvore | ✅ |
| T7 mensagem genérica + cause | Scope FORBIDDEN usa `FORBIDDEN_MESSAGE` visível + `cause` técnico string (l.169-171, 183-185, 277, 344, 363) | ✅ |
| Registrado em `_app.ts` | `opportunityTransfers: opportunityTransfersRouter` (l.107) | ✅ |
| Métodos do service existem (sem órfão) | Router chama `canTransferOpportunity` / `isValidTransferTarget` / `canReceiveAsNewOwner` — todos definidos em `transfer-scope.service.ts` (l.58/112/94). Type-check zero confirma | ✅ |

Cobertura de cenário no teste (31 casos): kill-switch OFF nas 4 mutations,
cross-tenant NOT_FOUND, CONFLICT tanto por pré-check quanto por P2002, máquina de
estado nas 3 transições, T10 escalada, T17 (mock sem stageHistory), audit
`tenantIdOverride`, best-effort T5, validação Zod de input.

### 5. Worker 2b (`src/jobs/opportunity-transfer-timeout.worker.ts`) — ✅ PASS

| Sub-item | Evidência | Status |
|----------|-----------|--------|
| Kill-switch OFF → no-op total | `expireDueTransfers`: `if (!env.OPPORTUNITY_TRANSFER_ENABLED) return []` (l.144) — retorna antes de tocar o DB | ✅ |
| Idempotente | Transição via `updateMany WHERE status=PENDING`; `if (updated.count !== 1) continue` (l.112-116). Não re-expira nem re-notifica | ✅ |
| Limpa flag defensivamente | `opportunity.updateMany WHERE currentTransferId = tr.id` (l.119) — só se ainda aponta pra este transfer | ✅ |
| Best-effort por tenant | `for` sobre tenants ativos com `try/catch` por tenant → loga e segue (l.154-159, padrão alert-generator) | ✅ |
| Notificação best-effort (T5) | `notifyTimedOut` usa `Promise.allSettled` (l.87) + `try/catch` no call (l.126-131) | ✅ |
| Registrado em `queues.ts` | `QUEUE_NAMES.opportunityTransferTimeout: 'opportunity-transfer-timeout'` (l.28) + `OpportunityTransferTimeoutJobData` (l.113) | ✅ |
| Registrado em `index.ts` | start (l.39), `.on('failed')` listener (l.59-61), cron `0 * * * *` hourly BRT (l.91-95), `close()` no shutdown gracioso (l.114) | ✅ |

Cobertura (8 casos): kill-switch OFF, expiração + notificação, idempotência
(2ª rodada / count≠1), best-effort por tenant.

### 6. Templates (`src/lib/email/templates.ts`) — ✅ PASS

7 renders de e-mail (`renderTransferRequestedToManager/…ToOwner/ApprovedToNewOwner/
Approved/Rejected/Cancelled/TimedOut`) + 7 builders de push (`transfer*Push`), todos
exportados e testados (18 casos em `transfer-notification-templates.test.ts`).

### 7. Notification service (`transfer-notification.service.ts`) — ✅ PASS (com débito de coverage)

- **T5 best-effort satisfeito por inspeção**: corpo inteiro de `notifyTransferEvent`
  envolto em `try/catch` (l.235-277) + `.catch` individual em cada push/e-mail
  (l.260/263). Retorna `void`, **nunca propaga rejection**. O router adiciona
  `void …catch(console.warn)` como 2ª barreira.
- T6: `loadInvolvedUsers` filtra `tenantId` explícito em `runAsSystem` (l.212-217).
- PII: `reason`/`decisionReason` vão **só no e-mail**; push carrega apenas
  título + label da opp + nome (padrão P-31). Confirmado nos 7 `transfer*Push`.
- ⚠️ **0% de coverage** — o service é **mockado** no router test (l.68) e não tem
  teste dedicado. Ver **P-99** abaixo.

### 8. Segurança / memórias recorrentes — ✅ PASS

- **Cross-tenant**: todas as queries novas (router + worker + notification) filtram
  `tenantId` explícito, não confiando só na extension (memória
  `feedback_cross_tenant_leak`). Cross-tenant → NOT_FOUND, não FORBIDDEN.
- **Sem vazamento de secret**: os `console.warn/error` novos logam mensagem
  constante + objeto de erro; nenhuma chave/secret/token nos payloads. `audit()`
  grava só ids/status/timestamps.
- **Fronteira 2a/2b sem órfão**: a costura está documentada no cabeçalho de
  `transfer-notification.service.ts` (§FRONTEIRA CHIP 2a↔2b). `notifyTransferEvent`
  existe e é consumido pelo router; os templates existem e são consumidos pelo
  service **e** pelo worker. Sem símbolo não-referenciado (lint/tsc zero
  confirmam). Uma duplicação leve e **documentada** do caminho TIMED_OUT — ver
  **P-100**.

---

## Coverage dos arquivos novos

| Arquivo | % Stmts | % Branch | % Funcs | Uncovered | Leitura |
|---------|--------:|---------:|--------:|-----------|---------|
| `routers/opportunity-transfers.ts` | **98,34** | 87,71 | **100** | 232-233 (re-throw genérico não-P2002), 429-433 (reject NOT_FOUND) | 🟢 excelente |
| `jobs/opportunity-transfer-timeout.worker.ts` | **82,29** | 70,83 | 75 | 130-131 (warn-catch de notif.), 166-180 (wrapper `startOpportunityTransferTimeoutWorker`/BullMQ) | 🟢 lógica pura coberta; wrapper não-testado por convenção do repo (idem outros workers) |
| `lib/email/templates.ts` (transfer) | 79,43 (arquivo todo) | 62,85 | 85,71 | 331/357 (branch nome null vs presente); linhas 98-121 são templates não-transfer pré-existentes | 🟢 7+7 templates de transfer cobertos |
| `services/transfer-notification.service.ts` | **0** | 0 | 0 | 1-278 (mockado no router test) | 🔴 sem teste dedicado → **P-99** |

Router a 98% e worker com a lógica pura (`expireDueTransfers`/`expireForTenant`)
coberta são resultados fortes. A única lacuna real de coverage é o notification
service.

---

## Débitos residuais (sugeridos — registrar no backlog, NÃO consertar aqui)

### P-99 — `transfer-notification.service.ts` sem teste dedicado (0% coverage) · severidade média

O service é mockado no router test (l.68), então sua orquestração **não é
exercitada por nenhum teste**: `resolveRecipients` (mapa evento→destinatários +
dedup por userId), `pickTemplate` (evento×papel → template), `buildVars`,
`loadInvolvedUsers` (filtro tenant + `active`), e a **barreira best-effort T5**.
Os templates delegados (18 testes) e o call mockado do router estão cobertos, mas
a lógica de 278 linhas do service não. Não bloqueia — T5 e T6 estão satisfeitos
por inspeção — mas um bug de destinatário (ex.: dedup errado, papel trocado no
`pickTemplate`, best-effort que na verdade propaga) passaria despercebido.
**Sugestão**: teste puro dedicado no padrão do próprio worker/`analytics.service`
(mockar `sendEmail`/`sendPushToUser`/`prisma.user.findMany`; asserir
destinatários por evento, dedup, e que uma falha de push/e-mail não rejeita).
Cabe num chip pequeno na Fase 2 ou como fechamento antes da Fase 4.

### P-100 — Caminho de notificação TIMED_OUT duplicado (worker vs service) · severidade baixa

O worker (2b) compõe a notificação de TIMED_OUT direto via
`renderTransferTimedOut`/`transferTimedOutPush` em `notifyTimedOut`
(`opportunity-transfer-timeout.worker.ts` l.62-88), em vez de chamar
`notifyTransferEvent('TIMED_OUT', …)` do service (2a) — que já cobre o mesmo caso.
São **duas implementações do mesmo evento** (destinatários = disparador + dono
original em ambas). A costura é **intencional e documentada** (o service 2a não
existia no pull do 2b). Risco de longo prazo: divergência de copy/destinatários
entre os dois caminhos. **Sugestão**: unificar o worker para consumir
`notifyTransferEvent('TIMED_OUT', ctx)` quando a Fase 2 estabilizar (baixa
prioridade; nenhum impacto funcional hoje). Fecha, de quebra, parte do P-99 ao
dar ao service um segundo consumidor real.

> Notas menores sem débito: router l.232-233 (re-throw de erro não-P2002) e
> l.429-433 (reject NOT_FOUND) sem teste — mesmos shapes já cobertos
> analogamente (request catch / approve NOT_FOUND). Worker l.166-180 (wrapper
> BullMQ) não-testado segue a convenção do repo (todos os workers idem).

---

## Escopo NÃO avaliado (por design, T18)

- **Chip 2c — guard de write na Prisma extension** (`db/client.ts`): sequenciado
  por último, isolado, **Modo A** (QA na branch, atenção redobrada ao backstop
  P-42). Fora do escopo deste QA Modo B. `opportunities.current_transfer_id` hoje
  é escrito pelo router mas ainda **não é lido por nenhum guard** — comportamento
  esperado até o 2c. O read-only do dono (regra 5 §2) depende do 2c + Fase 3.
- Frontend (Fase 3) e rollout (Fase 4) — fases seguintes.

---

## Recomendação

🟢 **VERDE — seguir para o chip 2c** (guard de write na extension, Modo A, worktree
isolado), conforme o sequenciamento T18. A base do router+worker está estável,
verde e bem coberta (exceto o notification service — P-99). Nenhum blocker.
Registrar P-99 e P-100 no backlog; P-99 de preferência antes de fechar a Fase 2.
