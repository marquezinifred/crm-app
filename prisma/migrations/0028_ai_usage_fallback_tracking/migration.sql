-- Sprint 15F — logging enriquecido de fallback em ai_usage_logs.
--
-- used_fallback:       true quando a chamada usou o provider secundário
--                      (permite calcular fallback rate por feature).
-- configured_provider: provider que ERA pra ser usado (primary configurado).
--                      Fica NULL em logs antigos; novos logs sempre populam.

ALTER TABLE ai_usage_logs
  ADD COLUMN used_fallback       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN configured_provider "AIProvider";

COMMENT ON COLUMN ai_usage_logs.used_fallback IS
  'true quando o fallback secundário foi usado. Calcular fallback rate: count(*) filter (where used_fallback) / count(*).';
COMMENT ON COLUMN ai_usage_logs.configured_provider IS
  'Provider primary configurado no momento da chamada. NULL em logs pré-Sprint 15F.';
