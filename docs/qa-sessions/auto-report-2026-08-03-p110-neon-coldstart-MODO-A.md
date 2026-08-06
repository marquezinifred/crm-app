# QA Adversarial (Modo A) — P-110 Retry de cold-start do Neon

**Data:** 2026-08-04
**Branch alvo:** `claude/p110-neon-coldstart-retry` @ `b93147c` (NÃO mergeada)
**Base:** `f31a937`
**Worktree isolada:** `.claude/worktrees/qa-p110-modo-a` (fora da main; node_modules symlinkado + `.env.local` copiado)
**Gate:** obrigatório ANTES do merge — mexe no choke point P-42 (`src/server/db/client.ts`)

## VEREDITO: 🟢 SEGURO PRA MERGE

Fix pequeno, cirúrgico e defensivo. Adiciona uma camada de retry de **conexão**
(cold-start Neon) como wrapper externo puro, sem tocar uma linha do corpo da
extension `tenant-isolation`. Classificação de erro conservadora (só P1001/P1002),
sanitização de host à prova de vazamento, ALS preservado no retry, backstop P-42/P-45
e guard 15G.5 (2c) intactos. Baseline 1511 passing / 0 failing / 185 skipped,
type-check e lint zero.

---

## Escopo do diff (4 arquivos, +487/-5)

| Arquivo | Mudança |
|---------|---------|
| `src/server/db/connection-retry.ts` | **novo** — `withConnectionRetry`, `isTransientConnectionError`, `DatabaseUnavailableError`, `DB_UNAVAILABLE_PUBLIC_MESSAGE` |
| `src/server/db/client.ts` | extension `connection-retry` aplicada OUTERMOST + wrap de `withTenantTransaction`. Corpo da extension `tenant-isolation` **byte-a-byte inalterado** |
| `tests/unit/connection-retry.test.ts` | **novo** — 23 casos |
| `docs/Roteiro_QA_Homologacao_Staging.md` | §4 cenário cold-start (docs) |

Nenhum arquivo de teste existente foi modificado → delta de baseline é 100%
atribuível ao novo test file (ver §Baseline).

---

## Ataques — resultado por item

### Ataque 1 — Só re-tenta conexão (classificação de erro) → ✅ REFUTADO
`isTransientConnectionError` (linhas 77-112) retorna `true` **exclusivamente** para
P1001/P1002:
- **P2002 (constraint)** → `code` não está no set; é `PrismaClientKnownRequestError`
  mas o fallback por mensagem exige `/can'?t reach database server/i`, que
  "Unique constraint failed…" não casa → **false**. Provado no teste
  `P2002 (constraint) → false`.
- **Query genérica / `new Error('boom')`** → não-Prisma, sem `code` → **false**.
- **`ForbiddenError`** → `err.name === 'ForbiddenError'` (confirmado em
  `rbac.ts:450`, `this.name='ForbiddenError'`) → guard curto-circuita para **false**
  ANTES de qualquer checagem de code. Teste dedicado verde.
- **`Error("[tenant-isolation] …")`** e **`[transfer-guard] …`** → `message.startsWith`
  → **false**. Testes dedicados verdes.
- **`{name:'TRPCError', code:'P1001'}`** → excluído por name mesmo com code P1001 →
  **false** (não re-tenta erro já mapeado).
- **string / number / null / undefined** → `typeof !== 'object'` → **false**.
- **Fallback por mensagem** (`code:''` + "Can't reach…") → **true**, mas **restrito**
  a instâncias `PrismaClientInitializationError`/`PrismaClientKnownRequestError`.
  `new Error("Can't reach database server…")` **não-Prisma** → **false** (não amplia).

**Evidência:** 23/23 em `connection-retry.test.ts` (incl. os 15 casos de classificação).

### Ataque 2 — Invariantes byte-a-byte (choke point P-42) → ✅ REFUTADO
`git diff f31a937..b93147c -- src/server/db/client.ts` = **2 hunks apenas**:
(a) `import { withConnectionRetry }` + inserção do wrapper `connection-retry`;
(b) wrap de `withTenantTransaction`.

Diff isolado da região `name:'tenant-isolation'` até o fim do arquivo: **única**
diferença é o `withTenantTransaction` (ataque 5). Todo o corpo da extension —
injeção de `tenantId`, backstop `assertTenantWritePayload` (P-42/P-45), guard de
transferência 15G.5 (2c), uso do `base` não-estendido (anti-recursão), cross-tenant
lookup — é **byte-a-byte idêntico** ao base.

**Evidência:** `tests/unit/tenant-backstop.test.ts` **25/25 verde** (P-42/P-45
preservados). `tests/integration/opportunity-transfer-guard.test.ts` = **7 skipped**
(gate `DATABASE_URL_TEST` ausente → BLOCKED por infra, não por falha) — validado por
leitura + byte-diff acima; o guard runtime não teve seu código tocado.

### Ataque 3 — ALS não se perde no retry (memory `als-lazy-thunk-fail-closed`) → ✅ REFUTADO
O caller passa `() => query(args)` (thunk avaliado **a cada tentativa**, não capturado
lazy fora do escopo). `withConnectionRetry` re-invoca `fn()` **dentro da mesma cadeia
async** — o `await sleep()` (linha 163) propaga o `AsyncLocalStorage` de
`runWithTenant`/`runAsSystem`. Uma 2ª tentativa após P1001 enxerga o mesmo `tenantId`;
o fail-closed P-79 **não** dispara.

**Evidência:** teste `preserva AsyncLocalStorage no retry` roda `withConnectionRetry`
dentro de `als.run({tenantId:'tenant-xyz'}, …)` com 1ª tentativa P1001 + 2ª sucesso, e
prova `seen === ['tenant-xyz','tenant-xyz']` — as DUAS execuções veem o store.

### Ataque 4 — Retries limitados + sanitização (sem vazar host) → ✅ REFUTADO
- **Limite:** `maxAttempts` default 3 (inicial + 2 retries), loop `for 1..3`; ao
  atingir o teto → `break` → `throw DatabaseUnavailableError`. **Sem loop infinito.**
  Backoff `[300,1000]` (default), espera acumulada ~1.3s.
- **Sanitização à prova de vazamento:** o **único** `throw` do erro cru é
  `if (!isTransientConnectionError(err)) throw err` — dispara SÓ para não-transiente.
  Portanto **P1001/P1002 NUNCA propagam crus**: sempre viram `DatabaseUnavailableError`
  com `message = 'Serviço temporariamente indisponível…'` (sem host). O host fica em
  `cause` (server-side/Sentry).
- **Não vaza no tRPC:** `runMapErrors` (trpc.ts:99) re-lança `DatabaseUnavailableError`
  intacta (não é `ForbiddenError`, não casa `[tenant-isolation]`). tRPC wrappa em
  `INTERNAL_SERVER_ERROR` com `message` herdada = limpa. `formatTrpcError` só copia
  `zodError`/`tenantIsolation` para o shape — **`cause` (com host) nunca é serializado**.

**Evidência:** teste `DatabaseUnavailableError sanitizado (sem host)` afirma
`err.message` limpo, `.not.toMatch(/ep-|neon|pooler|reach database/i)`, e
`cause instanceof PrismaClientKnownRequestError`.

### Ataque 5 — Transação não dupla-executa → ✅ REFUTADO
`withTenantTransaction` envolve `prisma.$transaction(...)` em `withConnectionRetry`.
Uma falha P1001/P1002 ocorre **antes do BEGIN** → a transação não abriu, nada
commitou → re-executar `fn` (que inclui o `SET LOCAL app.tenant_id` no início da nova
tx) é seguro e re-estabelece o tenant corretamente. Erro **de dentro da tx já aberta**
(ex.: constraint P2xxx no meio) é não-transiente → propaga **imediato, zero retry**.
Ressalva registrada abaixo (side effects não-DB).

### Ataque 6 — Cobertura outermost → ✅ REFUTADO (verificado no runtime do Prisma)
Inspeção do `node_modules/@prisma/client/runtime/library.js`:
- `getAllQueryCallbacks` retorna `[...previous, ...current]` — a extensão aplicada
  ANTES (`connection-retry`, via `base.$extends`) é `previous` → fica no **índice 0**.
- O runner `La(e,t,r,n=0)` invoca `r[0]({…, query:(s,a)=>La(e,a,r,n+1)})` — o callback
  do índice 0 é o **wrapper externo**, e sua continuação `query()` chama `r[1]`
  (tenant-isolation), que por fim chama `_executeRequest`.

Logo `connection-retry` é **genuinamente OUTERMOST**: o retry envolve toda a
tenant-isolation. Num retry, `query(args)` re-executa a cadeia inteira (injeção +
backstop + guard) — segura porque a injeção de `tenantId` é determinística/idempotente.
A afirmação do comentário no código está **factualmente correta**.

---

## Baseline

| Métrica | Base `f31a937` (inferido) | Branch `b93147c` (medido) | Delta |
|---------|---------------------------|----------------------------|-------|
| Passing | 1488 | **1511** | +23 |
| Failing | 0 | **0** | 0 |
| Skipped | 185 | **185** | 0 |

**Delta explicado:** o único test file adicionado é `connection-retry.test.ts`
(23 casos); `git diff --stat` confirma zero testes existentes modificados →
base = 1511 − 23 = **1488**, exatamente o esperado. `field-encryption` passa (4/4)
porque a worktree tem `.env.local` real com `TENANT_FIELD_ENCRYPTION_KEY`.

- `npx tsc --noEmit`: **zero**
- `npm run lint`: **zero**
- Integration gated por `DATABASE_URL_TEST` (ausente): 185 skipped — inclui os 7 do
  `opportunity-transfer-guard` (BLOCKED por infra, não regressão).

---

## Ressalvas (não-bloqueantes)

1. **[baixa/informativa]** `isTransientConnectionError` retorna `false` para um
   `Error` **não-Prisma** cuja mensagem contenha o host ("Can't reach database
   server"). É uma escolha de segurança deliberada (não re-tentar o que não se prova
   pré-execução), coberta por teste. Como o Prisma sempre embrulha erros de conexão do
   Neon em instâncias `PrismaClient*Error`, não há vetor prático de vazamento. Se um dia
   a stack driver surfaceasse um `Error` cru com host, ele propagaria para `shape.message`
   — monitorar via Sentry. Sem ação necessária agora.
2. **[baixa]** O retry de `withTenantTransaction` re-executa `fn` inteira. Hoje `fn` é
   DB-only (idempotente sob rollback pré-BEGIN). **Caveat para callers futuros:** não
   colocar side effects não-DB não-idempotentes dentro de `withTenantTransaction` — já
   documentado no comentário do código.

---

## Recomendação de merge: **SIM** 🟢

Sem bloqueios. As duas ressalvas são informativas/de baixa severidade e não afetam
segurança de multi-tenancy nem o choke point P-42. Guard 15G.5 e backstop P-42/P-45
byte-a-byte preservados; sanitização de host robusta; ALS preservado; classificação
de erro conservadora. Recomendo, no rollout, um smoke pós-suspensão (>5min ocioso →
1ª request atravessa o cold-start transparente) e observar Sentry por
`DatabaseUnavailableError` (indica retry esgotado = indisponibilidade real, não
cold-start).

---

*Gerado pelo chip QA Adversarial (Modo A). NÃO commitado/pushed/mergeado/deployado.*
