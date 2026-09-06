-- =====================================================================
-- Migration 0035 — Sprint 15H Bloco B (Chip 1b): Metas por Unidade
-- =====================================================================
-- Fundação do Bloco B: tabela `sales_quotas` (1 meta por unit × período)
-- + coluna `tenants.quota_period_type`. Nada de router/UI aqui — o router
-- completo (7 procedures) vem no Chip 2b e as telas nas Fases 3.
--
-- ⚠️ NUMERAÇÃO: a spec §4.1 dizia "0034", mas o housekeeping P-83
-- (`0033_users_email_partial_unique`) reivindicou o 0033 e já está EM PROD
-- (2026-08-03). Última migration no disco = 0033. O Chip 1a paralelo cria
-- a 0034 (approvals); esta (metas) é a **0035**. Ver banner de renumeração
-- no topo de docs/Sprint_15H_Metas_e_Approvals.md.
--
-- Padrões aplicados:
--   - RLS default policy (enable_tenant_rls do 0002_rls) — 2ª linha de
--     defesa de multi-tenancy.
--   - Memory `migration-pitfalls.md` (pattern #4): UNIQUE de (unit,period)
--     é PARCIAL `WHERE deleted_at IS NULL`. Com soft delete + `@@unique`
--     cheio, uma meta soft-deleted bloquearia recriar a meta da mesma
--     (unit, period). O parcial deixa 1 meta ATIVA por (unit,period) e
--     permite histórico soft-deleted. Prisma não expressa parcial —
--     schema.prisma declara `@@unique(..., map: <nome>)` e o SQL é a fonte
--     da verdade (mesmo pattern do P-83 e do 0031 is_primary).
--
-- Idempotência: `IF NOT EXISTS` / `IF NOT EXISTS` nos ADD COLUMN. Roda 2×
-- sem erro (exceto CREATE TABLE, que a Prisma envolve por migration única).
--
-- Rollback plan (manual, se necessário):
--   1. `SET SALES_QUOTAS_ENABLED=false` no runtime → nenhum consumer lê a
--      tabela (Chip 2b respeita a flag).
--   2. `DROP TABLE sales_quotas CASCADE;`
--   3. `ALTER TABLE tenants DROP COLUMN quota_period_type;`
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabela: sales_quotas — meta (target) de faturamento por unit × período
--   period: string "YYYY-QN" (trimestre) | "YYYY-MM" (mês) | "YYYY-HN"
--           (semestre) | "YYYY" (anual). Formato governado por
--           tenants.quota_period_type.
--   target_value: meta em `currency` (default BRL).
--   O progresso (soma de opps WON no subtree da unit no período) é
--   computado em runtime pelo quota.service — não é materializado aqui.
-- ---------------------------------------------------------------------
CREATE TABLE sales_quotas (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id      uuid          NOT NULL REFERENCES sales_units(id) ON DELETE CASCADE,
  period       text          NOT NULL,
  target_value numeric(15,2) NOT NULL,
  currency     text          NOT NULL DEFAULT 'BRL',
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   uuid,
  deleted_at   timestamptz,

  CONSTRAINT sales_quotas_period_not_empty CHECK (period <> ''),
  CONSTRAINT sales_quotas_target_non_negative CHECK (target_value >= 0)
);

-- Emenda migration-pitfalls #4: 1 meta ATIVA por (tenant, unit, period).
-- Parcial (WHERE deleted_at IS NULL) permite recriar após soft delete.
CREATE UNIQUE INDEX sales_quotas_tenant_unit_period_active_key
  ON sales_quotas (tenant_id, unit_id, period)
  WHERE deleted_at IS NULL;

CREATE INDEX sales_quotas_tenant_period_idx ON sales_quotas (tenant_id, period);
CREATE INDEX sales_quotas_unit_id_idx       ON sales_quotas (unit_id);

COMMENT ON TABLE sales_quotas IS
  'Metas de faturamento por unit × período (Sprint 15H Bloco B, Chip 1b). Progresso computado em runtime no quota.service (opps WON no subtree ltree da unit).';
COMMENT ON INDEX sales_quotas_tenant_unit_period_active_key IS
  'UNIQUE PARCIAL: 1 meta ATIVA por (tenant, unit, period). WHERE deleted_at IS NULL permite histórico soft-deleted + recriar (migration-pitfalls #4).';

-- ---------------------------------------------------------------------
-- RLS — pattern padrão do projeto (enable_tenant_rls do 0002_rls)
-- ---------------------------------------------------------------------
SELECT enable_tenant_rls('sales_quotas');

-- ---------------------------------------------------------------------
-- tenants.quota_period_type — granularidade padrão de metas do tenant.
--   QUARTERLY (default) | MONTHLY | SEMIANNUAL | ANNUAL.
-- ---------------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS quota_period_type text NOT NULL DEFAULT 'QUARTERLY';

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_quota_period_type_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_quota_period_type_check
  CHECK (quota_period_type IN ('QUARTERLY', 'MONTHLY', 'SEMIANNUAL', 'ANNUAL'));

COMMENT ON COLUMN tenants.quota_period_type IS
  'Granularidade padrão das metas (Sprint 15H Bloco B): QUARTERLY|MONTHLY|SEMIANNUAL|ANNUAL. Governa o formato do sales_quotas.period.';
