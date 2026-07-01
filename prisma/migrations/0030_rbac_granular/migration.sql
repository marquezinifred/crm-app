-- ================================================================
-- Migration 0030 — Sprint 15E: RBAC granular (permissões configuráveis)
-- ================================================================
-- Padrões aplicados (ver `memory/migration-pitfalls.md`):
--   1. Cast enum_old[] → text[] → enum_new[] (via text intermediário)
--   2. Sanitizar valores inválidos ANTES de DROP TYPE
--   3. Partial UNIQUE em coluna nullable (não aplicável aqui)
--   4. CHECK XOR pra `approver_roles` vs `approver_permission`
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Tabela de overrides por (user, permission)
-- ----------------------------------------------------------------
CREATE TABLE user_permission_overrides (
  id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid            NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  tenant_id   uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  permission  text            NOT NULL,
  action      text            NOT NULL CHECK (action IN ('granted', 'revoked')),
  granted_by  uuid            REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz     NOT NULL DEFAULT now(),
  reason      text,
  CONSTRAINT user_permission_unique UNIQUE (user_id, permission)
);

CREATE INDEX user_permission_overrides_user_id_idx
  ON user_permission_overrides(user_id);

CREATE INDEX user_permission_overrides_tenant_id_idx
  ON user_permission_overrides(tenant_id);

COMMENT ON TABLE user_permission_overrides IS
  'Overrides individuais de permission por user (Sprint 15E). Precedência: revoked > granted > default do role.';

-- ----------------------------------------------------------------
-- 2. Cache de permissions efetivas por user
--    Duas colunas: `cached_permissions text[] DEFAULT '{}'` guarda o
--    resultado (pode ser vazio pra PARCEIRO com todas defaults revogadas)
--    e `cached_permissions_at timestamptz NULL` sinaliza se já foi
--    computado. NULL = "não computado ainda"; não-null = "computado".
--
--    Prisma não suporta `String[]?` — daí a separação em 2 colunas.
--    Ver docs/Sprint_15E_RBAC_Granular.md §6.6.
-- ----------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN cached_permissions    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN cached_permissions_at timestamptz;

COMMENT ON COLUMN users.cached_permissions IS
  'Cache de permissions efetivas (Sprint 15E). Valor válido apenas quando cached_permissions_at IS NOT NULL.';
COMMENT ON COLUMN users.cached_permissions_at IS
  'Quando o cache foi computado (Sprint 15E). NULL = ainda não computado; força recompute no próximo hasPermission.';

-- ----------------------------------------------------------------
-- 3. RLS pra user_permission_overrides — padrão do projeto
-- ----------------------------------------------------------------
ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_permission_overrides_tenant_isolation
  ON user_permission_overrides
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY user_permission_overrides_tenant_insert
  ON user_permission_overrides
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ----------------------------------------------------------------
-- 4. Backfill: GESTOR_INBOUND → ADMIN + 4 permission overrides
--
--    Rationale: ADMIN já tem as 4 permissions inbound por default,
--    então o override é redundante — mas mantido pra rastreabilidade
--    ("quem veio de GESTOR_INBOUND?"). ON CONFLICT DO NOTHING protege
--    idempotência caso o admin tenha concedido manual antes.
--
--    Ordem crítica: INSERT overrides ANTES de mudar role.
-- ----------------------------------------------------------------
INSERT INTO user_permission_overrides (user_id, tenant_id, permission, action, granted_at, reason)
SELECT
  u.id,
  u.tenant_id,
  perm,
  'granted',
  now(),
  'Backfill Sprint 15E — migrated from GESTOR_INBOUND role'
FROM users u
CROSS JOIN LATERAL unnest(ARRAY[
  'inbound:view_queue',
  'inbound:assign_prospects',
  'inbound:configure',
  'inbound:view_reports'
]) AS perm
WHERE u.role::text = 'GESTOR_INBOUND'
  AND u.tenant_id IS NOT NULL
ON CONFLICT (user_id, permission) DO NOTHING;

-- ----------------------------------------------------------------
-- 5. Sanitizar approval_rules.approver_roles antes de dropar o enum
--    (pattern migration-pitfalls #3). Só aplicamos se algum tenant
--    tinha GESTOR_INBOUND em rules — no seed default nada bate.
-- ----------------------------------------------------------------
UPDATE approval_rules
   SET approver_roles = array_remove(approver_roles, 'GESTOR_INBOUND'::"UserRole")
 WHERE 'GESTOR_INBOUND'::"UserRole" = ANY(approver_roles);

-- ----------------------------------------------------------------
-- 6. Migrar TODOS os users GESTOR_INBOUND pra ADMIN.
--    Sanity: users soft-deleted também migram pra manter integridade
--    referencial de audit_logs / activity logs no futuro.
-- ----------------------------------------------------------------
UPDATE users SET role = 'ADMIN' WHERE role::text = 'GESTOR_INBOUND';

-- ----------------------------------------------------------------
-- 7. Cast do enum via text intermediário (pattern migration-pitfalls #1)
--    NUNCA `USING col::"UserRole"` direto — Postgres não casta entre
--    tipos de enum diferentes mesmo com labels compatíveis.
-- ----------------------------------------------------------------
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO'
);

-- Colunas escalares
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole",
  ALTER COLUMN role SET DEFAULT 'ANALISTA';

-- approval_rules.approver_roles é array — mesmo padrão
ALTER TABLE approval_rules
  ALTER COLUMN approver_roles TYPE "UserRole"[]
  USING approver_roles::text[]::"UserRole"[];

DROP TYPE "UserRole_old";

-- ----------------------------------------------------------------
-- 8. approval_rules ganha approver_permission (alternativa a approver_roles)
--    CHECK XOR: exatamente um dos dois preenchido.
--    Regras antigas seguem funcionando (approver_roles não-vazio,
--    approver_permission NULL). Novas regras podem apontar pra permission
--    granular pra abranger overrides individuais.
-- ----------------------------------------------------------------
ALTER TABLE approval_rules
  ADD COLUMN approver_permission text;

ALTER TABLE approval_rules
  ADD CONSTRAINT approval_rules_approver_check
  CHECK (
    (approver_roles IS NOT NULL AND array_length(approver_roles, 1) > 0 AND approver_permission IS NULL)
    OR
    (approver_permission IS NOT NULL AND (approver_roles IS NULL OR array_length(approver_roles, 1) = 0))
  );

COMMENT ON COLUMN approval_rules.approver_permission IS
  'Alternativa a approver_roles (Sprint 15E). Se setado, aprovadores são todos os users com esta permission (via cachedPermissions). Não pode coexistir com approver_roles não-vazio (CHECK XOR).';

-- ----------------------------------------------------------------
-- 9. Índice partial pra whoHas('inbound:view_queue') e afins.
--    Ganho: query filtra `cached_permissions @> ARRAY['x']` sem full scan.
-- ----------------------------------------------------------------
CREATE INDEX users_cached_permissions_gin_idx
  ON users USING GIN (cached_permissions)
  WHERE cached_permissions_at IS NOT NULL;

-- ----------------------------------------------------------------
-- 10. cached_permissions começa NULL pra TODOS os users. Populado
--     pelo script `scripts/rbac-backfill-cache.ts` pós-migration
--     OU on-demand por `hasPermission` no primeiro request.
--
--     ⚠️ CRÍTICO: rodar backfill script antes de ativar
--     RBAC_GRANULAR_ENABLED=true pra evitar `permissions.whoHas`
--     retornando [] silenciosamente. Ver spec §5.4.
-- ----------------------------------------------------------------
