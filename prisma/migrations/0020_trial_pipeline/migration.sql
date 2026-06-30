-- Sprint 15B — Trial Pipeline

ALTER TABLE tenants
  ADD COLUMN trial_source              TEXT,
  ADD COLUMN trial_extended_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN trial_conversion_at       TIMESTAMP(3),
  ADD COLUMN trial_cancellation_at     TIMESTAMP(3),
  ADD COLUMN trial_cancellation_reason TEXT;

CREATE TABLE trial_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  metadata   JSONB
);
CREATE INDEX trial_events_tenant_idx ON trial_events (tenant_id, created_at DESC);
CREATE INDEX trial_events_type_idx ON trial_events (event_type);

SELECT enable_tenant_rls('trial_events');
