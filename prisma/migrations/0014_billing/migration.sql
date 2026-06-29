-- Sprint 12 — Billing schema

CREATE TYPE "BillingEventType" AS ENUM ('CHECKOUT_COMPLETED','SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED','SUBSCRIPTION_CANCELED','INVOICE_PAID','INVOICE_FAILED','TRIAL_WILL_END');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING','ACTIVE','PAST_DUE','CANCELED','INCOMPLETE');

ALTER TABLE tenants
  ADD COLUMN stripe_customer_id      TEXT UNIQUE,
  ADD COLUMN stripe_subscription_id  TEXT UNIQUE,
  ADD COLUMN subscription_status     "SubscriptionStatus",
  ADD COLUMN current_period_end      TIMESTAMP(3),
  ADD COLUMN trial_ends_at           TIMESTAMP(3);

CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  type            "BillingEventType" NOT NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  processed_at    TIMESTAMP(3) NOT NULL DEFAULT now(),
  error           TEXT
);
CREATE INDEX billing_events_tenant_processed_idx ON billing_events (tenant_id, processed_at DESC);

-- billing_events: leitura por tenant ou sistema (sem tenant_id setado em failed webhooks).
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_events_select ON billing_events FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY billing_events_insert ON billing_events FOR INSERT
  WITH CHECK (true);
-- Sem UPDATE/DELETE — log imutável.

CREATE TABLE usage_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  captured_at         TIMESTAMP(3) NOT NULL DEFAULT now(),
  user_count          INTEGER NOT NULL DEFAULT 0,
  company_count       INTEGER NOT NULL DEFAULT 0,
  contact_count       INTEGER NOT NULL DEFAULT 0,
  opportunity_count   INTEGER NOT NULL DEFAULT 0,
  storage_bytes       BIGINT  NOT NULL DEFAULT 0,
  ai_tokens_month     INTEGER NOT NULL DEFAULT 0,
  ai_cost_cents_month INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX usage_snapshots_tenant_captured_idx ON usage_snapshots (tenant_id, captured_at DESC);
SELECT enable_tenant_rls('usage_snapshots');

-- Backfill: tenants TRIAL ganham trialEndsAt = created_at + 14 dias.
UPDATE tenants
   SET trial_ends_at = created_at + INTERVAL '14 days'
 WHERE plan = 'TRIAL';
