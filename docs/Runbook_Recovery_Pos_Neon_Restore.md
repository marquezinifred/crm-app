# Runbook — Recovery pós-restore Neon PITR

**Débito:** P-81 · **Severidade:** baixa · **Autor:** gestão · **Criado:** 2026-08-03

Procedimento para reconciliar o banco com o Clerk **depois de um restore
point-in-time (PITR) do Neon** que reverta a tabela `users` para um estado
anterior. Sintoma-âncora: contas Clerk válidas cujo row local em `users`
sumiu no restore → **loop de reload infinito no dashboard** (P-82: sessão
Clerk boa + `public_metadata.tenantId` populado + user ausente no banco →
401 em todo tRPC → session-guard força reload → mesmo estado).

> Origem: incidente real de 2026 — 4 users perdidos após restore acidental,
> cada passo improvisado na hora. Este runbook consolida o que funcionou.

Enquanto o P-82 (tela dedicada `/account-not-found`) não estiver entregue,
o **único** caminho de saída pro usuário afetado é este recovery no backend.

---

## 0. Pré-condições e princípios

- **Fonte da verdade da identidade = Clerk** (clerk_id, e-mail,
  `public_metadata.tenantId` / `role` / `localUserId`). O banco é o que
  reconstruímos a partir dele.
- **Nunca** parsear secret em shell (memory `feedback_never_parse_secrets`) —
  connection string do Neon só via env/`psql "$DATABASE_URL"`, jamais
  `echo`/`awk`/`sed` do valor.
- Como o CRM resolve o user (contexto tRPC, `src/server/trpc/context.ts`):
  raw SQL `WHERE clerk_id = :clerkId AND tenant_id = :tenantId`. Se não achar
  row → `user = null` → `protectedProcedure` lança `UNAUTHORIZED` (401). É
  exatamente esse `null` que precisamos eliminar.
- **Multi-tenancy:** todo INSERT/UPDATE inclui `tenant_id`. A recuperação
  respeita o tenant do metadata Clerk — nunca "adivinhar" tenant.

---

## 1. Detecção — quem sumiu?

Objetivo: listar contas Clerk ativas **sem** row correspondente (não
soft-deleted, ausente de fato) em `users`.

1. **Exportar o roster do Clerk** (Dashboard → Users, ou API
   `GET /v1/users`) com, por usuário: `id` (clerk_id), `email`,
   `public_metadata.tenantId`, `public_metadata.role`,
   `public_metadata.localUserId`.

2. **Diff contra o banco.** Para cada clerk_id do roster, checar existência:

   ```sql
   -- Passar clerk_ids conhecidos; retorna os que EXISTEM no banco.
   SELECT clerk_id, tenant_id, email, deleted_at
   FROM users
   WHERE clerk_id = ANY($1::text[]);
   ```

   - Clerk_id **ausente** da resposta → **desaparecido** (candidato a
     reinserção, §2).
   - Clerk_id presente mas `deleted_at IS NOT NULL` → **soft-deleted**
     (decidir reativar via §2.b em vez de inserir novo).

3. **Sanidade de escopo:** confirmar que só os users do intervalo do restore
   sumiram. Rodar contagem antes de agir:

   ```sql
   SELECT tenant_id, count(*) FILTER (WHERE deleted_at IS NULL) AS ativos
   FROM users GROUP BY tenant_id ORDER BY tenant_id;
   ```

---

## 2. Recuperação seletiva

Reinserir **um user por vez**, preservando `role`/`tenant` do metadata Clerk.
Não recriar em lote cego — validar cada linha contra o Clerk.

### 2.a — User desaparecido (sem row)

```sql
-- Reinsere preservando identidade Clerk. Ajustar os literais a partir
-- do metadata Clerk do usuário. active=true para permitir sign-in imediato.
INSERT INTO users (id, tenant_id, clerk_id, email, full_name, role, active,
                   cached_permissions, cached_permissions_at,
                   created_at, updated_at)
VALUES (
  gen_random_uuid(),          -- ou o localUserId do metadata, se existir (ver nota)
  $tenantId::uuid,            -- public_metadata.tenantId
  $clerkId,                   -- Clerk user id
  $email,                     -- Clerk primary email
  $fullName,                  -- Clerk full name
  $role::"UserRole",          -- public_metadata.role (ANALISTA se ausente)
  true,
  '{}', NULL,                 -- cache RBAC vazio → recomputado no §3
  now(), now()
);
```

> **Nota `localUserId`:** o convite (`users.invite`) grava
> `public_metadata.localUserId` = id do row local original. Se o metadata
> ainda o tiver, **reusar esse UUID** no `id` acima mantém FKs de
> auditoria/ownership consistentes com quaisquer linhas que sobreviveram ao
> restore. Se não houver ou colidir, `gen_random_uuid()` é aceitável (o user
> volta a operar; ownership histórico órfão fica como débito de dados).

### 2.b — User soft-deleted (row existe, `deleted_at` setado)

Não inserir novo — **reativar** (evita colisão com o UNIQUE
`(tenant_id, email)`; ver P-83):

```sql
UPDATE users
SET deleted_at = NULL, active = true, updated_at = now()
WHERE clerk_id = $clerkId AND tenant_id = $tenantId::uuid;
```

### Verificação imediata pós-write

```sql
SELECT id, clerk_id, tenant_id, email, role, active, deleted_at
FROM users WHERE clerk_id = $clerkId;
```

Confirmar `deleted_at IS NULL`, `active = true`, `role`/`tenant_id` corretos.

---

## 3. Cache RBAC — OBRIGATÓRIO

Todo user recuperado entra com `cached_permissions = '{}'` /
`cached_permissions_at = NULL`. Repopular antes de liberar o acesso, senão
`permissions.whoHas` e checagens dependentes de cache retornam vazio:

```bash
npm run rbac:backfill-cache
```

Idempotente, ~30s para ~1000 users. Recomputa `computeAndCacheUserPermissions`
para todos os users ativos (não só os recuperados) — seguro rodar inteiro.

---

## 4. Verificação final (por role recuperada)

Para **cada** role afetada, um smoke real de sign-in:

- [ ] Sign-in via Clerk conclui sem "Development mode" bloqueando (ver P-85).
- [ ] Dashboard carrega **sem loop de reload** (o sintoma-âncora sumiu).
- [ ] `users.me` retorna `id`/`role`/`tenantId` corretos (Network tab: 200,
      não 401).
- [ ] Uma ação gated por permission da role funciona (ex.: ADMIN abre
      `/admin/users`; ANALISTA vê o próprio pipeline).
- [ ] `audit_logs` não acusa erro de tenant no acesso.

Se algum user recuperado ainda entrar em loop 401: reconferir que
`clerk_id` **e** `tenant_id` batem exatamente com o metadata Clerk (o
lookup do contexto exige os dois).

---

## 5. Pós-incidente

- Registrar no `docs/Backlog_Pos_MVP.md` / planejamento quantos users, qual
  tenant, e a causa do restore.
- Se o restore foi acidental, revisar o gatilho (quem/como) e considerar
  proteção de branch/PITR no Neon.
- Quando o **P-82** entregar a tela `/account-not-found`, o usuário afetado
  passa a ter auto-serviço de saída do loop (sign-out) — este runbook
  continua sendo o caminho de **reconstrução do dado**, mas deixa de ser a
  única forma de destravar a sessão.

---

## Referências

- `src/server/trpc/context.ts` — lookup do user (clerk_id + tenant_id).
- `src/lib/trpc/session-guard.ts` — origem do reload no 401 (P-13/P-82).
- `scripts/rbac-backfill-cache.ts` — repopulação de cache (Sprint 15E).
- P-82 (loop 401 → tela dedicada) e P-83 (partial UNIQUE) —
  `docs/Planejamento_Debitos_Pos_Rollout_15G.md`.
- memory `db:reset destroys Clerk link`, `feedback_never_parse_secrets`.
