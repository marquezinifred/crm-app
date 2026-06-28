-- Sprint 7: Parceiros (resolução de visibilidade) + Documentos (categoria + templates)

-- 1. User.partnerCompanyId — para usuários PARCEIRO apontarem para a Company
ALTER TABLE users
  ADD COLUMN partner_company_id UUID,
  ADD CONSTRAINT users_partner_company_fk
    FOREIGN KEY (partner_company_id) REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX users_partner_company_idx ON users(tenant_id, partner_company_id)
  WHERE partner_company_id IS NOT NULL;

-- 2. DocumentCategory enum + Document.category
CREATE TYPE "DocumentCategory" AS ENUM (
  'INSTITUCIONAL',
  'PROPOSTA_TECNICA',
  'PROPOSTA_COMERCIAL',
  'ORCAMENTO',
  'CONTRATO',
  'NDA',
  'TERMO_RESPONSABILIDADE',
  'ACEITE_CLIENTE',
  'OUTRO'
);

ALTER TABLE documents
  ADD COLUMN category "DocumentCategory" NOT NULL DEFAULT 'OUTRO';

CREATE INDEX documents_tenant_category_idx ON documents(tenant_id, category);

-- 3. document_templates — biblioteca de templates por categoria por tenant
CREATE TABLE document_templates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category                    "DocumentCategory" NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT,
  current_version_storage_key TEXT,
  current_version_number      INT NOT NULL DEFAULT 1,
  active                      BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMP(3) NOT NULL DEFAULT now(),
  created_by                  UUID,
  updated_by                  UUID,
  deleted_at                  TIMESTAMP(3)
);

CREATE INDEX document_templates_tenant_cat_active_idx
  ON document_templates(tenant_id, category, active);

SELECT enable_tenant_rls('document_templates');
