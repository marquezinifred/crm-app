-- Sprint 9: tabela de jobs de importação

CREATE TYPE "ImportEntity" AS ENUM ('COMPANY', 'CONTACT', 'OPPORTUNITY', 'USER');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PARSING', 'MAPPED', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "ImportDedupStrategy" AS ENUM ('IGNORE_DUPLICATES', 'UPDATE_EXISTING', 'CREATE_NEW');

CREATE TABLE import_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity          "ImportEntity" NOT NULL,
  status          "ImportStatus" NOT NULL DEFAULT 'PENDING',
  dedup_strategy  "ImportDedupStrategy" NOT NULL DEFAULT 'IGNORE_DUPLICATES',
  file_name       TEXT NOT NULL,
  file_bytes      BYTEA NOT NULL,
  mapping_json    JSONB,
  headers_json    JSONB,
  preview_json    JSONB,
  result_json     JSONB,
  total_rows      INT NOT NULL DEFAULT 0,
  processed_rows  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  finished_at     TIMESTAMP(3),
  error_message   TEXT,
  deleted_at      TIMESTAMP(3)
);

CREATE INDEX import_jobs_tenant_status_idx
  ON import_jobs(tenant_id, status, created_at DESC);

SELECT enable_tenant_rls('import_jobs');
