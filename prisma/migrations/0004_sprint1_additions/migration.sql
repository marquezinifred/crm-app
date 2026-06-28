-- =====================================================================
-- Sprint 1 — RLS para tabelas adicionais introduzidas no schema atualizado
--
-- Refazendo o 0001_init para incluir os enums/colunas novos, esta migração
-- só precisa cobrir o RLS das duas tabelas novas:
--   - approval_rules
--   - consent_logs
--
-- A função enable_tenant_rls() foi criada na 0002_rls e é reutilizada.
-- consent_logs tem tenant_id NULLABLE (consentimentos pré-onboarding), então
-- usa uma policy customizada que aceita NULL ou bate com o tenant atual.
-- =====================================================================

-- approval_rules — padrão completo, tenant_id obrigatório
SELECT enable_tenant_rls('approval_rules');

-- consent_logs — policy customizada porque tenant_id é opcional
ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY consent_isolation_select ON consent_logs FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- INSERT é permissivo: o cookie banner pode rodar antes do tenant estar
-- definido (visitante anônimo). Backend valida o tenant manualmente.
CREATE POLICY consent_insert_open ON consent_logs FOR INSERT
  WITH CHECK (true);

-- Sem policy de UPDATE/DELETE — ConsentLog é imutável (auditoria legal).
