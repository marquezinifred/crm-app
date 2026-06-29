-- Sprint 11 — LGPD + Marco Civil + logs imutáveis

CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS','CORRECTION','DELETION','PORTABILITY','OBJECTION');
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','REJECTED');
CREATE TYPE "PolicyDocument" AS ENUM ('PRIVACY_POLICY','TERMS_OF_USE');

CREATE TABLE data_subject_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_type     "DataSubjectRequestType" NOT NULL,
  status           "DataSubjectRequestStatus" NOT NULL DEFAULT 'PENDING',
  subject_email    CITEXT NOT NULL,
  subject_name     TEXT,
  description      TEXT,
  submitted_at     TIMESTAMP(3) NOT NULL DEFAULT now(),
  due_at           TIMESTAMP(3) NOT NULL,
  completed_at     TIMESTAMP(3),
  export_file_key  TEXT,
  rejection_reason TEXT,
  processed_by_id  UUID,
  ip               TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMP(3)
);
CREATE INDEX data_subject_requests_tenant_status_due_idx
  ON data_subject_requests (tenant_id, status, due_at);
CREATE INDEX data_subject_requests_tenant_email_idx
  ON data_subject_requests (tenant_id, subject_email);

-- RLS padrão
SELECT enable_tenant_rls('data_subject_requests');

-- ----- policy_acceptances (Marco Civil) -----
CREATE TABLE policy_acceptances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID,
  document    "PolicyDocument" NOT NULL,
  version     TEXT NOT NULL,
  accepted_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX policy_acceptances_tenant_user_doc_idx
  ON policy_acceptances (tenant_id, user_id, document);

-- Imutável: SELECT/INSERT por tenant, sem UPDATE nem DELETE
ALTER TABLE policy_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_acceptances_select ON policy_acceptances FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY policy_acceptances_insert ON policy_acceptances FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
-- DELIBERADAMENTE sem policy de UPDATE nem DELETE — registros imutáveis.

-- ----- connection_logs (Marco Civil Art. 15 — WORM) -----
CREATE TABLE connection_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id       UUID,
  clerk_user_id TEXT,
  ip            TEXT,
  user_agent    TEXT,
  path          TEXT,
  duration_ms   INTEGER,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX connection_logs_tenant_created_idx
  ON connection_logs (tenant_id, created_at DESC);
CREATE INDEX connection_logs_clerk_created_idx
  ON connection_logs (clerk_user_id, created_at DESC);

-- RLS append-only: leitura por tenant; insert por tenant ou NULL (visitante anônimo)
ALTER TABLE connection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY connection_logs_select ON connection_logs FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY connection_logs_insert ON connection_logs FOR INSERT
  WITH CHECK (true); -- insert público (middleware grava antes do tenant_id estar setado)
-- Sem UPDATE/DELETE.
