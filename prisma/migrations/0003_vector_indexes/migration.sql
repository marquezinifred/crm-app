-- =====================================================================
-- Índices de busca vetorial (pgvector)
--
-- HNSW (Hierarchical Navigable Small World) — ANN search rápido em
-- updates frequentes. m=16, ef_construction=64 são valores conservadores
-- adequados para até ~1M vetores; ajustar conforme escala.
--
-- Para busca filtrada por tenant_id, usar query:
--   WHERE tenant_id = $1 ORDER BY vector <=> $2 LIMIT 10
-- O índice HNSW continua sendo usado porque <=> é o operador cosine distance.
-- =====================================================================

CREATE INDEX embeddings_vector_hnsw_idx
  ON embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Índice composto para filtros tenant + source
CREATE INDEX embeddings_tenant_source_idx
  ON embeddings (tenant_id, source_type, source_id)
  WHERE deleted_at IS NULL;

-- =====================================================================
-- Índices parciais para queries comuns que filtram deleted_at IS NULL
-- (soft delete): evita escanear linhas removidas.
-- =====================================================================

CREATE INDEX companies_active_by_tenant_idx
  ON companies (tenant_id, type)
  WHERE deleted_at IS NULL;

CREATE INDEX contacts_active_by_tenant_idx
  ON contacts (tenant_id, company_id)
  WHERE deleted_at IS NULL;

CREATE INDEX opportunities_active_by_stage_idx
  ON opportunities (tenant_id, stage, status)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

CREATE INDEX tasks_pending_by_assignee_idx
  ON tasks (tenant_id, assignee_id, due_date)
  WHERE deleted_at IS NULL AND status IN ('TODO', 'DOING');

-- Índice para o job diário de alertas (queries por data)
CREATE INDEX important_dates_for_alert_idx
  ON important_dates (tenant_id, date_value)
  WHERE deleted_at IS NULL AND alert_active = true;
