-- Sprint 15F — IA Multi-Provider por Feature + Fallback
--
-- Nota: a spec chama esta migration de 0028; renumeramos para 0027 pois
-- 0026 já ocupou o slot com o fix clerk_id_per_scope.

-- 1. Converter default_provider de TEXT → AIProvider enum
--    Seed do 0018 populou com strings 'anthropic'/'openai' — normalizamos
--    pra upper case ANTES do cast (o enum é uppercase).
UPDATE ai_features SET default_provider = upper(default_provider);

ALTER TABLE ai_features
  ALTER COLUMN default_provider TYPE "AIProvider"
  USING default_provider::"AIProvider";

-- 2. Colunas de override + fallback + alerta em tenant_ai_features
ALTER TABLE tenant_ai_features
  ADD COLUMN provider_override           "AIProvider",
  ADD COLUMN model_override              TEXT,
  ADD COLUMN api_key_encrypted           TEXT,
  ADD COLUMN fallback_provider           "AIProvider",
  ADD COLUMN fallback_model              TEXT,
  ADD COLUMN fallback_api_key_encrypted  TEXT,
  ADD COLUMN cost_alert_brl_monthly      DECIMAL(10, 2),
  ADD COLUMN updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Índice pra query de resolução (feature-gate + resolveAiConfig)
CREATE INDEX IF NOT EXISTS idx_tenant_ai_features_lookup
  ON tenant_ai_features (tenant_id, feature_id)
  WHERE status IN ('INCLUDED', 'ADDON_ACTIVE');

COMMENT ON COLUMN tenant_ai_features.provider_override IS
  'Override do provider por feature — NULL herda de ai_features.default_provider';
COMMENT ON COLUMN tenant_ai_features.fallback_provider IS
  'Provider de fallback quando primary falha (5xx / rate limit / credit low)';
COMMENT ON COLUMN tenant_ai_features.api_key_encrypted IS
  'Chave criptografada específica por feature — NULL herda tenants.ai_api_key_encrypted quando provider bate';
