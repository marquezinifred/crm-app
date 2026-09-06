// @vitest-environment node
// Sprint 15H Bloco B (Chip 1b) — valida estruturalmente a migration 0035
// (sales_quotas + tenants.quota_period_type). Parse do SQL estático — não
// roda contra Postgres real (a gestão aplica via `prisma migrate deploy`
// no rollout). Espelha o padrão de `migration-0033-*.test.ts`.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'prisma/migrations/0035_sales_quotas/migration.sql',
);

async function loadSql(): Promise<string> {
  return fs.readFile(MIGRATION, 'utf-8');
}

describe('Chip 1b — Migration 0035 estrutural', () => {
  it('arquivo migration.sql existe', async () => {
    const sql = await loadSql();
    expect(sql.length).toBeGreaterThan(100);
  });

  it('cria a tabela sales_quotas com FK cascade pra tenants e sales_units', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/CREATE TABLE sales_quotas/i);
    expect(sql).toMatch(/tenant_id\s+uuid\s+NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/unit_id\s+uuid\s+NOT NULL REFERENCES sales_units\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/target_value\s+numeric\(15,2\)\s+NOT NULL/i);
    expect(sql).toMatch(/currency\s+text\s+NOT NULL DEFAULT 'BRL'/i);
    expect(sql).toMatch(/deleted_at\s+timestamptz/i);
  });

  it('UNIQUE de (tenant, unit, period) é PARCIAL WHERE deleted_at IS NULL', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX\s+sales_quotas_tenant_unit_period_active_key\s+ON\s+sales_quotas\s*\(\s*tenant_id\s*,\s*unit_id\s*,\s*period\s*\)\s+WHERE\s+deleted_at\s+IS\s+NULL/i,
    );
  });

  it('índice (tenant_id, period) para busca por período', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(
      /CREATE INDEX\s+sales_quotas_tenant_period_idx\s+ON\s+sales_quotas\s*\(\s*tenant_id\s*,\s*period\s*\)/i,
    );
  });

  it('aplica RLS default via enable_tenant_rls', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/SELECT enable_tenant_rls\('sales_quotas'\)/i);
  });

  it('adiciona tenants.quota_period_type text default QUARTERLY com CHECK', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(
      /ALTER TABLE tenants\s+ADD COLUMN IF NOT EXISTS quota_period_type text NOT NULL DEFAULT 'QUARTERLY'/i,
    );
    expect(sql).toMatch(
      /CHECK \(quota_period_type IN \('QUARTERLY', 'MONTHLY', 'SEMIANNUAL', 'ANNUAL'\)\)/i,
    );
  });

  it('schema.prisma declara o model SalesQuota + @@unique mapeado pro índice parcial', async () => {
    const schema = await fs.readFile(
      path.resolve(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    );
    expect(schema).toMatch(/model SalesQuota \{/);
    expect(schema).toMatch(
      /@@unique\(\[tenantId, unitId, period\], map: "sales_quotas_tenant_unit_period_active_key"\)/,
    );
    expect(schema).toMatch(/quotaPeriodType\s+String\s+@default\("QUARTERLY"\) @map\("quota_period_type"\)/);
  });
});
