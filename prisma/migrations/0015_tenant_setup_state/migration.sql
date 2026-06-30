-- Sprint 13 — Onboarding guiado: rastreio de progresso/dispense
ALTER TABLE tenants
  ADD COLUMN setup_completed_at TIMESTAMP(3),
  ADD COLUMN tour_dismissed_at  TIMESTAMP(3);
