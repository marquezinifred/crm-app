-- =====================================================================
-- Row Level Security (RLS) — isolamento de tenant em todas as tabelas
--
-- Como funciona:
--   1. A aplicação seta `SET LOCAL app.tenant_id = '<uuid>'` no início
--      de cada transação (feito pela Prisma extension em src/server/db/client.ts)
--   2. Toda policy compara tenant_id com current_setting('app.tenant_id', true)
--   3. O parâmetro `true` faz current_setting retornar NULL se não setado —
--      isso resulta em policies que NEGAM acesso quando não há tenant ativo
--   4. FORCE ROW LEVEL SECURITY garante que nem o owner da tabela escapa
--      (relevante quando connection string usa role com BYPASSRLS desabilitado)
--
-- Bypass para administração (seed, migrations, jobs sistêmicos):
--   Usar role Postgres com BYPASSRLS (ex: o owner da migração) OU
--   conectar como superuser. Em código, evitar.
--
-- Para a tabela `tenants` (não tem coluna tenant_id):
--   A policy compara id::text com current_setting('app.tenant_id', true)
--   Isso permite que cada tenant leia apenas o próprio registro.
-- =====================================================================

-- Função utilitária para reduzir boilerplate
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

-- Função para macro de policy padrão tenant_id
CREATE OR REPLACE FUNCTION enable_tenant_rls(target_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target_table);

  EXECUTE format(
    'CREATE POLICY tenant_isolation_select ON %s FOR SELECT
       USING (tenant_id = current_tenant_id())',
    target_table
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_insert ON %s FOR INSERT
       WITH CHECK (tenant_id = current_tenant_id())',
    target_table
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_update ON %s FOR UPDATE
       USING (tenant_id = current_tenant_id())
       WITH CHECK (tenant_id = current_tenant_id())',
    target_table
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_delete ON %s FOR DELETE
       USING (tenant_id = current_tenant_id())',
    target_table
  );
END;
$$;

-- ---------------------------------------------------------------------
-- Tenants — policy especial (compara id, não tenant_id)
-- ---------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_self_select ON tenants FOR SELECT
  USING (id = current_tenant_id());

CREATE POLICY tenant_self_update ON tenants FOR UPDATE
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- INSERT e DELETE em tenants são restritos: somente bypass (super_admin global)
-- nenhuma policy de INSERT/DELETE é criada propositalmente.

-- ---------------------------------------------------------------------
-- Demais tabelas — policy padrão por tenant_id
-- ---------------------------------------------------------------------
SELECT enable_tenant_rls('users');
SELECT enable_tenant_rls('user_access_logs');
SELECT enable_tenant_rls('territories');
SELECT enable_tenant_rls('segments');
SELECT enable_tenant_rls('companies');
SELECT enable_tenant_rls('contacts');
SELECT enable_tenant_rls('important_dates');
SELECT enable_tenant_rls('products');
SELECT enable_tenant_rls('opportunities');
SELECT enable_tenant_rls('opportunity_team');
SELECT enable_tenant_rls('opportunity_stage_history');
SELECT enable_tenant_rls('activities');
SELECT enable_tenant_rls('tasks');
SELECT enable_tenant_rls('proposals');
SELECT enable_tenant_rls('proposal_versions');
SELECT enable_tenant_rls('approvals');
SELECT enable_tenant_rls('contracts');
SELECT enable_tenant_rls('contract_installments');
SELECT enable_tenant_rls('partner_links');
SELECT enable_tenant_rls('partner_tc_acceptances');
SELECT enable_tenant_rls('partner_engagements');
SELECT enable_tenant_rls('documents');
SELECT enable_tenant_rls('document_versions');
SELECT enable_tenant_rls('ai_usage_logs');
SELECT enable_tenant_rls('audit_logs');
SELECT enable_tenant_rls('alert_logs');
SELECT enable_tenant_rls('embeddings');
