-- =====================================================================
-- Migration 0034 — Sprint 15H Bloco A (chip 1a): Reconcile de Approvals
-- (P-77) — fundação de dados.
-- =====================================================================
-- ⚠️ NUMERAÇÃO: a spec §3.2 escreve "0033", mas o housekeeping P-83
-- (0033_users_email_partial_unique) reivindicou o 0033 e já está em prod
-- (2026-08-03). Última migration no disco = 0033 → esta é a 0034
-- (ver banner de renumeração no topo de docs/Sprint_15H_Metas_e_Approvals.md).
--
-- Approvals persistem `approver_id` fixo no momento da criação. Quando
-- role/rule/user muda, a approval fica "órfã" — o novo approver correto
-- não a vê em /approvals e o antigo ainda a vê. Este chip cria a fundação
-- para o worker daily reconcile (Caminho A1 da spec §3.1) detectar e marcar
-- essas approvals com status='ORPHANED'.
--
-- Escopo deste chip: SÓ schema + enum + FK + índice. Service + worker vêm
-- nos arquivos TS deste mesmo chip; router + UI /admin/approvals-orphaned
-- ficam no chip 2a (spec §7). A tabela `approvals` já existe (Sprint 8) e
-- já tem RLS (0002_rls) — esta migration só a ALTERa; nenhuma tabela nova,
-- logo nenhum bloco RLS aqui.
--
-- Padrões aplicados:
--   - Enum: recriação RENAME_old → CREATE new → cast coluna → DROP old
--     (pattern migration-pitfalls #1, idêntico a 0029). `approvals.status`
--     é a ÚNICA coluna que usa ApprovalStatus. Preferido a `ALTER TYPE
--     ADD VALUE` porque a recriação deixa TODOS os valores (incl. ORPHANED)
--     utilizáveis na MESMA transação da migration — sem a restrição do
--     ADD VALUE de não usar o valor novo antes do commit.
--   - FK applicable_rule_id → approval_rules(id) ON DELETE SET NULL. Rules
--     usam soft delete (deleted_at), então o id normalmente PERMANECE
--     apontando pra rule soft-deletada — o reconcile lê `deleted_at`/`enabled`
--     da rule pra decidir. O SET NULL só dispara em hard delete (raro).
--   - Índice parcial `WHERE status = 'PENDING'` (Prisma não expressa partial
--     index declarativamente — SQL é a fonte da verdade, como 0026/0033).
--
-- Backfill: applicable_rule_id fica NULL nas approvals existentes. O mapeamento
-- retroativo é ambíguo (approvals não persistem qual rule casou; múltiplas
-- rules podem mirar o mesmo role/approver). A spec §3.2 autoriza deixar NULL.
-- O reconcile trata `applicable_rule_id IS NULL` como "sem snapshot → PULA"
-- (fail-safe: NÃO orfana approvals legadas), NÃO como "rule deletada".
--
-- Rollback plan (manual, se necessário):
--   1. APPROVAL_RECONCILE_ENABLED=false no runtime → worker inerte.
--   2. UPDATE approvals SET status='PENDING', orphaned_at=NULL,
--        orphaned_reason=NULL WHERE status='ORPHANED';  -- reverte marcações
--   3. ALTER TABLE approvals DROP COLUMN applicable_rule_id,
--        DROP COLUMN orphaned_at, DROP COLUMN orphaned_reason;
--   4. (enum) recriar ApprovalStatus sem ORPHANED pelo mesmo pattern.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ApprovalStatus ganha ORPHANED (recriação — pattern migration-pitfalls #1)
-- ---------------------------------------------------------------------
ALTER TYPE "ApprovalStatus" RENAME TO "ApprovalStatus_old";

CREATE TYPE "ApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'ORPHANED'
);

ALTER TABLE approvals
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE "ApprovalStatus" USING status::text::"ApprovalStatus",
  ALTER COLUMN status SET DEFAULT 'PENDING';

DROP TYPE "ApprovalStatus_old";

-- ---------------------------------------------------------------------
-- 2. Colunas de reconcile em approvals
-- ---------------------------------------------------------------------
ALTER TABLE approvals
  ADD COLUMN applicable_rule_id UUID,
  ADD COLUMN orphaned_at        TIMESTAMPTZ,
  ADD COLUMN orphaned_reason    TEXT;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_applicable_rule_id_fkey
  FOREIGN KEY (applicable_rule_id) REFERENCES approval_rules(id) ON DELETE SET NULL;

COMMENT ON COLUMN approvals.applicable_rule_id IS
  'Sprint 15H (P-77) — snapshot da ApprovalRule que gerou esta approval. NULL em approvals legadas (sem backfill) → reconcile PULA. Rules usam soft delete, então o id normalmente sobrevive à remoção da rule.';
COMMENT ON COLUMN approvals.orphaned_reason IS
  'rule_deleted | rule_disabled | approver_role_no_longer_matches_rule | approver_permission_revoked | approver_inactive — motivo da orfandade (preenchido pelo worker reconcile).';

-- ---------------------------------------------------------------------
-- 3. Índice parcial pro reconcile listar PENDING por tenant rápido
-- ---------------------------------------------------------------------
CREATE INDEX approvals_pending_reconcile_idx
  ON approvals (tenant_id)
  WHERE status = 'PENDING';

COMMENT ON INDEX approvals_pending_reconcile_idx IS
  'Sprint 15H — acelera a varredura diária do worker approvals-reconcile (WHERE status=PENDING por tenant).';
