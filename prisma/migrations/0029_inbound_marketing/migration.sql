-- Sprint 15D — Inbound Marketing Pipeline
--
-- Entrega:
--  1. Novo role GESTOR_INBOUND (temporário até Sprint 15E migrar pra permission)
--  2. Campos is_inbound/inbound_* em opportunities pra rastreio de origem
--  3. Tabela inbound_capture_config 1:1 com tenant (email/webhook/notif)
--  4. Tabela inbound_leads_rejected pra revisão manual (confidence baixa)
--  5. Feature 'inbound-lead-parser' seedada em ai_features
--
-- Pattern: RENAME UserRole_old → CREATE new → cast todas colunas → DROP old.

-- ═════════════════════════════════════════════════════════════════
-- 1. UserRole ganha GESTOR_INBOUND
-- ═════════════════════════════════════════════════════════════════

ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'GESTOR_INBOUND',
  'ANALISTA',
  'PARCEIRO'
);

-- 1a. Cast users.role — todos os valores atuais existem no novo enum
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole",
  ALTER COLUMN role SET DEFAULT 'ANALISTA';

-- 1b. Cast approval_rules.approver_roles (array de UserRole)
ALTER TABLE approval_rules
  ALTER COLUMN approver_roles TYPE "UserRole"[]
  USING approver_roles::text[]::"UserRole"[];

DROP TYPE "UserRole_old";

-- ═════════════════════════════════════════════════════════════════
-- 2. opportunities ganha rastreio de origem inbound
-- ═════════════════════════════════════════════════════════════════

ALTER TABLE opportunities
  ADD COLUMN is_inbound            BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN inbound_source        TEXT,
  ADD COLUMN inbound_form_id       TEXT,
  ADD COLUMN inbound_payload       JSONB,
  ADD COLUMN inbound_received_at   TIMESTAMPTZ,
  ADD COLUMN inbound_parsed_by     TEXT,
  ADD COLUMN inbound_confidence    NUMERIC(3,2);

COMMENT ON COLUMN opportunities.is_inbound IS
  'true quando a opp veio de captura automática (site, form, webhook). Distingue da entrada manual do vendedor.';
COMMENT ON COLUMN opportunities.inbound_source IS
  'email | webhook_custom | typeform | rd_station | manual — quem originou.';
COMMENT ON COLUMN opportunities.inbound_parsed_by IS
  'regex:<matcher> | ai:claude-haiku-4-5 | manual — quem transformou o payload cru em campos.';

-- Owner_id passa a ser nullable pra suportar leads não-atribuídos na fila.
-- Convém: só is_inbound=true pode ter owner_id NULL; opps manuais sempre têm dono.
ALTER TABLE opportunities
  ALTER COLUMN owner_id DROP NOT NULL;

-- Índice pra fila de prospects (query base: is_inbound AND owner_id IS NULL AND stage='PROSPECT')
CREATE INDEX opportunities_inbound_queue_idx
  ON opportunities (tenant_id, inbound_received_at DESC NULLS LAST)
  WHERE is_inbound = true AND owner_id IS NULL AND deleted_at IS NULL;

-- ═════════════════════════════════════════════════════════════════
-- 3. inbound_capture_config — 1:1 com tenant
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE inbound_capture_config (
  tenant_id                UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Email channel
  email_enabled            BOOLEAN NOT NULL DEFAULT true,

  -- Webhook channel
  webhook_enabled          BOOLEAN NOT NULL DEFAULT true,
  webhook_secret           TEXT,

  -- Notification config
  notify_on_arrival        BOOLEAN NOT NULL DEFAULT true,
  notify_user_ids          UUID[]  NOT NULL DEFAULT '{}',

  -- Anti-spam
  blacklist_domains        TEXT[]  NOT NULL DEFAULT '{}',

  -- Auto-assign (futura extensão)
  auto_assign_by_territory BOOLEAN NOT NULL DEFAULT false,

  -- Audit
  updated_by_id            UUID    REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice único no webhook_secret pra lookup rápido no endpoint público.
-- Partial UNIQUE (webhook_secret IS NOT NULL) — 2 tenants sem secret não colidem.
CREATE UNIQUE INDEX inbound_capture_config_webhook_secret_uq
  ON inbound_capture_config (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- RLS padrão: linha visível apenas quando tenant_id = current_tenant_id()
SELECT enable_tenant_rls('inbound_capture_config');

COMMENT ON TABLE inbound_capture_config IS
  'Config por tenant dos canais de captura de leads inbound (email dedicado + webhook custom + notificações).';

-- ═════════════════════════════════════════════════════════════════
-- 4. inbound_leads_rejected — leads com confidence baixa pra revisão
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE inbound_leads_rejected (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,           -- 'email' | 'webhook_custom'
  raw_payload   JSONB NOT NULL,          -- payload cru (string vira {"text": ...})
  parsed_json   JSONB,                   -- output do parser (nullable se parser deu throw)
  confidence    NUMERIC(3,2),
  reason        TEXT NOT NULL,           -- 'low_confidence' | 'blacklisted_domain' | 'rate_limited' | 'parse_error'
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'discarded' | 'promoted'
);

CREATE INDEX inbound_leads_rejected_tenant_status_idx
  ON inbound_leads_rejected (tenant_id, status, received_at DESC);

SELECT enable_tenant_rls('inbound_leads_rejected');

COMMENT ON TABLE inbound_leads_rejected IS
  'Leads que não viraram opportunity (confidence < 0.4, blacklist, rate limit) — ficam aqui pra revisão manual.';

-- ═════════════════════════════════════════════════════════════════
-- 5. Feature inbound-lead-parser em ai_features
-- ═════════════════════════════════════════════════════════════════

INSERT INTO ai_features (
  code, name, description, category,
  default_inclusion, addon_price_brl_monthly,
  default_provider, default_model
) VALUES (
  'inbound-lead-parser',
  'Extração de leads inbound',
  'IA extrai nome/email/empresa/interesse de emails naturais ou webhooks sem estrutura reconhecível.',
  'EXTRACTION',
  '{"TRIAL":"included","STARTER":"disabled","PRO":"included","ENTERPRISE":"included"}',
  49.00,
  'ANTHROPIC', 'claude-haiku-4-5-20251001'
)
ON CONFLICT (code) DO NOTHING;
