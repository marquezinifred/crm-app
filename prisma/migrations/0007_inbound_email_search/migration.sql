-- Sprint 6: e-mail inbound + busca semântica

ALTER TABLE tenants ADD COLUMN inbound_email_slug CITEXT UNIQUE;

CREATE TYPE "IncomingEmailStatus" AS ENUM ('PENDING', 'LINKED', 'REJECTED');

CREATE TABLE incoming_emails (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_email            CITEXT NOT NULL,
  to_addresses          TEXT[] NOT NULL,
  cc_addresses          TEXT[] NOT NULL DEFAULT '{}',
  subject               TEXT,
  body_text             TEXT,
  body_html             TEXT,
  received_at           TIMESTAMP(3) NOT NULL DEFAULT now(),
  raw_payload           JSONB NOT NULL,
  status                "IncomingEmailStatus" NOT NULL DEFAULT 'PENDING',
  linked_activity_id    UUID,
  linked_opportunity_id UUID,
  link_confidence       DECIMAL(5,4),
  link_method           TEXT,
  linked_at             TIMESTAMP(3),
  linked_by_id          UUID,
  rejection_reason      TEXT,
  created_at            TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP(3) NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMP(3)
);

CREATE INDEX incoming_emails_tenant_status_received_idx
  ON incoming_emails (tenant_id, status, received_at DESC);

-- Full-text search PT-BR (fallback quando OPENAI_API_KEY ausente)
-- Funciona em activities.content + incoming_emails.body_text
CREATE INDEX activities_fts_pt_idx
  ON activities USING GIN (to_tsvector('portuguese', coalesce(title, '') || ' ' || content));

CREATE INDEX incoming_emails_fts_pt_idx
  ON incoming_emails USING GIN (to_tsvector('portuguese', coalesce(subject, '') || ' ' || coalesce(body_text, '')));

-- RLS para a nova tabela
SELECT enable_tenant_rls('incoming_emails');
