-- Sprint 15C — Campos de endereço completos em companies
-- (BrasilAPI CEP auto-fill preenche street/neighborhood; vendedor digita numero/complemento)

ALTER TABLE companies
  ADD COLUMN cep          TEXT,
  ADD COLUMN logradouro   TEXT,
  ADD COLUMN numero       TEXT,
  ADD COLUMN complemento  TEXT,
  ADD COLUMN bairro       TEXT;

-- Útil pra agrupamentos territoriais futuros e validações
CREATE INDEX companies_cep_idx ON companies (tenant_id, cep) WHERE cep IS NOT NULL;
