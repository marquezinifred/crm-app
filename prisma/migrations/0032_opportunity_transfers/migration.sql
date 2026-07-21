-- =====================================================================
-- Migration 0032 — Sprint 15G.5 Fase 1a: Workflow de transferência de
-- oportunidade (chip 1a — fundação)
-- =====================================================================
-- Cria a fundação de dados do workflow de transferência cross-team de
-- responsabilidade de oportunidade (spec docs/Sprint_15G5_Transferencia_
-- Oportunidade.md §4). Arquivo ÚNICO (T11) — 15G.5 reivindica o 0032;
-- Sprint 15H desliza approvals→0033 / metas→0034.
--
-- Este chip é SÓ schema + enum + flag + permission. Service/router/worker/
-- UI ficam nos chips 1b/2a/2b/2c/3. Guard de write na Prisma extension é
-- o chip 2c (Modo A). Aqui a tabela nasce vazia, sem backfill.
--
-- Padrões aplicados:
--   - T1 (race): partial UNIQUE `idx_transfers_active_per_opp` garante no
--     máximo 1 transfer PENDING por opportunity. Segundo request → CONFLICT.
--   - T2 (guard flag): `opportunities.current_transfer_id` marca a opp em
--     transferência. O guard de write que a consome é o chip 2c.
--   - T3 (timeout parametrizável): `tenant_settings.transfer_timeout_hours`
--     default 72h. Worker (chip 2b) auto-expira PENDING vencidas.
--   - RLS: pattern padrão do projeto (`enable_tenant_rls` do 0002_rls) —
--     4 policies granulares + FORCE, via `current_tenant_id()` que lê o GUC
--     `app.tenant_id` setado por `runWithTenant` (SET LOCAL). NÃO uso a
--     policy única do rascunho da spec (`CREATE POLICY tenant_isolation`)
--     pra casar 1:1 com 0031/0002. RLS é 2ª barreira; extension Prisma
--     injeta tenant_id na 1ª (T6).
--   - Convenção: `gen_random_uuid()`, `timestamptz`, `now()` (idênticos a 0031).
--
-- Circular FK (Postgres aceita): opportunities.current_transfer_id →
-- opportunity_transfers.id  E  opportunity_transfers.opportunity_id →
-- opportunities.id. Fluxo de escrita: cria o transfer (opportunity_id
-- aponta pra opp existente) e SÓ DEPOIS seta opp.current_transfer_id.
--
-- Sem soft delete: transfers são registros de estado/evento (como
-- opportunity_stage_history / audit_logs / billing_events). O ciclo de vida
-- é o enum `TransferStatus` (CANCELLED/REJECTED/TIMED_OUT), não `deleted_at`.
--
-- Rollback plan (manual, se necessário):
--   1. `OPPORTUNITY_TRANSFER_ENABLED=false` no runtime → procedures
--      indisponíveis, guard inerte (chips 2a/2c respeitam a flag).
--   2. `ALTER TABLE opportunities DROP COLUMN current_transfer_id;`
--      `ALTER TABLE tenant_settings DROP COLUMN transfer_timeout_hours;`
--      `DROP TABLE opportunity_transfers CASCADE;`
--      `DROP TYPE "TransferStatus";`
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enum TransferStatus — máquina de estado do workflow (T8)
--   PENDING → APPROVED | REJECTED | CANCELLED | TIMED_OUT
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "TransferStatus" AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Tabela opportunity_transfers — 1 row por solicitação de transferência
--   requested_by  = disparador (ancestor na árvore ltree do dono atual)
--   original_owner = dono no momento do disparo (read-only durante pendência)
--   target_manager = destinatário (par/superior do disparador)
--   new_owner      = escolhido no approve pelo destinatário (NULL até APPROVED)
-- ---------------------------------------------------------------------
CREATE TABLE opportunity_transfers (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id      uuid            NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  requested_by_id     uuid            NOT NULL REFERENCES users(id),
  original_owner_id   uuid            NOT NULL REFERENCES users(id),
  target_manager_id   uuid            NOT NULL REFERENCES users(id),
  target_unit_id      uuid            REFERENCES sales_units(id),
  new_owner_id        uuid            REFERENCES users(id),
  status              "TransferStatus" NOT NULL DEFAULT 'PENDING',
  reason              text,
  decision_reason     text,
  decided_by_id       uuid            REFERENCES users(id),
  requested_at        timestamptz     NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  expires_at          timestamptz     NOT NULL,
  created_at          timestamptz     NOT NULL DEFAULT now(),
  updated_at          timestamptz     NOT NULL DEFAULT now()
);

-- Índices PLAIN (declarados no schema.prisma; nomes na convenção default do
-- Prisma pra manter lockstep com `@@index` — evita drift em `migrate dev`).
CREATE INDEX "opportunity_transfers_tenant_id_idx"
  ON opportunity_transfers (tenant_id);
CREATE INDEX "opportunity_transfers_tenant_id_opportunity_id_idx"
  ON opportunity_transfers (tenant_id, opportunity_id);
CREATE INDEX "opportunity_transfers_tenant_id_requested_by_id_idx"
  ON opportunity_transfers (tenant_id, requested_by_id);

-- Índices PARCIAIS (SÓ na migration — Prisma não expressa partial index;
-- mesmo pattern do partial unique de sales_unit_members.is_primary no 0031).
-- Fila do destinatário: PENDING abertas por target_manager (chip 3b)
CREATE INDEX idx_transfers_pending_target
  ON opportunity_transfers (target_manager_id, status) WHERE status = 'PENDING';

-- Varredura do worker de timeout: PENDING vencidas (chip 2b)
CREATE INDEX idx_transfers_pending_expiry
  ON opportunity_transfers (expires_at, status) WHERE status = 'PENDING';

-- T1 (race): no máximo 1 transfer PENDING por opportunity
CREATE UNIQUE INDEX idx_transfers_active_per_opp
  ON opportunity_transfers (opportunity_id) WHERE status = 'PENDING';

COMMENT ON TABLE opportunity_transfers IS
  'Solicitações de transferência cross-team de responsabilidade de opportunity (Sprint 15G.5). status=máquina de estado (T8); partial UNIQUE em (opportunity_id) WHERE PENDING impede race (T1).';

-- RLS — pattern padrão do projeto (enable_tenant_rls do 0002_rls)
SELECT enable_tenant_rls('opportunity_transfers');

-- ---------------------------------------------------------------------
-- opportunities.current_transfer_id — flag de "em transferência" (T2)
--   NULL = opp livre. Não-NULL = opp em transferência pendente; o guard
--   de write (chip 2c) bloqueia escrita de quem não é o disparador.
-- ---------------------------------------------------------------------
ALTER TABLE opportunities
  ADD COLUMN current_transfer_id uuid REFERENCES opportunity_transfers(id);

COMMENT ON COLUMN opportunities.current_transfer_id IS
  'Sprint 15G.5 (T2): transfer PENDING ativo desta opp. Guard de write (chip 2c) usa pra bloquear edição do dono durante a pendência. Limpo em approve/reject/cancel/timeout.';

-- ---------------------------------------------------------------------
-- tenant_settings.transfer_timeout_hours — timeout parametrizável (T3)
-- ---------------------------------------------------------------------
ALTER TABLE tenant_settings
  ADD COLUMN transfer_timeout_hours integer NOT NULL DEFAULT 72;

COMMENT ON COLUMN tenant_settings.transfer_timeout_hours IS
  'Sprint 15G.5 (T3): horas até uma transferência PENDING auto-expirar (TIMED_OUT). Default 72h (3 dias). Worker (chip 2b) verifica de hora em hora.';
