# QA Modo B — Sprint 15G.5 Fase 1 (Transferência de Oportunidade) — 2026-07-20

## Verdict: 🟢 VERDE — **Fase 1 pronta, seguir pra Fase 2**

Dois chips de fundação landed em sequência sobre a main (`ac9ff0f` 1a + `1a7d7a3`
1b). Schema válido, migração arquivo-único (T11), **gate de permission correto
(4 SIM / 3 NÃO — T12)**, **autoridade 100% estrutural (T13 — grep de `users.role`
só bate em comentários)**, delta de testes reconcilia 1:1 (+23 exatos), zero
failing. Coverage 100% nos dois arquivos novos. **Liberado seguir pra Fase 2.**

## Commits verificados (verificação 1)

- `1a7d7a3` **feat(15g5-1b)** — TransferScopeService + `resolveTransferTargets` (T13/T14)
- `ac9ff0f` **feat(15g5-1a)** — migration 0032 + models + flag + permission `opportunity:transfer`
- HEAD do worktree == HEAD da `origin/main` (`1a7d7a3`); `merge-base --is-ancestor`
  confirma que o worktree contém os dois commits. Verificação feita sobre o estado
  integrado real.

## Baseline (verificações 4 + 5)

- `npx vitest run` (`.env` dummy presente na cwd — cenário verde canônico):
  **1264 passing / 0 failing / 178 skipped** (1442 total). Bate 1:1 com o
  esperado (~1264 / 0 / ~178).
- Test Files: **130 passed | 19 skipped** (149).
- `npx tsc --noEmit`: **0 errors** (exit 0).
- `npm run lint`: **✔ No ESLint warnings or errors** (exit 0).
- **0 falhas de `field-encryption`**: criei `.env` a partir do `.env.example`
  (`TENANT_FIELD_ENCRYPTION_KEY` = 38 chars ≥32 → passa). Cenário "dev com env"
  (CLAUDE.md §Baseline). Sem necessidade de `git stash` — suíte inteira verde,
  nada pré-existente quebrado.

## Reconciliação delta (+23 exatos)

Baseline pré-Fase 1 (`b9ba367`): **1241 passing / 0 failing / 175 skipped**.
Contagem real por `grep -cE '^\s*(it|test)\(' <file>`:

| Chip | Test file | Casos | Delta passing | Confere |
|------|-----------|------:|------:|---------|
| 1a (`ac9ff0f`) | 5 test files de permission (catalog/role-default/router — edições) | — | **+2** asserts | ✅ |
| 1b (`1a7d7a3`) | `tests/unit/transfer-scope-service.test.ts` (novo) | 17 | **+17** | ✅ |
| 1b (`1a7d7a3`) | `tests/unit/sales-unit-repository.test.ts` (12→16, `resolveTransferTargets`) | +4 | **+4** | ✅ |
| **Total** | | | **+23** | ✅ |

- 1241 + 23 = **1264** ✅ exato.
- **Skipped +3 = EXATAMENTE os 3 integration tests gated** (não regressão):
  `tests/integration/transfer-scope.integration.test.ts` tem 3 casos, todos sob
  `const describeIfDb = TEST_DB ? describe : describe.skip;`
  (`TEST_DB = process.env.DATABASE_URL_TEST`). Sem `DATABASE_URL_TEST` no ambiente,
  os 3 viram skip → 175 + 3 = **178** ✅. Nenhum teste pré-existente virou skip.
- `sales-unit-repository.test.ts` **pré-existia** (12 casos do Sprint 15G); o 1b
  adicionou 4 casos novos de `resolveTransferTargets` (incl. um "filtro tenant
  aplicado em todos os JOINs (cross-tenant defense)"), levando a 16.

## T12 — Permission gate `opportunity:transfer` (CRÍTICO, segurança) ✅

Lido **cada bloco de role diretamente** em `src/lib/auth/rbac.ts`
(`ROLE_DEFAULT_PERMISSIONS`), sem awk que vaza entre blocos. Contagem de literais
`'x:y'` por range de linha (script determinístico), comparada com o comentário `// N`:

| Role | `opportunity:transfer` | Esperado | `// N` | Contagem real | Dup? |
|------|:---:|:---:|:---:|:---:|:---:|
| ADMIN (L58) | ✅ presente (L73) | SIM | 64 | 64 | não |
| DIRETOR_COMERCIAL (L101) | ✅ presente (L109) | SIM | 42 | 42 | não |
| DIRETOR_OPERACOES (L124) | ✅ presente (L131) | SIM | 28 | 28 | não |
| DIRETOR_FINANCEIRO (L145) | ❌ ausente | NÃO | 19 | 19 | não |
| GESTOR (L166) | ✅ presente (L179) | SIM | 33 | 33 | não |
| ANALISTA (L191) | ❌ ausente | NÃO | 24 | 24 | não |
| PARCEIRO (L210) | ❌ ausente | NÃO | 5 | 5 | não |

- **4 SIM (ADMIN / DIRETOR_COMERCIAL / DIRETOR_OPERACOES / GESTOR) / 3 NÃO
  (DIRETOR_FINANCEIRO / ANALISTA / PARCEIRO)** — exatamente a matriz da spec T12.
- Todos os 7 `// N` batem 1:1 com a contagem real; zero duplicatas.
- Comentário do header (L45-49) documenta o incremento manager-tier (+1 em
  ADMIN/DIRETOR_C/DIRETOR_O/GESTOR) coerente com os números.
- `grep` global do literal `opportunity:transfer` no `ROLE_DEFAULT_PERMISSIONS`
  bate só nas 4 linhas 73/109/131/179 — nenhum vazamento pros 3 roles proibidos.

## T13 — Autoridade 100% estrutural (CRÍTICO) ✅

`grep -rnE "users\.role|user\.role|\.role ==="` em
`transfer-scope.service.ts` + `sales-unit.repository.ts`:

- 3 matches — **todos em comentários** documentando a convenção
  ("**NUNCA** de `users.role`", "deriva de `sales_unit_members.role='MANAGER'`").
  A task explicitamente permite comentários de convenção. **Zero indexação de
  autoridade por `users.role` no código.**

Leitura do código confirma a derivação estrutural:

- **`transfer-scope.service.ts`** (5 funções): `resolveTransferSources` →
  `getSubtreeMemberIds` (subárvore ltree onde caller é MANAGER);
  `canTransferOpportunity` avaliado **por-opp** (opp tenant-scoped +
  `deletedAt: null`, exclui opp própria, exige owner ∈ sources);
  `resolveTransferTargets`, `canReceiveAsNewOwner` (anti-escalada T10 — subárvore
  do targetManager), `isValidTransferTarget`.
- **`sales-unit.repository.ts:244` `resolveTransferTargets`** — `$queryRaw`
  parametrizado; autoridade de `sales_unit_members.role = 'MANAGER'` (L266, L274)
  + posição ltree (`parent_id` irmãs/pai, L258-262). Join em `users` só pra
  `deleted_at IS NULL` + `active = true`; **nunca lê `users.role`**. Filtro
  `tenant_id = ${tenantId}::uuid` em **todos** os JOINs (defesa cross-tenant).
- O gate `opportunity:transfer` (T12) é só o *interruptor de capacidade*; a
  autoridade real é o check estrutural por-opp. Um cargo global novo
  (Coordenador/Head) não quebra a lógica — exatamente a promessa da spec.
- **Prova concreta no integration test** (`transfer-scope.integration.test.ts`):
  TODOS os users recebem `users.role='ANALISTA'` e o `resolveTransferTargets`
  ainda resolve corretamente por estrutura.

## Migration 0032 (verificação 3) ✅

- **Arquivo ÚNICO (T11)**: `ls prisma/migrations/0032_opportunity_transfers/` →
  só `migration.sql` (7605 bytes). Nenhum sufixo `0032b`/`0032c`.
- **T1 (race)**: `CREATE UNIQUE INDEX idx_transfers_active_per_opp ON
  opportunity_transfers (opportunity_id) WHERE status = 'PENDING'` (L106-107) —
  no máx. 1 transfer PENDING por opp.
- **RLS**: `SELECT enable_tenant_rls('opportunity_transfers')` (L113) — mesmo
  helper do 0031/0002. O helper (0002_rls L37-58) expande para
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + 4 policies granulares via
  `current_tenant_id()`. 0031 usa idêntico `enable_tenant_rls(...)` → convenção
  consistente. O chip documenta (L21-26) porque não usa a policy única do rascunho
  da spec (casar 1:1 com 0031/0002).
- **Colunas guard + timeout**: `opportunities.current_transfer_id uuid
  REFERENCES opportunity_transfers(id)` (T2, L120-121);
  `tenant_settings.transfer_timeout_hours integer NOT NULL DEFAULT 72` (T3,
  L129-130). Ambas com `COMMENT ON COLUMN`.
- **Convenções idênticas a 0031**: `gen_random_uuid()` (L67), `timestamptz`
  (L79-83), `now()`. Enum `TransferStatus` criado idempotente
  (`DO $$ ... duplicate_object`). FK circular tratada (comentário L29-32).
- `npx prisma validate` (com `DATABASE_URL`): **schema válido 🚀**.
  `npx prisma generate`: client gerado limpo (v5.22.0).

## Coverage (verificação 8) ✅

`vitest --coverage` escopado aos 2 arquivos novos (v8):

| Arquivo | Stmts | Branch | Funcs | Lines |
|---------|:---:|:---:|:---:|:---:|
| `services/transfer-scope.service.ts` | 100 | 100 | 100 | 100 |
| `db/repositories/sales-unit.repository.ts` | 100 | 100 | 100 | 100 |

Claim do chip 1b (100%) confirmado.

## Smells (verificação 9) ✅

`grep -rnE "console\.log|TODO|FIXME|\.only\("` nos 5 arquivos novos (source + tests):

- Único match: a **palavra portuguesa "TODOS"** (all) num comentário do
  integration test ("TODOS os users recebem `users.role='ANALISTA'`") — não é
  marcador `TODO`, é o próprio design que prova T13.
- Zero `console.log`, `FIXME`, `.only(`.

## Playwright smoke (verificação 10) — 🔵 BLOCKED por infra

`npx playwright test tests/e2e/smoke.spec.ts --project=chromium-desktop`:
**1 passed / 2 failed**. As 2 falhas (`home renderiza`, `auto-cadastro público de
contato renderiza form`) batem em páginas que a **Fase 1 nunca tocou** (`/` landing
e `/p/[slug]/contact`) — "element(s) not found" porque o app não sobe conteúdo real
com `.env` dummy (DATABASE_URL/Clerk inacessíveis). Cenário infra-BLOCKED
recorrente e documentado (CLAUDE.md §Baseline). **Não é regressão de Fase 1** — o
diff da Fase 1 é migration/schema/rbac/service, sem UI. Sem reprovar.

## Nota de env

Baseline verde canônico obtido com `.env` (dummy do `.env.example`) presente na
cwd — 0 failing na suíte inteira, incluindo `field-encryption`. Não houve o
cenário CI (import-fails / 4 falhas de field-encryption), logo `git stash`
antes/depois não foi necessário.

## Checklist final

| # | Verificação | Resultado |
|---|-------------|-----------|
| 1 | git log `1a7d7a3` + `ac9ff0f` | ✅ |
| 2 | prisma validate + generate | ✅ |
| 3 | Migration 0032 arquivo-único + T1 + RLS + guard/timeout + convenções | ✅ |
| 4 | tsc 0 / lint 0 | ✅ |
| 5 | 1264 / 0 / 178 + delta +23 reconcilia | ✅ |
| 6 | T12 gate 4 SIM / 3 NÃO + counts | ✅ |
| 7 | T13 autoridade estrutural (grep só comentários) | ✅ |
| 8 | Coverage 100% × 2 arquivos | ✅ |
| 9 | Smells limpos | ✅ |
| 10 | Playwright | 🔵 BLOCKED infra (não reprova) |

**Recomendação: 🟢 seguir pra Fase 2.** Sem chip de fix. Fundação (schema + enum
+ flag + permission + camada de autoridade estrutural) íntegra e coberta.
