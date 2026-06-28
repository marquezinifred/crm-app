-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DIRETOR_COMERCIAL', 'DIRETOR_FINANCEIRO', 'GESTOR', 'ANALISTA', 'PARCEIRO');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('TRIAL', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('CLIENT', 'PARTNER', 'SUPPLIER', 'OWN');

-- CreateEnum
CREATE TYPE "ContactSeniority" AS ENUM ('PROPRIETARIO', 'DIRETOR', 'GERENTE', 'COORDENADOR', 'ANALISTA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ContactRelationshipType" AS ENUM ('COLABORADOR', 'CLIENTE', 'PARCEIRO', 'FORNECEDOR', 'OUTRO');

-- CreateEnum
CREATE TYPE "WorkArea" AS ENUM ('COMERCIAL', 'MARKETING', 'COMPRAS', 'USUARIO_SERVICOS_PRODUTOS', 'OUTRO');

-- CreateEnum
CREATE TYPE "ContactFunction" AS ENUM ('DIRETOR_ADMINISTRATIVO', 'DIRETOR_OPERACOES', 'GERENTE_RH', 'GERENTE_PROJETOS', 'GERENTE_SERVICOS', 'GERENTE_GERAL', 'CONSULTOR', 'ANALISTA_ADMINISTRATIVO', 'ESPECIALISTA', 'EMPRESA_PARCEIRA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ContactApprovalStatus" AS ENUM ('APPROVED', 'PENDING_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('ALOCACAO', 'PROJETO_ESCOPO_FECHADO', 'PROJETO_SQUAD', 'PRODUTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('PROSPECT', 'LEAD', 'OPORTUNIDADE', 'PROPOSTA', 'NEGOCIACAO', 'ACEITE', 'CONTRATO');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('ACTIVE', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('MANUAL_NOTE', 'SYSTEM_EVENT', 'AI_SUMMARY', 'EMAIL', 'WHATSAPP', 'CALL', 'MEETING', 'STAGE_CHANGE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'DOING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'RENEWED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpportunitySource" AS ENUM ('INDICACAO', 'COLD_CALL', 'CONTATO_DO_CLIENTE', 'PARCEIRO', 'FUNCIONARIO_NAO_COMERCIAL', 'EVENTO', 'INBOUND', 'OUTBOUND', 'OUTRO');

-- CreateEnum
CREATE TYPE "OpportunityLossReason" AS ENUM ('CLIENTE_DESISTIU', 'INADEQUACAO_TECNICA', 'INADEQUACAO_COMERCIAL', 'PRECO', 'PRAZO', 'CONCORRENCIA', 'SEM_BUDGET', 'OUTRO');

-- CreateEnum
CREATE TYPE "ApprovalRuleCriteria" AS ENUM ('UNIVERSAL', 'MIN_MARGIN_BELOW', 'TOTAL_VALUE_ABOVE');

-- CreateEnum
CREATE TYPE "ConsentCategory" AS ENUM ('STRICTLY_NECESSARY', 'FUNCTIONAL', 'ANALYTICS', 'MARKETING');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportantDateEntityType" AS ENUM ('COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "DateType" AS ENUM ('ANIVERSARIO', 'FUNDACAO', 'RENOVACAO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('RELATIONSHIP_DATE', 'PIPELINE_DATE', 'TASK_DUE', 'TASK_OVERDUE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'PERPLEXITY');

-- CreateEnum
CREATE TYPE "PartnerEngagementStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'TRIAL',
    "central_crm_email" TEXT,
    "alert_lead_days" INTEGER[] DEFAULT ARRAY[7, 1]::INTEGER[],
    "task_overdue_days" INTEGER NOT NULL DEFAULT 2,
    "ai_provider" "AIProvider" NOT NULL DEFAULT 'ANTHROPIC',
    "ai_model" TEXT,
    "ai_api_key_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "clerk_id" TEXT,
    "email" CITEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ANALISTA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_access_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "auth_method" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "CompanyType" NOT NULL,
    "razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "cnpj" TEXT,
    "cnae_code" TEXT,
    "cnae_name" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "state" TEXT,
    "city" TEXT,
    "territory_id" UUID,
    "segment_id" UUID,
    "email" CITEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "commission_pct" DECIMAL(6,2),
    "tc_version" TEXT,
    "tc_text" TEXT,
    "partner_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "function" "ContactFunction",
    "seniority" "ContactSeniority",
    "work_area" "WorkArea",
    "specialty" TEXT,
    "relationship_type" "ContactRelationshipType" NOT NULL DEFAULT 'CLIENTE',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "self_registered" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" "ContactApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "important_dates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" "ImportantDateEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "date_type" "DateType" NOT NULL,
    "label" TEXT,
    "date_value" DATE NOT NULL,
    "alert_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "important_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "min_margin_pct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "client_company_id" UUID NOT NULL,
    "client_contact_id" UUID,
    "partner_company_id" UUID,
    "partner_contact_id" UUID,
    "owner_id" UUID NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'PROSPECT',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'ACTIVE',
    "estimated_value" DECIMAL(15,2),
    "closed_value" DECIMAL(15,2),
    "expected_close_date" DATE,
    "actual_close_date" DATE,
    "source" "OpportunitySource",
    "source_detail" TEXT,
    "cancellation_reason" TEXT,
    "loss_reason" "OpportunityLossReason",
    "description" TEXT,
    "commission_pct_override" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_in_team" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "opportunity_team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "from_stage" "OpportunityStage",
    "to_stage" "OpportunityStage" NOT NULL,
    "moved_by_id" UUID NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "author_id" UUID,
    "type" "ActivityType" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "raw_text" TEXT,
    "ai_summary_json" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "assignee_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content_json" JSONB NOT NULL,
    "total_value" DECIMAL(15,2) NOT NULL,
    "margin_pct" DECIMAL(6,2),
    "document_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "proposal_version_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "number" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "nda_signed_at" TIMESTAMP(3),
    "terms_signed_at" TIMESTAMP(3),
    "start_date" DATE,
    "end_date" DATE,
    "total_value" DECIMAL(15,2) NOT NULL,
    "nda_key" TEXT,
    "terms_key" TEXT,
    "contract_key" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_installments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "billing_data_json" JSONB NOT NULL,
    "paid_at" TIMESTAMP(3),
    "invoice_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contract_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_company_id" UUID,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partner_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_tc_acceptances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_company_id" UUID NOT NULL,
    "tc_version" TEXT NOT NULL,
    "accepted_by_name" TEXT NOT NULL,
    "accepted_by_email" CITEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_tc_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_engagements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "partner_company_id" UUID NOT NULL,
    "status" "PartnerEngagementStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partner_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "related_entity_type" TEXT NOT NULL,
    "related_entity_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "current_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "provider" "AIProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "request_type" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "recipient_email" CITEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" "ApprovalRuleCriteria" NOT NULL,
    "threshold_numeric" DECIMAL(15,2),
    "approver_roles" "UserRole"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "subject_email" CITEXT,
    "category" "ConsentCategory" NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "policy_version" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "user_access_logs_tenant_id_user_id_at_idx" ON "user_access_logs"("tenant_id", "user_id", "at");

-- CreateIndex
CREATE INDEX "territories_tenant_id_idx" ON "territories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "territories_tenant_id_name_key" ON "territories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "segments_tenant_id_idx" ON "segments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "segments_tenant_id_name_key" ON "segments"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "companies_tenant_id_type_idx" ON "companies"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "companies_tenant_id_territory_id_idx" ON "companies"("tenant_id", "territory_id");

-- CreateIndex
CREATE INDEX "companies_tenant_id_segment_id_idx" ON "companies"("tenant_id", "segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_cnpj_key" ON "companies"("tenant_id", "cnpj");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_company_id_idx" ON "contacts"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_approval_status_idx" ON "contacts"("tenant_id", "approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_email_key" ON "contacts"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "important_dates_tenant_id_entity_type_entity_id_idx" ON "important_dates"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "important_dates_tenant_id_alert_active_date_value_idx" ON "important_dates"("tenant_id", "alert_active", "date_value");

-- CreateIndex
CREATE INDEX "products_tenant_id_active_idx" ON "products"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_stage_status_idx" ON "opportunities"("tenant_id", "stage", "status");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_owner_id_idx" ON "opportunities"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_client_company_id_idx" ON "opportunities"("tenant_id", "client_company_id");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_partner_company_id_idx" ON "opportunities"("tenant_id", "partner_company_id");

-- CreateIndex
CREATE INDEX "opportunity_team_tenant_id_idx" ON "opportunity_team"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_team_opportunity_id_user_id_key" ON "opportunity_team"("opportunity_id", "user_id");

-- CreateIndex
CREATE INDEX "opportunity_stage_history_tenant_id_opportunity_id_at_idx" ON "opportunity_stage_history"("tenant_id", "opportunity_id", "at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_opportunity_id_occurred_at_idx" ON "activities"("tenant_id", "opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_due_date_idx" ON "tasks"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assignee_id_status_idx" ON "tasks"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "proposals_tenant_id_opportunity_id_idx" ON "proposals"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "proposal_versions_tenant_id_idx" ON "proposal_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposal_id_version_key" ON "proposal_versions"("proposal_id", "version");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_status_idx" ON "approvals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_approver_id_status_idx" ON "approvals"("tenant_id", "approver_id", "status");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_opportunity_id_idx" ON "contracts"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_number_key" ON "contracts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "contract_installments_tenant_id_status_due_date_idx" ON "contract_installments"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "contract_installments_contract_id_number_key" ON "contract_installments"("contract_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_links_token_key" ON "partner_links"("token");

-- CreateIndex
CREATE INDEX "partner_links_tenant_id_idx" ON "partner_links"("tenant_id");

-- CreateIndex
CREATE INDEX "partner_tc_acceptances_tenant_id_partner_company_id_idx" ON "partner_tc_acceptances"("tenant_id", "partner_company_id");

-- CreateIndex
CREATE INDEX "partner_engagements_tenant_id_status_idx" ON "partner_engagements"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_engagements_opportunity_id_partner_company_id_key" ON "partner_engagements"("opportunity_id", "partner_company_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_related_entity_type_related_entity_id_idx" ON "documents"("tenant_id", "related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "document_versions_tenant_id_idx" ON "document_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenant_id_created_at_idx" ON "ai_usage_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenant_id_provider_model_idx" ON "ai_usage_logs"("tenant_id", "provider", "model");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_at_idx" ON "audit_logs"("tenant_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_table_name_record_id_idx" ON "audit_logs"("tenant_id", "table_name", "record_id");

-- CreateIndex
CREATE INDEX "alert_logs_tenant_id_status_scheduled_for_idx" ON "alert_logs"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "alert_logs_tenant_id_type_idx" ON "alert_logs"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "embeddings_tenant_id_source_type_source_id_idx" ON "embeddings"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "approval_rules_tenant_id_enabled_idx" ON "approval_rules"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "consent_logs_tenant_id_user_id_created_at_idx" ON "consent_logs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_logs_subject_email_created_at_idx" ON "consent_logs"("subject_email", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_logs" ADD CONSTRAINT "user_access_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_access_logs" ADD CONSTRAINT "user_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_company_id_fkey" FOREIGN KEY ("client_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_contact_id_fkey" FOREIGN KEY ("client_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_team" ADD CONSTRAINT "opportunity_team_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_team" ADD CONSTRAINT "opportunity_team_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_team" ADD CONSTRAINT "opportunity_team_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_moved_by_id_fkey" FOREIGN KEY ("moved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_installments" ADD CONSTRAINT "contract_installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_installments" ADD CONSTRAINT "contract_installments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_links" ADD CONSTRAINT "partner_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_links" ADD CONSTRAINT "partner_links_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_tc_acceptances" ADD CONSTRAINT "partner_tc_acceptances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_tc_acceptances" ADD CONSTRAINT "partner_tc_acceptances_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_engagements" ADD CONSTRAINT "partner_engagements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_engagements" ADD CONSTRAINT "partner_engagements_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_engagements" ADD CONSTRAINT "partner_engagements_partner_company_id_fkey" FOREIGN KEY ("partner_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_engagements" ADD CONSTRAINT "partner_engagements_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_engagements" ADD CONSTRAINT "partner_engagements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_logs" ADD CONSTRAINT "alert_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

