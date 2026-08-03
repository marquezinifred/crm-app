-- P-83 — UNIQUE(tenant_id, email) global bloqueava reconvite de e-mail.
-- O índice CHEIO users_tenant_id_email_key (criado na 0001_init) considerava
-- linhas soft-deleted (deleted_at IS NOT NULL) na verificação de unicidade.
-- Consequência: desativar um usuário (soft delete) e depois reconvidar o
-- MESMO e-mail colidia com o índice → erro Prisma cru vazava pra UI, sem
-- caminho de reativação.
--
-- Solução: tornar o UNIQUE PARCIAL — WHERE deleted_at IS NULL. Garante:
--   • no máximo 1 usuário ATIVO por (tenant_id, email)
--   • o mesmo e-mail pode reaparecer num tenant desde que a linha anterior
--     esteja soft-deleted → habilita a reativação do P-84
--
-- Precedente: prisma/migrations/0026_clerk_id_per_scope/migration.sql aplicou
-- o mesmo padrão (DROP INDEX cheio + CREATE UNIQUE INDEX ... WHERE ...) para
-- clerk_id. O Prisma não tem sintaxe de partial unique — o @@unique no
-- schema é declarativo; esta migration SQL é a fonte da verdade.

DROP INDEX IF EXISTS users_tenant_id_email_key;

CREATE UNIQUE INDEX users_tenant_id_email_active_key
  ON users (tenant_id, email)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX users_tenant_id_email_active_key IS
  'Partial: mesmo e-mail pode reaparecer num tenant desde que a linha anterior esteja soft-deleted (deleted_at IS NOT NULL). Permite reconvite (P-84).';
