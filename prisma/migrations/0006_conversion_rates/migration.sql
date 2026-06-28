-- Sprint 5: conversionRates por tenant (taxas de conversão configuráveis
-- usadas pela projeção de receita; podem ser sugeridas por IA)
ALTER TABLE tenants ADD COLUMN conversion_rates JSONB;

-- Backfill com defaults inspirados em benchmarks B2B típicos
UPDATE tenants SET conversion_rates = '{
  "PROSPECT": 5,
  "LEAD": 15,
  "OPORTUNIDADE": 30,
  "PROPOSTA": 50,
  "NEGOCIACAO": 70,
  "ACEITE": 85,
  "CONTRATO": 100
}'::jsonb WHERE conversion_rates IS NULL;
