# QA Modo A — Sprint 15G.5 Fase 2 · Chip 2c (Guard de transferência via Prisma extension)

**Data:** 2026-07-24
**Modo:** A (QA adversarial de **módulo core**, na branch, ANTES do merge)
**Chip alvo:** 2c — `feat(15g5-2c): guard de transferência via Prisma extension (T2/T15/T19)`
**Arquivo core tocado:** `src/server/db/client.ts` (choke point de isolamento de tenant — mesma área do incidente P-42)

## Veredito

# 🟢 VERDE — seguir pro merge + Fase 3

Guard **puramente aditivo**, P-42 preservado byte-a-byte, baseline zero-failing, T19 provado por teste, superfície de abuso fechada. Sete **débitos residuais não-bloqueantes** registrados abaixo (nenhum toca correção/segurança do invariante). O maior deles — o runtime real da extension não exercitado por falta de `DATABASE_URL_TEST` — é o padrão estabelecido do repo (extension coberta por integration gated), e é neutralizado pelo **default OFF** da flag: mergear não muda comportamento em prod até o rollout (Fase 4) virar a flag.

---

## 0. Setup / integridade do rebase

| Item | Resultado |
|------|-----------|
| `git fetch origin` | OK |
| Branch alvo | `claude/15g5-2c-transfer-guard` @ `3c8c60b` (forkada de `2b194ed`) |
| Main atual | `6bf74e1` (= `2b194ed` + P-99 test-only) |
| **Rebase `origin/claude/15g5-2c-transfer-guard` em `origin/main`** | ✅ **LIMPO, zero conflito** → HEAD `4d0dc8e` |
| P-99 disjunto? | ✅ P-99 (`6bf74e1`) toca só `tests/unit/transfer-notification-service.test.ts`; 2c toca `client.ts`/`tenant-context.ts`/`context.ts` + 3 test files disjuntos |
| `schema.prisma` divergiu de main? | Não (2c não toca schema → client Prisma de main é válido) |

Toda a validação abaixo rodou no estado **rebaseado** (`4d0dc8e`), que é exatamente o que o merge produz.

---

## 1. Gates de baseline

| Gate | Main (`6bf74e1`) | Branch rebaseada (`4d0dc8e`) | Delta |
|------|------------------|------------------------------|-------|
| **Vitest** | **1340 pass / 0 fail / 178 skip** (1518) | **1382 pass / 0 fail / 185 skip** (1567) | **+42 pass / +0 fail / +7 skip** |
| `tsc --noEmit` | 0 | **0** | — |
| `npm run lint` | 0 | **0** (`✔ No ESLint warnings or errors`) | — |

**Reconciliação do delta (aditivo puro, zero regressão):**
- `tests/unit/transfer-write-guard.test.ts` → **35 pass**
- `tests/unit/transfer-guard-structural.test.ts` → **7 pass**
- `tests/integration/opportunity-transfer-guard.test.ts` → **7 skipped** (gated por `DATABASE_URL_TEST`, ausente no ambiente)
- 35 + 7 = **42 pass**; 7 skip → bate 1:1 com o delta observado. Nenhum teste pré-existente mudou de estado.

**`field-encryption`:** passou (4/4) — o ambiente tem `TENANT_FIELD_ENCRYPTION_KEY` setada, então **não há failing** nem em main nem na branch. A variância documentada no CLAUDE.md (4 failings quando a key está ausente) não se aplica a este run; confirmei 0-failing nos DOIS lados via checkout de `origin/main`.

---

## 2. Verificação adversarial — checklist A–H

### A. P-42 preservado — 🟢 PASS (prioridade máxima)

- `git diff origin/main...HEAD -- src/server/db/client.ts` → **zero linhas removidas/modificadas** (`grep '^-' | grep -v '^---'` vazio). Guard é **100% aditivo**.
- Única mudança de import: `+import { ForbiddenError } from '@/lib/auth/rbac';` (client.ts:7).
- `assertTenantWritePayload` (client.ts:31-83) e o bloco de backstop P-42 dentro de `$allOperations` (client.ts:~500-537) estão **byte-a-byte idênticos** a main.
- Ordem no `$allOperations`: (1) no-context fail-closed → (2) SYSTEM/PLATFORM bypass → (3) tenant-root skip → (4) injeção de WHERE/data de tenant → (5) **backstop P-42** → (6) **guard de transferência (NOVO)** → (7) `return query(a)`. O guard é o **último** check, roda **depois** da injeção de tenant e do assert P-42, sobre o `a` já injetado. Não subverte a proteção cross-tenant.
- `grep -c 'function createPrismaClient'` = **1** (sem duplicação acidental).
- `npx vitest run tests/unit/tenant-backstop.test.ts` → **25/25 pass**.

### B. Anti-recursão (base não-estendido) — 🟢 PASS (design + leitura; runtime real não exercitado)

- Call site (client.ts:556-563): `evaluateTransferGuard(base as unknown as TransferGuardDb, ...)` — passa o **`base`** (`new PrismaClient({ log })`, client **NÃO-estendido**), não o `prisma` estendido.
- `grep 'prisma\.' na região do guard (85-393)` → **zero** usos de `prisma.` (extended). Só o `db` param (ligado a `base`). Logo os `findMany` do guard **não re-disparam** `$allOperations` → sem recursão.
- Backstop estrutural pina isso: `expect(SRC).toMatch(/evaluateTransferGuard\(\s*base as unknown as TransferGuardDb/)`.
- ⚠️ **O runtime REAL** (o `base` de fato não re-entrar no hook dentro de uma transação; leitura do valor commitado pré-write) só é exercitado por `tests/integration/opportunity-transfer-guard.test.ts`, **SKIPPED** (sem `DATABASE_URL_TEST`). Ver **R1**.

### C. Cross-tenant explícito — 🟢 PASS

Como o guard usa o `base` (sem injeção automática de tenant), **todo** lookup filtra `tenantId` explícito:
- `collectTransferOppIds` filhos: `delegate.findMany({ where: { id: { in: childIds }, tenantId } })` (client.ts:325-328) ✓
- `collectTransferOppIds` Document: `db.document.findMany({ where: { id: { in: docIds }, tenantId } })` (client.ts:337-340) ✓
- `evaluateTransferGuard` opp: `db.opportunity.findMany({ where: { id: { in: oppIds }, tenantId } })` (client.ts:373-380) ✓

`tenantId` vem do `ctx.tenantId` resolvido pela extension. **Nenhum** `findMany` do guard sem filtro. Teste `evaluateTransferGuard — cross-tenant` (transfer-write-guard.test.ts:357) confirma que opp de outro tenant não é encontrada → passa (isolamento), com `db.calls[0].tenantId === 'tenant-OUTRO'`.

### D. Carve-outs T19 — 🟢 PASS (provadas por teste + fluxos reais corretos)

Núcleo puro `assertTransferWriteAllowed` (client.ts:207-222) implementa T19 exatamente:
1. `!ctxUserId` → allow (**T19b** sistema/worker)
2. `currentTransferId == null` → allow (sem transferência ativa)
3. `payloadClearsTransfer` → allow (**T19a** máquina de estado)
4. `ctxUserId === activeTransferRequestedById` → allow (disparador)
5. senão → **bloqueia**

**Provas obrigatórias (transfer-write-guard.test.ts, 35 casos):**

| Prova T19 | Evidência (teste) | Status |
|-----------|-------------------|--------|
| dono NÃO edita business field em PENDING | `assertTransferWriteAllowed` :52 + `evaluateTransferGuard` Opportunity :288 | ✅ bloqueado |
| dono NÃO cria task/activity/proposal/document | :64 (loop 4 modelos) + evaluate Task/Activity/Proposal :375-432, Document :465 | ✅ bloqueado |
| destinatário CONSEGUE approve (payload zera flag, userId≠disparador) | :72 + evaluate :318 (`data:{ownerId,currentTransferId:null}`, RECIPIENT) | ✅ passa (T19a) |
| destinatário CONSEGUE reject | :81 (mesma carve-out) | ✅ passa |
| worker/sistema CONSEGUE (userId null) | :88 + evaluate :332 | ✅ passa (T19b) |
| disparador CONSEGUE escrever em PENDING | :91 + evaluate :303 (REQUESTER) | ✅ passa |
| opp sem transferência → ninguém bloqueado | :95 + evaluate :340 | ✅ passa |

**Fluxos reais do router 2a (opportunity-transfers.ts) confirmados:**
- `request` (:219) seta `currentTransferId: transfer.id` — no instante do write o valor **commitado** é `null` → guard libera (não depende da carve-out).
- `approve` (:383) por `ctx.user.id`=destinatário (valida `targetManagerId===ctx.user.id`), `data:{ownerId,currentTransferId:null}` → passa via **T19a** (`payloadClearsTransfer`).
- `reject` (:460) idem approve.
- `cancel` (:300) por `ctx.user.id`=disparador (valida `requestedById===ctx.user.id`) → passa por disparador **e** por T19a (duplo).

**Kill-switch OFF (T3/T16):** `isTransferGuardEnabled()` (client.ts:135-140) lê `process.env.OPPORTUNITY_TRANSFER_ENABLED` com parse **literal** (`true|1|yes|on`→true; senão false) — **nunca** `Boolean("false")` (P-60 respeitado). Com flag OFF a condição `if (... && isTransferGuardEnabled())` (client.ts:549-555) faz short-circuit → **zero lookup**, guard inerte. ⚠️ Comportamento OFF verificado **só por leitura** (nenhum teste executável) — ver **R2**.

**Ataque à carve-out `payloadClearsTransfer` (superfície de abuso) — FECHADA:**
Pergunta: um payload malicioso `{currentTransferId:null, <business fields>}` do dono libera a escrita?
- Em `evaluateTransferGuard`, `payloadClearsTransfer` só é true quando `model === 'Opportunity'` (client.ts:387) → Proposal/Activity/Task/Document **nunca** são liberados por esse caminho.
- Para Opportunity: **nenhum caminho de usuário real injeta `currentTransferId`**. O `opportunityUpdateInput` (src/lib/validators/opportunity.ts:25) é `opportunityCreateInput.partial().extend({...})` com **lista fechada de campos** e **não declara `currentTransferId`**. Zod default `.strip()` (sem `.passthrough()`) **remove** qualquer `currentTransferId` do payload ANTES de chegar ao `data` do `prisma.opportunity.update`. Logo, para um `opportunities.update` humano, `payloadClearsCurrentTransfer` é sempre `false` → dono é **bloqueado** mesmo mandando `currentTransferId:null` no corpo.
- O único código que seta `currentTransferId` é **server-only**: `tx.opportunity.update` dentro do router de transferência (approve/reject/cancel/request). **Superfície server-only, sem alcance de usuário.**

### E. Fallback permissivo (probe de buraco) — 🟢 PASS

Writes não-resolvíveis (`updateMany`/`deleteMany` com filtro sem `id`) → `idsFromWhere` retorna `[]` → `collectTransferOppIds` `[]` → `evaluateTransferGuard` retorna `null` (permissivo). Probe dos fluxos legítimos de edição do dono:
- `opportunities.update` → `prisma.opportunity.update({ where: { id } })` (resolvível) ✓
- `tasks` (activities.ts): create com `opportunityId` no data; update `where:{id}` ✓
- `activities` create com `opportunityId` ✓
- `proposals.create` com `opportunityId`; `addVersion` via `$transaction([...])` que inclui `proposal.update` **e** `opportunity.update` (ambos guardados) → dono bloqueado, rollback limpo ✓
- `documents` create com `relatedEntityId`; update `where:{id}` ✓

Sweep `grep '(opportunity|proposal|activity|task|document)\.(updateMany|deleteMany)'` em `src/server`:
- `partner-engagements.ts:149` `opportunity.updateMany({ where: { id: before.opportunityId, ... } })` — **tem `id`** → `idsFromWhere` resolve → **coberto** (não é escape; bloqueia não-disparador em PENDING — consistente com regra 5; ver **R6**).
- `privacy-workflow.service.ts:171` `activity.updateMany({ where: { tenantId, authorId: { in } } })` — **sem `id`** → permissivo. **Correto**: scrub LGPD em massa não deve ser bloqueado por uma opp em transferência.

**Nenhum fluxo de edição do dono escapa o guard via `updateMany`/`deleteMany` sem id.**

### F. Efeito colateral do `setContextUserId` — 🟢 PASS

- `setContextUserId(userId)` (tenant-context.ts:39-42): no-op sem store; só seta `userId` (não toca `tenantId`/`role`). Chamado em `createContext` (context.ts:69) **após** resolver o User — antes o `userId` ficava `null` no path tRPC (route handler inicia `runWithTenant({userId:null})`).
- Consumidores do `getTenantContext().userId`: apenas **(1)** `audit.service.ts` (`ctx?.userId ?? null` — agora ganha ator real, bônus documentado; nenhum branch depende de null-vs-set) e **(2)** o guard novo. Nenhum outro.
- `grep createContext em tests/` → **vazio**: nenhum teste unitário exercita `createContext`, então a mudança **não afeta** unit tests (constroem Context/ALS manualmente). Isolamento por-request (ALS) preservado.
- `tests/unit/tenant-context.test.ts` (3) + `tests/unit/audit-context-loss.test.ts` (4) → **7/7 pass**. Suíte completa 0-failing confirma zero regressão.

### G. Mapeamento do erro (ForbiddenError → FORBIDDEN, sem vazar cause) — 🟢 PASS

- Guard lança `new ForbiddenError(TRANSFER_GUARD_FORBIDDEN_MESSAGE)` com msg genérica `'Seu perfil não tem acesso a esta operação.'` e detalhe técnico em `.cause` (string `[transfer-guard] ...`) (client.ts:562-564).
- `runMapErrors` (trpc.ts:92-93): `if (err instanceof ForbiddenError) throw new TRPCError({ code: 'FORBIDDEN', message: err.message })` → vira **FORBIDDEN** (não INTERNAL_SERVER_ERROR/500). O novo `TRPCError` **não** carrega `cause` → o detalhe técnico é **descartado** aqui, não chega ao cliente.
- `formatTrpcError` (trpc.ts:29-51): para o FORBIDDEN, `error.cause` é undefined → `tenantIsolation` = null (e `parseTenantIsolationMessage` só casa prefixo `[tenant-isolation]`, nunca `[transfer-guard]`), `zodError` = null → cliente recebe só `{ code: FORBIDDEN, message: genérica }`. **Sem vazamento.**
- `ForbiddenError` é a mesma classe importada de `@/lib/auth/rbac` nos dois módulos (client.ts:7 e trpc.ts:6) → `instanceof` holds através da fronteira da extension.
- O mapping genérico ForbiddenError→FORBIDDEN já tem teste de regressão (P-61, `trpc-middlewares.test.ts` `runMapErrors`).

### H. Backstop estrutural (não-vazio) — 🟢 PASS

`transfer-guard-structural.test.ts` (7 casos) **pega regressão de verdade**:
- Extrai o conteúdo de `TRANSFER_GUARDED_MODELS` e afirma `toContain('<model>')` para os 5 modelos **e** `count === 5` → remover um modelo quebra `toContain`; adicionar um quebra o count. **Não passa vazio.**
- Pina `TRANSFER_WRITE_OPS` (7 ops), consumo do kill-switch (`OPPORTUNITY_TRANSFER_ENABLED` + `isTransferGuardEnabled()`), **não-import de `@/lib/env`**, o call site `base` (regex de anti-recursão), o bloqueio via `ForbiddenError`, e a presença de P-42 (`assertTenantWritePayload` + `[tenant-isolation]`).

---

## 3. Cobertura de `client.ts`

`npx vitest run --coverage` (guard unit + backstop P-42):

```
client.ts | 60.11% Stmts | 84.54% Branch | 76.92% Funcs | 60.11% Lines
Uncovered: ...398, 408-569, 592-600
```

- **Bem coberto:** todo o núcleo puro do guard — `assertTransferWriteAllowed`, `payloadClearsCurrentTransfer`, `idsFromWhere`, `opportunityIdsFromCreateData`, `documentOppIdsFromCreateData`, `collectTransferOppIds`, `evaluateTransferGuard` (35 casos, incl. child lookups e Document polimórfico).
- **Descoberto (408-569):** o corpo de `createPrismaClient()` — o **wiring runtime** da extension: gate do kill-switch, passagem do `base`, `throw ForbiddenError` do hook, injeção de tenant e a invocação in-extension do P-42. Consistente com o padrão do repo (a extension runtime historicamente fica descoberta e é validada pelos integration tests gated por `DATABASE_URL_TEST` — mesma nota de P-42/P-44). 592-600 = `withTenantTransaction`.

---

## 4. O que ficou SEM exercício real (declaração explícita)

⚠️ **`DATABASE_URL_TEST` não está setada** neste ambiente → `tests/integration/opportunity-transfer-guard.test.ts` (7 cenários que forçam `OPPORTUNITY_TRANSFER_ENABLED='true'` e rodam a extension REAL via `runWithTenant`/`runAsSystem`: dono bloqueado, disparador passa, approve/reject carve-out, worker `runAsSystem`, opp livre) ficou **SKIPPED**.

Portanto **NÃO foram exercitados em runtime real**:
- o `base` não-estendido de fato não re-entrar no `$allOperations` (anti-recursão),
- o gate do kill-switch (ON e OFF) no nível da extension,
- o `throw ForbiddenError` do hook propagando pra `mapErrors` e virando FORBIDDEN,
- a leitura do valor commitado de `current_transfer_id` durante uma transação interativa.

Tudo isso está validado por **leitura + testes de função pura + backstop estrutural**, mas o caminho ponta-a-ponta é DB-gated. **Recomendação:** rodar o integration test contra um Postgres de teste na Fase 4 (rollout) antes de virar a flag em prod.

---

## 5. Débitos residuais (não-bloqueantes)

| ID | Severidade | Descrição | Ação sugerida |
|----|-----------|-----------|---------------|
| **R1** | média | Runtime real da extension não exercitado (integration SKIPPED, sem `DATABASE_URL_TEST`); `client.ts` 60% line cov. | Rodar `opportunity-transfer-guard.test.ts` contra Postgres de teste na Fase 4. |
| **R2** | média | Kill-switch **OFF** + `isTransferGuardEnabled()` (parse literal P-60) verificados **só por leitura**; nenhum teste executável do OFF. | Exportar `isTransferGuardEnabled` p/ unit test de parse literal, **ou** cenário flag-OFF no integration. |
| **R3** | baixa | `documents.addVersion` é **não-transacional**: `documentVersion.create` (2º-grau, fora dos 5 modelos guardados) roda ANTES do `document.update` guardado → dono ainda é bloqueado no `document.update`, mas uma linha órfã `DocumentVersion` pode persistir. Benigno (`currentVersionId` visível não avança; dedup por sha256 no retry). | Envolver `addVersion` em `$transaction` **ou** guardar `DocumentVersion`/`ProposalVersion`. Escopo dos 5 modelos é decisão da spec (T15). |
| **R4** | muito baixa | `setContextUserId` sem teste unitário dedicado (setter trivial). | Coberto pelo integration quando DB presente; opcional. |
| **R5** | muito baixa | O `cause` técnico do guard-block é descartado no `mapErrors` (FORBIDDEN não é reportado ao Sentry) → detalhe (opp/disparador/ator) não é capturado server-side além do throw. Mais seguro, mas enfraquece a debugabilidade prometida por P-98. | Breadcrumb com o cause se debug importar. |
| **R6** | observação | `partner-engagements.revoke` (`opportunity.updateMany({where:{id}})`) será **bloqueado** para um admin não-disparador durante PENDING. Consistente com regra 5 (read-only p/ não-disparador), mas pode surpreender. | Documentar como comportamento esperado. |
| **R7** | observação | O guard adiciona `base.findMany` **dentro** de transações interativas/batch (approve/reject/cancel/request/`proposals.addVersion`/`documents.create`) → +1 conexão mid-tx. OK com pool default; observar sob load-test. | Incluir no k6/load-test da Fase 4. |

Nenhum R-item toca correção/segurança do invariante read-only nem o P-42. Todos são follow-up de Fase 4 ou opcionais.

---

## 6. Resumo executivo

- **Rebase em main: LIMPO** (P-99 disjunto).
- **Baseline: 1382 pass / 0 fail / 185 skip** (aditivo puro sobre main 1340/0/178). tsc 0, lint 0.
- **A–H: todos 🟢 PASS.** P-42 byte-a-byte preservado (25/25 verde). T19 provado por 35 testes + fluxos reais. Superfície de abuso da carve-out **fechada** (Zod strip de `currentTransferId`). Cross-tenant blindado. ForbiddenError→FORBIDDEN sem vazar cause. Backstop estrutural real.
- **Único ponto de atenção genuíno:** o runtime real da extension é DB-gated e ficou skipped aqui (R1/R2) — neutralizado pelo **default OFF** da flag (merge = zero mudança em prod até rollout).

# 🟢 Seguir pro merge + Fase 3.

---

*QA Modo A executado em worktree isolado sobre a branch rebaseada `4d0dc8e`. Nenhum código de app/teste foi alterado por este QA (read-only). Model: claude-opus-4-8.*
