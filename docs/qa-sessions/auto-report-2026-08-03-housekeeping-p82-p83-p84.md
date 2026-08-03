# Relatório QA Automation — Housekeeping P-82 / P-83 / P-84 · 2026-08-03

## Veredito

🟢 **OK seguir** — zero regressão, zero failing novo, cobertura dos caminhos
novos exercitada, migration 0033 correta na revisão estática. **Autorizado o
rollout da migration 0033** (aplicar `prisma migrate deploy` ANTES do código,
conforme o próprio §2.12 do Roteiro e o precedente `migration-before-code-deploy`).

## Metadados

- **Worktree:** `.claude/worktrees/modest-moser-ae62e9` (branch `claude/gifted-haslett-7c0b70`)
- **HEAD sob teste:** `2f54023` (merge P-83+P-84)
- **Baseline de referência (pré-merge):** `608a26c` — 1463 passing / 0 failing / 185 skipped
- **Modo:** B (verificação; nenhum código de app tocado, nenhum teste editado)
- **Ambiente:** local, `node_modules` + `.env.local` symlinkados da paterna;
  **sem `DATABASE_URL_TEST`** (integração skipa — reproduz o cenário do baseline de referência)
- **Node:** v26.0.0 · **npm:** 11.12.1 · **Vitest:** via `node_modules/.bin` (paterna) · **Prisma:** 5.22.0

## Sumário

| Nível | Total | OK | NOK | Blocked |
|-------|-------|----|----|---------|
| Unit + Component (Vitest) | 1673 | 1488 | 0 | 0 |
| — dos quais skipped | — | — | — | 185 |
| Integration (Supertest/Vitest) | — | — | — | skip (sem `DATABASE_URL_TEST`, esperado) |
| E2E (Playwright) | — | — | — | **BLOCKED** (ver abaixo) |
| Type-check (`tsc --noEmit`) | — | ✅ exit 0 | — | — |
| Lint (`next lint`) | — | ✅ 0 warnings/errors | — | — |
| `prisma validate` | — | ✅ "schema is valid" | — | — |
| `prisma generate` | — | ✅ gerou client (parseou `@@unique(...map:)`) | — | — |

## Baseline antes/depois

| | Passing | Failing | Skipped | Total |
|---|--------:|--------:|--------:|------:|
| Referência `608a26c` (informado) | 1463 | 0 | 185 | 1648 |
| **HEAD `2f54023` (medido)** | **1488** | **0** | **185** | **1673** |
| Δ | **+25** | 0 | **0** | +25 |

- **Zero failing novo.** Skipped **inalterado** (185 → 185) — nenhum teste foi
  silenciosamente desligado.
- O baseline foi reconciliado **por delta** (contagem git dos arquivos de teste em
  `608a26c` vs HEAD), não por re-execução completa em `608a26c`, para não tocar a
  `main` nem levantar outra worktree. Os números fecham 1:1 (ver abaixo).

## Delta chip-a-chip (reconciliação exata do +25)

Contagem de casos por arquivo (baseline `608a26c` → HEAD `2f54023`):

| Chip | Arquivo | Baseline | HEAD | Δ |
|------|---------|---------:|-----:|--:|
| **P-82** | `tests/unit/session-guard.test.ts` | 17 | 23 | **+6** |
| **P-82** | `tests/unit/trpc-middlewares.test.ts` | 21 | 25 | **+4** |
| **P-83** | `tests/unit/migration-0033-users-email-partial-unique.test.ts` (novo) | 0 | 6 | **+6** |
| **P-84** | `tests/unit/users-reinvite.test.ts` (novo) | 0 | 8 | **+8** |
| **P-84** | `tests/component/admin-users-actions.test.tsx` | 16 | 17 | **+1** |
| | **TOTAL** | | | **+25** ✅ |

- **P-82 = +10** · **P-83 = +6** · **P-84 = +9** → soma **+25**, idêntico ao delta de passing.
- Nenhuma divergência. Todos os novos casos passam; nenhum vira skipped.

## Cobertura dos arquivos alterados

Medida com `--coverage.provider=v8` rodando só os 4 arquivos de teste dos chips
(exercita os caminhos novos; arquivos exercitados por outras suítes aparecem
subcontados, ver notas):

| Arquivo | Lines | Branch | Funcs | Nota |
|---------|------:|------:|------:|------|
| `src/lib/trpc/auth-markers.ts` | 100% | 100% | 100% | ✅ novo, totalmente coberto |
| `src/lib/trpc/session-guard.ts` | 96.66% | 90.9% | 100% | ✅ ramos P-82 cobertos |
| `src/server/trpc/trpc.ts` | 93.28% | 91.3% | 100% | ✅ `assertAuthContext` 4 ramos cobertos |
| `src/app/admin/users/page.tsx` | 97% | 79.16% | 92% | ✅ ação de reconvite exercitada |
| `src/server/trpc/routers/users.ts` | 62.27% | 84.61% | 100% | 🟡 % do arquivo INTEIRO (muitas procedures); o caminho `invite`/reativação está coberto por `users-reinvite.test.ts` (8 casos) |
| `src/server/trpc/context.ts` | 0% | 0% | 0% | 🟡 não exercitado por unit (é código de request-time; a lógica `authState` só roda em integração, que skipa sem DB). Ver P-108 |

## Checagens específicas do merge

**1. Contagem reconciliada** — ✅ +25 fecha 1:1 (tabela acima). Zero failing, skipped estável.

**2. Type-check + lint zero** — ✅ `tsc --noEmit` exit 0; `next lint` 0 warnings/errors.
   - `assertAuthContext` agora aceita `authState?: Context['authState']`; `enforceAuth`
     (`trpc.ts:198`) chama `assertAuthContext(ctx)` passando o `ctx` inteiro → `ctx.authState`
     propaga. O narrowing de `ctx.user!` a jusante segue válido (tsc exit 0 comprova).
   - `schema.prisma` com `@@unique([tenantId, email], map: "users_tenant_id_email_active_key")`:
     `prisma validate` = "schema is valid 🚀"; `prisma generate` gerou o client sem erro.

**3. Cobertura dos arquivos alterados** — ✅ reportada acima. Caminhos novos exercitados;
   ressalvas em `users.ts` (% do arquivo cheio) e `context.ts` (request-time) são de natureza,
   não regressão.

**4. Migration 0033 (revisão ESTÁTICA — não aplicada em banco)** — ✅
   - Conteúdo: `DROP INDEX IF EXISTS users_tenant_id_email_key;` +
     `CREATE UNIQUE INDEX users_tenant_id_email_active_key ON users (tenant_id, email) WHERE deleted_at IS NULL;` + `COMMENT ON INDEX`.
   - O índice antigo é **INDEX** (não CONSTRAINT): `0001_init` criou
     `CREATE UNIQUE INDEX "users_tenant_id_email_key"` — logo `DROP INDEX` é a operação correta.
   - Espelha fielmente o precedente `0026_clerk_id_per_scope` (DROP índice cheio + CREATE parcial `WHERE`).
   - **Novo nome de índice** (`users_tenant_id_email_active_key`) ≠ antigo (`users_tenant_id_email_key`);
     o `map:` no schema alinha o nome. Como **não** usa `name:`, o input composto Prisma segue `tenantId_email`.
   - **Dependência de índice composto no código:** `grep tenantId_email src/` → **zero ocorrências**.
     Nenhum `findUnique({ where: { tenantId_email: … } })` depende do índice; renomeá-lo é seguro.
     (Os `findUnique` existentes em `email-link.service.ts`/`inbound-email.service.ts` são sobre
     `incomingEmail`/`tenant`, não sobre o composto de `users`.)

**5. P-84 semântica (reconvite)** — ✅ confirmada no código e nos testes:
   - CONFLICT quando existe usuário **ATIVO** com mesmo e-mail no tenant (`findFirst` com `tenantId` explícito).
   - Reativa a linha soft-deleted mais recente (`orderBy deletedAt desc`): `deletedAt=null`, `active=false`,
     `role`/`fullName` atualizados; re-envia convite Clerk com `publicMetadata.localUserId`.
   - **Rollback consistente** em falha do Clerk: restaura `deletedAt/role/fullName/active` do estado anterior e propaga `INTERNAL_SERVER_ERROR`.
   - Audit com `before` (soft-deleted) + `after` (reativado) + `tenantIdOverride: ctx.tenantId`.
   - **Cross-tenant NÃO reativa:** ambos os `findFirst` filtram `tenantId: ctx.tenantId`; soft-deleted de
     outro tenant não é encontrado → cai no `create` normal (não toca a linha do tenant A).
   - Testes cobrem todos os 8 casos (`users-reinvite.test.ts`): reativação, metadata Clerk, audit before/after+override,
     ativo→CONFLICT, cross-tenant→create, rollback do reconvite, create normal (`reactivated=false`), rollback do create.

**6. P-82 semântica (account-not-found)** — ✅
   - **Servidor** (`assertAuthContext`): `user+tenantId` → passa; `authState==='NOT_PROVISIONED'` →
     `UNAUTHORIZED` com `message = USER_NOT_PROVISIONED`; senão → `UNAUTHORIZED` comum.
     `context.ts` popula `authState = user ? 'OK' : 'NOT_PROVISIONED'` (com clerkId+tenantId presentes), senão `'ANONYMOUS'`.
   - **Cliente** (`session-guard`): 401 com marcador → `window.location.assign('/account-not-found')` (uma vez);
     401 comum → reload ~800ms; já em `/account-not-found` → no-op; rota pública → no-op; idempotente via `handling401`.
     `safeStringify` torna a detecção robusta a ambos os formatos (JSON do middleware **e** envelope batch tRPC).
   - **Sem PII:** marcador é a constante `'USER_NOT_PROVISIONED'` (nenhum dado do usuário).
   - **Sem ruído no Sentry:** `shouldReportTrpcError` retorna `true` só para `INTERNAL_SERVER_ERROR`;
     `UNAUTHORIZED` (comum e NOT_PROVISIONED) **não** é reportado.
   - Tela `/account-not-found` usa Clerk `signOut({redirectUrl:'/sign-in'})` e **não faz chamada tRPC autenticada** → não entra em loop.
   - Testes: `session-guard.test.ts` (marcador→redirect, comum→reload, 2× no-op em `/account-not-found`) e
     `trpc-middlewares.test.ts` (OK / ANONYMOUS-sem-marcador / NOT_PROVISIONED-com-marcador / mock legado sem `authState`).

**7. Regra P-42 / multi-tenancy** — ✅
   - `src/server/db/client.ts` **intocado** (diff vazio vs `608a26c`) — backstop preservado.
   - Toda query nova em `users.ts` filtra `tenantId: ctx.tenantId` nos `findFirst`; os `update` são por
     `id` já resolvido sob filtro de tenant (padrão aceito; payload não seta `tenantId`, então o backstop libera).

**8. Integridade docs** — ✅
   - `docs/Runbook_Recovery_Pos_Neon_Restore.md` presente (6965 bytes).
   - `docs/Roteiro_QA_Homologacao_Staging.md`: **zero** marcadores de conflito;
     P-82 (§ regressão, linha ~1050 "conta Clerk sem row local → tela dedicada, não loop") e
     P-83/P-84 (§2.12 "Reconvite de e-mail desativado" — inclui aviso de migration-antes-do-código,
     reativação, ativo→CONFLICT e cross-tenant). Sem duplicação.

## O que rodou vs BLOCKED

| Item | Status | Motivo |
|------|--------|--------|
| Vitest unit + component | ✅ RODOU | 1673 casos, exit 0 |
| Cobertura v8 dos arquivos alterados | ✅ RODOU | reportada acima |
| `tsc --noEmit` / `next lint` | ✅ RODOU | zero |
| `prisma validate` / `generate` | ✅ RODOU | válido / gerou |
| Integration (Supertest) | ⏭️ SKIP | sem `DATABASE_URL_TEST` (intencional — reproduz baseline; suíte de integração guardada por `describeIfDb`) |
| Playwright E2E / axe | 🚫 **BLOCKED** | precisa de app rodando (`webServer`/`baseURL:3000`) + Clerk real + DB seedado. Débito de infra conhecido (P-59). **Além disso, nenhum spec E2E existente cobre P-82/83/84** — os 3 chips são unit/component-testados, então isto **não** é lacuna de cobertura deste merge |

## Débitos residuais

- **P-108 (baixa)** — `src/server/trpc/context.ts` sem cobertura unit (0%). A resolução
  `authState = user ? 'OK' : 'NOT_PROVISIONED'` só é exercida em request-time/integração
  (que skipa sem DB). Opções: (a) extrair a resolução de `authState` numa função pura testável,
  ou (b) adicionar um caso em `tests/integration` gated por `DATABASE_URL_TEST`. Não bloqueia —
  a lógica é trivial e correta na revisão; os consumidores (`assertAuthContext`) estão 100% cobertos.
- **P-109 (informativo, pré-existente/aceito)** — drift declarativo do Prisma: `@@unique([tenantId,email])`
  é declarado CHEIO no schema, mas o índice REAL no banco é PARCIAL (`WHERE deleted_at IS NULL`). É o mesmo
  padrão já aceito para `clerk_id` (0026); a migration SQL é a fonte da verdade. Um `prisma migrate dev`
  futuro pode acusar drift fantasma — comportamento esperado, documentar no runbook de migrations se recorrer.

## Recomendação

**Seguir para o rollout da migration 0033.** Ordem crítica (§2.12 do Roteiro +
`migration-before-code-deploy`): aplicar `prisma migrate deploy` **antes** de subir o
código, pois `users.invite` já espera o índice parcial para reativar sem colisão.
Rollback: reverter índice para cheio exige que não haja e-mail duplicado ativo (raro).
Nenhum chip de correção necessário antes do deploy.
