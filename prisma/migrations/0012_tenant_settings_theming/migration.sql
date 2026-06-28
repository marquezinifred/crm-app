-- Sprint 10.5 — White-Label Theming
-- tabela tenant_settings 1:1 com tenants

CREATE TYPE "PoweredByMode" AS ENUM ('VISIBLE', 'SUBTLE', 'HIDDEN');

CREATE TABLE tenant_settings (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  theme_config     JSONB NOT NULL,
  powered_by       "PoweredByMode" NOT NULL DEFAULT 'VISIBLE',
  wcag_overrides   JSONB NOT NULL DEFAULT '[]'::jsonb,
  theming_enabled  BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_by       UUID
);

-- RLS
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_select ON tenant_settings FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_settings_insert ON tenant_settings FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_settings_update ON tenant_settings FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_settings_delete ON tenant_settings FOR DELETE
  USING (tenant_id = current_tenant_id());

-- Backfill: cria tenant_settings com defaults Venzo pra cada tenant existente
INSERT INTO tenant_settings (tenant_id, theme_config, powered_by)
SELECT id,
  jsonb_build_object(
    'primaryColor', '#7C3AED',
    'primaryDark', '#3B1F6A',
    'primaryLight', '#C084FC',
    'accentColor', '#F5A623',
    'fontFamily', 'Plus Jakarta Sans',
    'logoUrl', NULL
  ),
  CASE
    WHEN plan = 'ENTERPRISE' THEN 'HIDDEN'::"PoweredByMode"
    WHEN plan = 'PRO' THEN 'SUBTLE'::"PoweredByMode"
    ELSE 'VISIBLE'::"PoweredByMode"
  END
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
