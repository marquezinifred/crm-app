-- Sprint 15C — Listas configuráveis pelo admin
-- 3 tabelas novas (Territory e Segment já existem desde Sprint 1).
-- FKs em opportunities/companies/contacts são OPCIONAIS — não quebra
-- o enum OpportunitySource nem o campo position de Contact.

-- ─── lead_sources ───────────────────────────────────────────────────
CREATE TABLE lead_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_by  UUID,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX lead_sources_tenant_name_uq
  ON lead_sources (tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX lead_sources_tenant_active_idx
  ON lead_sources (tenant_id, is_active, position) WHERE deleted_at IS NULL;

ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources FORCE  ROW LEVEL SECURITY;
CREATE POLICY lead_sources_select ON lead_sources FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY lead_sources_insert ON lead_sources FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lead_sources_update ON lead_sources FOR UPDATE
  USING (tenant_id = current_tenant_id());
CREATE POLICY lead_sources_delete ON lead_sources FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ─── industries ─────────────────────────────────────────────────────
CREATE TABLE industries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cnae_prefix TEXT,
  position    INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_by  UUID,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX industries_tenant_name_uq
  ON industries (tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX industries_tenant_active_idx
  ON industries (tenant_id, is_active, position) WHERE deleted_at IS NULL;

ALTER TABLE industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE industries FORCE  ROW LEVEL SECURITY;
CREATE POLICY industries_select ON industries FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY industries_insert ON industries FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY industries_update ON industries FOR UPDATE
  USING (tenant_id = current_tenant_id());
CREATE POLICY industries_delete ON industries FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ─── contact_roles ──────────────────────────────────────────────────
CREATE TABLE contact_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  weight      INT  NOT NULL DEFAULT 1,
  position    INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_by  UUID,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX contact_roles_tenant_name_uq
  ON contact_roles (tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX contact_roles_tenant_active_idx
  ON contact_roles (tenant_id, is_active, position) WHERE deleted_at IS NULL;

ALTER TABLE contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY contact_roles_select ON contact_roles FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY contact_roles_insert ON contact_roles FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY contact_roles_update ON contact_roles FOR UPDATE
  USING (tenant_id = current_tenant_id());
CREATE POLICY contact_roles_delete ON contact_roles FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ─── FKs opcionais nas tabelas-alvo ──────────────────────────────────
ALTER TABLE opportunities
  ADD COLUMN lead_source_id UUID REFERENCES lead_sources(id);
CREATE INDEX opportunities_lead_source_idx
  ON opportunities (tenant_id, lead_source_id) WHERE lead_source_id IS NOT NULL;

ALTER TABLE companies
  ADD COLUMN industry_id UUID REFERENCES industries(id);
CREATE INDEX companies_industry_idx
  ON companies (tenant_id, industry_id) WHERE industry_id IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN contact_role_id UUID REFERENCES contact_roles(id);
CREATE INDEX contacts_contact_role_idx
  ON contacts (tenant_id, contact_role_id) WHERE contact_role_id IS NOT NULL;
