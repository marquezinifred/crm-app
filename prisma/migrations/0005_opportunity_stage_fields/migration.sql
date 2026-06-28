-- =====================================================================
-- Sprint 2 — campos por estágio na Opportunity (§3 do spec)
-- + currentStageEnteredAt para cálculo rápido de "dias nesta etapa"
-- =====================================================================

ALTER TABLE opportunities
  ADD COLUMN meeting_scheduled_at TIMESTAMP(3),
  ADD COLUMN meeting_happened BOOLEAN,
  ADD COLUMN briefing TEXT,
  ADD COLUMN proposal_presented_at DATE,
  ADD COLUMN decision_expected_at DATE,
  ADD COLUMN estimated_team_notes TEXT,
  ADD COLUMN accepted_at TIMESTAMP(3),
  ADD COLUMN acceptance_notification_sent_at TIMESTAMP(3),
  ADD COLUMN handoff_report_generated_at TIMESTAMP(3),
  ADD COLUMN current_stage_entered_at TIMESTAMP(3) NOT NULL DEFAULT now();

-- Backfill: para oportunidades existentes, current_stage_entered_at = created_at
UPDATE opportunities SET current_stage_entered_at = created_at;
