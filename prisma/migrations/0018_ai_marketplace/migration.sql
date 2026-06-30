-- Sprint 15B — AI Marketplace

CREATE TYPE "AiFeatureCategory" AS ENUM ('SUMMARIZATION','SCORING','SEARCH','CLASSIFICATION','GENERATION','EXTRACTION');
CREATE TYPE "AiFeatureStatus" AS ENUM ('DISABLED','INCLUDED','ADDON_ACTIVE');

CREATE TABLE ai_features (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT UNIQUE NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT NOT NULL,
  category                 "AiFeatureCategory" NOT NULL,
  default_inclusion        JSONB NOT NULL,
  addon_price_brl_monthly  NUMERIC(10,2),
  addon_price_brl_per_use  NUMERIC(10,4),
  default_provider         TEXT NOT NULL,
  default_model            TEXT NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE tenant_ai_features (
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_id             UUID NOT NULL REFERENCES ai_features(id) ON DELETE CASCADE,
  status                 "AiFeatureStatus" NOT NULL,
  addon_activated_at     TIMESTAMP(3),
  addon_deactivated_at   TIMESTAMP(3),
  enabled_by             UUID,
  notes                  TEXT,
  PRIMARY KEY (tenant_id, feature_id)
);
CREATE INDEX tenant_ai_features_status_idx ON tenant_ai_features (tenant_id, status);

-- RLS: tenant_ai_features tenant-scoped; ai_features global (Platform managed)
SELECT enable_tenant_rls('tenant_ai_features');

-- Seed do catálogo inicial (5 features já operacionais)
INSERT INTO ai_features (code, name, description, category, default_inclusion, addon_price_brl_monthly, default_provider, default_model) VALUES
  ('communication-summary',
   'Resumo de comunicações',
   'Cole um e-mail ou WhatsApp; a IA gera resumo estruturado em 4 blocos + tarefas.',
   'SUMMARIZATION',
   '{"TRIAL":"included","STARTER":"disabled","PRO":"included","ENTERPRISE":"included"}',
   89.00,
   'anthropic', 'claude-haiku-4-5-20251001'),
  ('semantic-search',
   'Busca semântica',
   'Busca por significado no histórico de comunicações (não só keyword).',
   'SEARCH',
   '{"TRIAL":"included","STARTER":"disabled","PRO":"addon","ENTERPRISE":"included"}',
   149.00,
   'openai', 'text-embedding-3-small'),
  ('proposal-version-diff',
   'Comparador de versões',
   'IA gera resumo de diferenças entre duas versões de proposta ou contrato.',
   'EXTRACTION',
   '{"TRIAL":"included","STARTER":"disabled","PRO":"included","ENTERPRISE":"included"}',
   119.00,
   'anthropic', 'claude-sonnet-4-6'),
  ('email-routing',
   'Roteamento de e-mail inbound',
   'IA decide qual oportunidade vincular ao e-mail recebido.',
   'CLASSIFICATION',
   '{"TRIAL":"included","STARTER":"disabled","PRO":"included","ENTERPRISE":"included"}',
   79.00,
   'anthropic', 'claude-haiku-4-5-20251001'),
  ('conversion-rate-suggestion',
   'Sugestão de taxas de conversão',
   'IA sugere taxas de conversão por estágio baseado em histórico ou benchmark.',
   'GENERATION',
   '{"TRIAL":"included","STARTER":"disabled","PRO":"included","ENTERPRISE":"included"}',
   59.00,
   'anthropic', 'claude-haiku-4-5-20251001');
