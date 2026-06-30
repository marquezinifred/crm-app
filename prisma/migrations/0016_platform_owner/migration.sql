-- Sprint 15A — Platform Owner

CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_SUPPORT');

-- users ganha colunas opcionais
ALTER TABLE users
  ADD COLUMN platform_role "PlatformRole",
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Migração: SUPER_ADMIN → PLATFORM_OWNER (zero rows hoje na prática,
-- mas trata o caso por segurança ANTES de remover do enum)
UPDATE users
   SET platform_role = 'PLATFORM_OWNER',
       tenant_id     = NULL,
       role          = 'ADMIN'
 WHERE role::text = 'SUPER_ADMIN';

-- Remove SUPER_ADMIN do enum UserRole + adiciona DIRETOR_OPERACOES.
-- Pattern: RENAME old → CREATE new → cast TODAS as colunas → DROP old.
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

-- 1. Cast da coluna escalar users.role
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole",
  ALTER COLUMN role SET DEFAULT 'ANALISTA';

-- 2. Sanitizar arrays de roles ANTES do cast — qualquer 'SUPER_ADMIN'
--    em approval_rules.approver_roles vira 'ADMIN' (mantém comportamento;
--    Admin já tem permissão equivalente em rbac.ts). Necessário porque
--    'SUPER_ADMIN' deixa de existir no novo enum e o cast text[]→enum[]
--    rejeita valores inválidos.
UPDATE approval_rules
   SET approver_roles = (
     SELECT array_agg(
       (CASE WHEN r = 'SUPER_ADMIN' THEN 'ADMIN' ELSE r END)::"UserRole_old"
     )
     FROM unnest(approver_roles) AS r
   )
 WHERE 'SUPER_ADMIN'::text = ANY(approver_roles::text[]);

-- 3. Cast da coluna ARRAY approval_rules.approver_roles.
--    Postgres não casta enum[] → enum[] diretamente, mesmo com mesmos
--    labels. Rotear via text[]: enum[]→text[]→enum[].
ALTER TABLE approval_rules
  ALTER COLUMN approver_roles TYPE "UserRole"[]
  USING approver_roles::text[]::"UserRole"[];

-- 4. Agora sim — sem dependentes, drop seguro.
DROP TYPE "UserRole_old";

-- CHECK: tenant user OU platform user, nunca os dois nem nenhum
ALTER TABLE users
  ADD CONSTRAINT users_tenant_xor_platform_check
  CHECK (
    (tenant_id IS NOT NULL AND platform_role IS NULL) OR
    (tenant_id IS NULL     AND platform_role IS NOT NULL)
  );

-- Índice rápido pra detectar Platform Users
CREATE INDEX users_platform_role_idx ON users (platform_role) WHERE platform_role IS NOT NULL;

-- audit_logs.tenant_id nullable + nova coluna metadata JSONB para
-- registrar Platform actions + impersonation context (Sprint 15A).
ALTER TABLE audit_logs
  ALTER COLUMN tenant_id DROP NOT NULL,
  ADD COLUMN metadata JSONB;

CREATE INDEX audit_logs_metadata_impersonation_idx
  ON audit_logs ((metadata->>'impersonated_by'))
  WHERE metadata ? 'impersonated_by';
