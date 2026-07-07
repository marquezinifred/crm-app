-- =====================================================================
-- Migration 0031 — Sprint 15G Fase 1a: Estrutura comercial hierárquica
-- =====================================================================
-- Cria fundação de estrutura organizacional com ltree do Postgres (árvore
-- N-nível). Nada de RBAC/scope resolver aqui — só schema + backfill A1.
-- Chip Fase 1b muda permissions-catalog + rbac.ts. Chip Fase 2 monta
-- `resolveOpportunityScope`. Este chip é disjunto.
--
-- Padrões aplicados:
--   - Emenda A1 (Sprint_15G_amendments.md): backfill mínimo por tenant
--     preserva visibilidade GESTOR pré-15G quando Fase 2 acender flag.
--   - Emenda A5: partial unique index em sales_unit_members.is_primary
--     protege race condition de "só 1 primary por user".
--   - Emenda A7: CHECK constraint no path bloqueia bypass silencioso
--     (`prisma.salesUnit.create()` esquecendo path aceitaria '' como
--     ltree válido). Convenção "sempre repository" documentada no
--     src/server/db/repositories/sales-unit.repository.ts.
--   - Memory `migration-pitfalls.md`: partial UNIQUE em coluna nullable
--     (pattern #4), preservado em is_primary.
--
-- Idempotência: `CREATE EXTENSION IF NOT EXISTS`, `ON CONFLICT DO NOTHING`
-- nos INSERTs de backfill. Roda 2× sem erro.
--
-- Rollback plan (manual, se necessário):
--   1. `SET SALES_STRUCTURE_ENABLED=false` no runtime → nenhum consumer
--      lê estas tabelas (chip Fase 2 respeita a flag).
--   2. `DROP TABLE sales_unit_members CASCADE;`
--      `DROP TABLE sales_units CASCADE;`
--      `DROP TABLE sales_unit_types CASCADE;`
--      `DROP TYPE "UnitMemberRole";`
--   3. Extension ltree pode ficar (compartilhada com outras features
--      futuras) ou `DROP EXTENSION ltree;`.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS ltree;

-- ---------------------------------------------------------------------
-- Enum UnitMemberRole — MANAGER (gestor da unidade) vs MEMBER (analista)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "UnitMemberRole" AS ENUM ('MANAGER', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Tabela 1: sales_unit_types — categorias hierárquicas por tenant
--   Ex.: level=1 "Diretoria", level=2 "Regional", level=3 "Equipe".
--   Chip Fase 1a cria apenas 1 type default por tenant (backfill A1).
-- ---------------------------------------------------------------------
CREATE TABLE sales_unit_types (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  level      integer     NOT NULL CHECK (level >= 1 AND level <= 10),
  color      text,
  icon       text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sales_unit_types_tenant_level_unique UNIQUE (tenant_id, level),
  CONSTRAINT sales_unit_types_tenant_name_unique  UNIQUE (tenant_id, name)
);

CREATE INDEX sales_unit_types_tenant_id_idx ON sales_unit_types(tenant_id);

COMMENT ON TABLE sales_unit_types IS
  'Categorias hierárquicas (Sprint 15G Fase 1a). Level determina profundidade da árvore de sales_units.';

-- ---------------------------------------------------------------------
-- Tabela 2: sales_units — nós da árvore organizacional
--   path é ltree; short_id (~8 chars) usado como label ltree (regex A7).
--   parent_id é FK auto-referente pra reforçar consistência da árvore.
-- ---------------------------------------------------------------------
CREATE TABLE sales_units (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type_id    uuid        NOT NULL REFERENCES sales_unit_types(id) ON DELETE RESTRICT,
  name       text        NOT NULL,
  short_id   text        NOT NULL,
  path       ltree       NOT NULL,
  depth      integer     NOT NULL CHECK (depth >= 1 AND depth <= 10),
  parent_id  uuid        REFERENCES sales_units(id) ON DELETE RESTRICT,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  -- A7: path é ltree; sem CHECK, `prisma.salesUnit.create()` esquecendo path
  -- geraria label vazio silencioso. Regex garante formato consistente.
  CONSTRAINT sales_units_path_not_empty
    CHECK (path::text != '' AND path::text ~ '^[a-zA-Z0-9._]+$'),

  -- short_id só precisa ser único DENTRO do path do parent (não global).
  -- Aqui usamos UNIQUE simples por tenant pra prevenir colisão global
  -- em cenários de reordenação futura (Sprint 15I).
  CONSTRAINT sales_units_tenant_short_id_unique UNIQUE (tenant_id, short_id)
);

-- Índice GiST no path suporta queries `descendant_of`, `ancestor_of`, `<@`, `@>`.
CREATE INDEX sales_units_path_gist_idx  ON sales_units USING GIST (path);
CREATE INDEX sales_units_tenant_id_idx  ON sales_units(tenant_id);
CREATE INDEX sales_units_parent_id_idx  ON sales_units(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX sales_units_type_id_idx    ON sales_units(type_id);
CREATE INDEX sales_units_tenant_active_idx ON sales_units(tenant_id, active) WHERE deleted_at IS NULL;

COMMENT ON TABLE sales_units IS
  'Nós da árvore comercial (Sprint 15G Fase 1a). path=ltree; SEMPRE criar via SalesUnitRepository (convenção A7 — CHECK bloqueia bypass).';

-- ---------------------------------------------------------------------
-- Tabela 3: sales_unit_members — associação N:M user × unidade
--   role: MANAGER (gestor da unidade — vê subtree) ou MEMBER (analista).
--   is_primary marca a unidade "casa" do user; partial UNIQUE (A5) garante
--   no máximo 1 primary por user, mesmo sob concorrência.
-- ---------------------------------------------------------------------
CREATE TABLE sales_unit_members (
  id           uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id      uuid            NOT NULL REFERENCES sales_units(id) ON DELETE CASCADE,
  tenant_id    uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role         "UnitMemberRole" NOT NULL,
  is_primary   boolean         NOT NULL DEFAULT false,
  assigned_by  uuid            REFERENCES users(id) ON DELETE SET NULL,
  assigned_at  timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT sales_unit_members_user_unit_unique UNIQUE (user_id, unit_id)
);

CREATE INDEX sales_unit_members_user_id_idx     ON sales_unit_members(user_id);
CREATE INDEX sales_unit_members_unit_id_idx     ON sales_unit_members(unit_id);
CREATE INDEX sales_unit_members_tenant_id_idx   ON sales_unit_members(tenant_id);
CREATE INDEX sales_unit_members_unit_role_idx   ON sales_unit_members(unit_id, role);

-- Emenda A5: no máximo 1 primary por user, mesmo com writes concorrentes.
CREATE UNIQUE INDEX sales_unit_members_one_primary_per_user
  ON sales_unit_members (user_id)
  WHERE is_primary = true;

COMMENT ON TABLE sales_unit_members IS
  'Membros de unidade (Sprint 15G Fase 1a). MANAGER vê subtree; MEMBER só vê própria. is_primary=unidade casa (partial UNIQUE A5 impede 2 primary por user).';

-- ---------------------------------------------------------------------
-- RLS — pattern padrão do projeto (enable_tenant_rls do 0002_rls)
-- ---------------------------------------------------------------------
SELECT enable_tenant_rls('sales_unit_types');
SELECT enable_tenant_rls('sales_units');
SELECT enable_tenant_rls('sales_unit_members');

-- ---------------------------------------------------------------------
-- Backfill A1: estrutura mínima por tenant existente
--
-- Objetivo: garantir que quando Fase 2 acender resolveOpportunityScope
-- + flag SALES_STRUCTURE_ENABLED=true, GESTOR/DIRETOR/ADMIN continuem
-- vendo o que já viam pré-15G (via read_team sobre a subtree do único
-- unit default) em vez de degradar pra OWN.
--
-- Idempotente: ON CONFLICT DO NOTHING em cada INSERT.
-- ---------------------------------------------------------------------

-- Passo 1: cria SalesUnitType "Unidade" nível 1 por tenant.
INSERT INTO sales_unit_types (tenant_id, name, level, color, icon)
SELECT id, 'Unidade', 1, '#6366F1', 'users'
FROM tenants
WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Passo 2: cria SalesUnit "Padrão" raiz por tenant.
--
-- short_id gerado deterministicamente do UUID do tenant (8 chars
-- alfanuméricos derivados de md5). Basta ser único por tenant — o
-- CONSTRAINT `sales_units_tenant_short_id_unique` protege colisão
-- futura em runtime (repository gera via crypto.randomBytes).
INSERT INTO sales_units (tenant_id, type_id, name, short_id, path, depth, parent_id, active)
SELECT
  t.id,
  sut.id,
  'Padrão',
  substr(md5(t.id::text || '-default-unit'), 1, 8),
  ('root.' || substr(md5(t.id::text || '-default-unit'), 1, 8))::ltree,
  1,
  NULL,
  true
FROM tenants t
JOIN sales_unit_types sut
  ON sut.tenant_id = t.id
 AND sut.level = 1
 AND sut.name = 'Unidade'
WHERE t.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Passo 3: adiciona TODOS os users ativos do tenant como membros.
--   role = MANAGER para ADMIN/DIRETOR_*/GESTOR (papéis de gestão).
--   role = MEMBER para ANALISTA/PARCEIRO.
--   is_primary=true (única unit no tenant após backfill; partial UNIQUE
--   A5 é satisfeito trivialmente porque cada user só ganha 1 row aqui).
--
-- assigned_by=NULL sinaliza "backfill de migration". Não referenciamos
-- um user real pra manter idempotência entre tenants heterogêneos.
INSERT INTO sales_unit_members (user_id, unit_id, tenant_id, role, is_primary, assigned_by)
SELECT
  u.id,
  su.id,
  u.tenant_id,
  CASE
    WHEN u.role::text IN ('ADMIN', 'DIRETOR_COMERCIAL', 'DIRETOR_OPERACOES', 'DIRETOR_FINANCEIRO', 'GESTOR')
      THEN 'MANAGER'::"UnitMemberRole"
    ELSE 'MEMBER'::"UnitMemberRole"
  END,
  true,
  NULL
FROM users u
JOIN sales_units su
  ON su.tenant_id = u.tenant_id
 AND su.deleted_at IS NULL
WHERE u.active = true
  AND u.deleted_at IS NULL
  AND u.tenant_id IS NOT NULL
  AND u.role IS NOT NULL
ON CONFLICT (user_id, unit_id) DO NOTHING;
