-- Sprint 15B — Tenant Health Score

CREATE TABLE tenant_health_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date                    DATE NOT NULL,
  signal_logins           INT,
  signal_opps_created     INT,
  signal_features_used    INT,
  signal_nps              INT,
  signal_open_tickets     INT,
  signal_trial_progress   INT,
  signal_evaluations      INT,
  signal_resource_usage   INT,
  health_score            INT NOT NULL,
  bucket                  TEXT NOT NULL CHECK (bucket IN ('GREEN','YELLOW','RED')),
  reasons                 JSONB
);
CREATE UNIQUE INDEX tenant_health_unique_idx ON tenant_health_snapshots (tenant_id, date);
CREATE INDEX tenant_health_date_idx ON tenant_health_snapshots (date DESC);
CREATE INDEX tenant_health_bucket_idx ON tenant_health_snapshots (bucket);

SELECT enable_tenant_rls('tenant_health_snapshots');
