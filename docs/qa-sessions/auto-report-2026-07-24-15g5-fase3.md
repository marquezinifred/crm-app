# QA Modo B — Sprint 15G.5 · Fase 3 (Frontend do Workflow de Transferência)

- **Data da sessão:** 2026-07-28
- **Papel:** QA de integração (Modo B) — não escreve código de app; verifica, roda a suíte, lê diffs, emite veredito.
- **Branch/HEAD verificado:** `main` @ `6ef77e5` (local == `origin/main`; fetch confirmou nada mais novo).
- **Commits sob QA:**
  - `6ef77e5` — 3a: disparo + read-only + histórico em `/pipeline/[id]` (+ `opportunities.byId`).
  - `73e8cf3` — 3b: fila do destinatário `/inbox/transferencias-recebidas` + nav (Sidebar + Topbar).
  - `b950f34` — 3c: acompanhamento do disparador `/pipeline/transferencias-em-andamento`.
  - `30afe36` — backend: `targetsForOpportunity` + `newOwnerCandidates` (consumidos pela Fase 3).
- **Ambiente de execução:** repositório principal `/Users/fredmarqueziniyahoo.com.br/Claude/crm-app` (worktree do QA não tem `node_modules`/`.env`; a paterna está limpa no mesmo commit e tem toolchain + `.env` via symlink → baseline verde real, sem falha de `field-encryption`).

---

## 🟢 VEREDITO: VERDE — seguir pra Fase 4 (rollout)

Zero regressão. As 3 telas + a extensão `byId` estão corretas, com fronteiras disjuntas, invariantes T13/T16 honradas e cobertas por teste. Nenhum blocker. 3 débitos residuais de baixa severidade registrados (não consertados, conforme papel).

---

## Baseline (item 1) — ✅ PASS

| Métrica | Resultado | Esperado |
|---|---|---|
| `npx vitest run` | **1449 passing / 0 failing / 185 skipped** (142 files passed, 20 skipped; 1634 total) | ~1449 / 0 / 185 |
| `npx tsc --noEmit` | **exit 0** (zero) | 0 |
| `npm run lint` | **exit 0** — "No ESLint warnings or errors" | 0 |

- `field-encryption.test.ts (4 tests)` **passou** — a paterna tem `TENANT_FIELD_ENCRYPTION_KEY` via `.env → .env.local`. Não foi preciso `git stash` de comparação porque **0 failing** (o cenário de falha por env var não se materializou).
- Baseline bate 1:1 com o modelo do chip 3b ("1422 passing" no commit `73e8cf3`) + os 27 do 3a = 1449.

---

## Checklist de aceite — item a item

### Item 2 — Fronteiras (sem vazamento de escopo) — ✅ PASS

Nenhum arquivo `src/` compartilhado entre os chips:
- **3a** tocou só `src/app/pipeline/[id]/page.tsx`, `src/components/transfers/{TransferBadge,TransferActionButton,CancelTransferButton,TransferHistorySection}.tsx` e `src/server/trpc/routers/opportunities.ts` (**só `byId`** — diff confirma: apenas `include.currentTransfer` + cômputo de `activeTransfer`; nenhum outro procedure alterado).
- **3b** tocou só `src/app/inbox/transferencias-recebidas/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/Topbar.tsx`.
- **3c** tocou só `src/app/pipeline/transferencias-em-andamento/{page,transfer-status-badge}.tsx` (badge **co-localizado** na rota — distinto do `TransferBadge` do 3a; sem colisão).
- Evidência de zero cross-import: `grep -rln components/transfers src/ tests/` → só `pipeline/[id]/page.tsx` (3a) + seu teste. 3b/3c não importam componente de outro chip.
- Zero scope-leak: `grep -rln activeTransfer src/` → `opportunities.ts`, `pipeline/[id]/page.tsx`, `TransferBadge.tsx`, `CancelTransferButton.tsx` (todos 3a) + `server/db/client.ts` (guard 2c **pré-existente da Fase 2**, não tocado por nenhum commit da Fase 3).

### Item 3 — T16 kill-switch honesto (CRÍTICO) — ✅ PASS

`src/server/trpc/routers/opportunities.ts:196-207`:
```
const activeTransfer =
  env.OPPORTUNITY_TRANSFER_ENABLED &&
  opp.currentTransfer &&
  opp.currentTransfer.status === 'PENDING'
    ? { transferId, toName, requestedById } : null;
```
- Flag **OFF** → `activeTransfer` sempre `null` mesmo com `currentTransferId` setado no banco → badge não aparece, opp editável (consistente com guard 2c inerte). ✅
- Só `status === 'PENDING'` congela — APPROVED/REJECTED/CANCELLED/TIMED_OUT → `null`. ✅
- **Coberto por teste** — `tests/unit/opportunities-byid-active-transfer.test.ts` (7 casos): flag ON+PENDING→resumo; **flag OFF+PENDING→null (T16)**; sem transfer→null; APPROVED→null; targetManager null→toName null (defensivo); include com select certo; NOT_FOUND.

### Item 4 — RBAC UI por-opp (T13) — ✅ PASS

- `src/components/transfers/TransferActionButton.tsx:28-48`: consome `targetsForOpportunity.useQuery({opportunityId}, { retry:false })`; `if (targetsQuery.error || targets.length === 0) return null` — some quando a query erra (FORBIDDEN por sem-permission / flag off / não-ancestor) **ou** retorna `[]`. **Nunca decidido por flag global no client.** ✅
- Backend reforça por-opp: `opportunity-transfers.ts:571-585` — `canTransfer` (permission `opportunity:transfer`) + `assertFeatureEnabled()` (kill-switch) + `canTransferOpportunity` (FORBIDDEN por-opp).
- **Coberto** — `opportunity-transfer.test.tsx`: "não renderiza quando ERRA (FORBIDDEN/flag off)" + "não renderiza quando vazio"; `opportunity-transfers-queries.test.ts`: FORBIDDEN por-opp (T13), kill-switch OFF (T3), sem permission (T12).

### Item 5 — Read-only do dono — ✅ PASS

`src/app/pipeline/[id]/page.tsx`:
- `:88` `const frozen = activeTransfer != null;`
- `:212` `StageFields ... disabled={frozen}` → todos os inputs de estágio ganham `disabled` + `disabled:opacity-60`.
- `:214` `{!frozen && Object.keys(editStageFields).length > 0 && ...}` → barra "Salvar" some.
- `:160` `{opp.status === 'ACTIVE' && !frozen && ...}` → barra avançar/voltar/cancelar-opp some.
- **ANALISTA dono** (sem `opportunity:transfer`) enxerga badge + read-only porque `activeTransfer` vem do `byId` (não das queries gated). `TransferHistorySection.tsx:30` esconde a seção no FORBIDDEN (`if (history.error) return null`) — **não quebra a página**.
- **Coberto** — `pipeline-detail-page.test.tsx` "frozen" (4 casos): badge aparece + barra some; campos desabilitados; "Cancelar transferência" só quando `requestedById === me.id`; e **não** aparece pra não-disparador. `opportunity-transfer.test.tsx` `TransferHistorySection`: escondido em erro / vazio.

### Item 6 — Fluxos das 3 telas — ✅ PASS

- **3b** (`transferencias-recebidas/page.tsx`): aceitar → sub-modal com Select populado por `newOwnerCandidates` (lazy `enabled: mode==='approve'`) → `approve.mutate({ transferId, newOwnerId, decisionReason })`; rejeitar → `reject.mutate({ transferId, decisionReason })`. Sino (`Topbar.tsx:174-179`): `count = q.error ? 0 : data.length`; some quando 0 ou erra.
- **3c** (`transferencias-em-andamento/page.tsx`): filtro por status client-side (`:201` `isPending && <Button Cancelar>`); Cancelar (só PENDING) → `AlertDialog` (`:124`) → `cancel.mutate({ transferId })`.
- **3a**: disparo → `request.mutate({ opportunityId, targetManagerId, reason })`; "Cancelar transferência" só se `iAmRequester` (`page.tsx:89,141`) → `cancel.mutate({ transferId })`.
- **Coberto** — `transferencias-recebidas.test.tsx` (9), `outgoing-transfers.test.tsx` (11: inclui "Cancelar só em PENDING", "AlertDialog aberto NÃO dispara", "confirmar dispara com transferId", filtro client-side), `transfer-nav.test.tsx` (9: sino singular/plural/9+/hidden-on-error/hidden-empty; Sidebar por role).

### Item 7 — Padrões UX (P-21/P-46/P-92b/P-96/P-98) — ✅ PASS

- `toast` Venzo + `friendlyTrpcError` em **toda** mutation dos 3 chips (grep confirma import + uso em `onError`/`onSuccess`).
- `AlertDialog` (design system) nas destrutivas: `CancelTransferButton.tsx` (3a) e `transferencias-em-andamento/page.tsx` (3c). Nenhum `confirm()` nativo.
- `ErrorState` em erro de query: 3b `:171`, 3c `:117`; 3a reusa o `ErrorState` do `byId`.
- Empty states Venzo: 3b ("Sem transferências aguardando você."), 3c ("Você não iniciou transferências.").

### Item 8 — Cross-tenant / segurança — ✅ PASS

- `opportunities.byId` **não afrouxou** a visibilidade: `:157` mantém `visibilityWhere(user, tenant, role, partnerCompanyId)` dentro de `AND:[scopeFilter]` + `id` + `deletedAt:null` + injeção de tenant pela extension. A extensão do `byId` é **só include + cômputo derivado**; `where` intocado.
- `targetsForOpportunity` / `newOwnerCandidates` hidratam com `where: { id: { in }, tenantId: ctx.tenantId, deletedAt:null, active:true }` — filtro cross-tenant explícito. Coberto por `opportunity-transfers-queries.test.ts` ("hidrata com filtro cross-tenant + active/deletedAt").

### Item 9 — Coverage dos arquivos novos — ✅ PASS (frontend)

Run escopado (7 test files de transfer, 74 tests passing):

| Arquivo | % Stmts | % Branch | % Funcs |
|---|---|---|---|
| `components/transfers/TransferBadge.tsx` | 100 | 100 | 100 |
| `components/transfers/TransferActionButton.tsx` | 100 | 100 | 66.66 |
| `components/transfers/CancelTransferButton.tsx` | 100 | 100 | 100 |
| `components/transfers/TransferHistorySection.tsx` | 100 | 71.42 | 100 |
| `transferencias-em-andamento/transfer-status-badge.tsx` | 100 | 100 | 100 |
| `transferencias-recebidas/page.tsx` (3b) | 94.46 | 66.66 | 78.94 |
| `transferencias-em-andamento/page.tsx` (3c) | 93.03 | 83.78 | 90.9 |

- `transfer-scope.service.ts` (0%) e `opportunity-transfers.ts` (21.56%) aparecem baixos **apenas neste subset** — são mockados nos testes de componente/shape; a cobertura real dessas duas queries e do service está nos suites da Fase 2 (não incluídos no run escopado). **Não é gap da Fase 3.**

---

## Débitos residuais (sugeridos — NÃO consertados)

| ID | Sev | Descrição |
|----|-----|-----------|
| **P-101** | baixa | **Inconsistência `isLoading` vs `isPending`.** 3a (`TransferActionButton`, `CancelTransferButton`) usa `mutation.isLoading` (marcado `@deprecated` em `@tanstack/query-core@4.44.0`); 3b/3c usam `mutation.isPending`. Ambos são booleanos reais nesta versão (confirmado no `.d.ts` — `isLoading` e `isPending` coexistem), então **funcionam em runtime hoje**. Padronizar em `.isPending` antes de um upgrade v5 (que remove `isLoading`). |
| **P-102** | baixa | **`act()` warning** em `tests/component/outgoing-transfers.test.tsx` (update de estado assíncrono do `OutgoingTransfersPage` fora de `act(...)`). Higiene de teste; não falha, não bloqueia. |
| **P-103** | baixa/opcional | **Branch coverage parcial** em `transferencias-recebidas/page.tsx` (66.66% br — buckets de `expiryInfo`/`relativeTime` e alguns condicionais de card) e `TransferHistorySection.tsx` (71.42% br — `reason`/`decisionReason`/`newOwner` opcionais). Caminhos não-críticos; coberto o suficiente pro aceite. |

Nenhum débito é bloqueador. Os 3 são cosméticos / higiene.

---

## Nota pra Fase 4 (rollout)

O gate R1/R2 da Fase 4 (guard de write via extension + backstop P-42) já foi validado no QA Modo A do chip 2c (`docs/qa-sessions/auto-report-2026-07-24-15g5-2c-guard.md`) — fora do escopo desta sessão. Do lado do frontend, o rollout com `OPPORTUNITY_TRANSFER_ENABLED=false` é seguro: `activeTransfer` fica `null` (T16), botões de disparo se auto-escondem (queries FORBIDDEN), sino/telas degradam pra ErrorState/hidden. Religar a flag reativa tudo sem migração.

**Recomendação:** 🟢 seguir pra Fase 4 rollout.
