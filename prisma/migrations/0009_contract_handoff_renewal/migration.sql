-- Sprint 8: handoff de contrato + alertas de renovação

ALTER TABLE tenants
  ADD COLUMN handoff_emails TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN contract_renewal_lead_days INT[] NOT NULL DEFAULT '{90,60,30}';
