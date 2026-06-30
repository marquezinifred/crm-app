-- Sprint 15B — AI Operations Center

CREATE TYPE "AiAnomalyType" AS ENUM ('TOKEN_SPIKE','REQUEST_SPIKE','LIMIT_REACHED');

CREATE TABLE tenant_ai_limits (
  tenant_id                    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_token_limit          BIGINT,
  daily_request_limit          INT,
  pinned_model_haiku           TEXT,
  pinned_model_sonnet          TEXT,
  anomaly_threshold_multiplier NUMERIC(5,2) NOT NULL DEFAULT 3.0,
  updated_by                   UUID,
  updated_at                   TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage_daily (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  date          DATE NOT NULL,
  request_count INT  NOT NULL DEFAULT 0,
  tokens_input  BIGINT NOT NULL DEFAULT 0,
  tokens_output BIGINT NOT NULL DEFAULT 0,
  cost_brl      NUMERIC(12,4) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ai_usage_daily_unique_idx ON ai_usage_daily (tenant_id, provider, model, date);
CREATE INDEX ai_usage_daily_tenant_date_idx ON ai_usage_daily (tenant_id, date DESC);

CREATE TABLE ai_anomaly_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type              "AiAnomalyType" NOT NULL,
  detected_at       TIMESTAMP(3) NOT NULL DEFAULT now(),
  details           JSONB NOT NULL,
  acknowledged_at   TIMESTAMP(3),
  acknowledged_by   UUID
);
CREATE INDEX ai_anomaly_alerts_tenant_idx ON ai_anomaly_alerts (tenant_id, detected_at DESC);
CREATE INDEX ai_anomaly_alerts_ack_idx ON ai_anomaly_alerts (acknowledged_at);

-- RLS padrão tenant-scoped
SELECT enable_tenant_rls('tenant_ai_limits');
SELECT enable_tenant_rls('ai_usage_daily');
SELECT enable_tenant_rls('ai_anomaly_alerts');
