// @vitest-environment node
// Sprint 15H chip 1a — valida estruturalmente a migration 0034 que adiciona
// o suporte de reconcile de approvals órfãs (P-77). Parse do SQL estático —
// não roda contra Postgres real (a gestão aplica via `prisma migrate deploy`
// no rollout).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'prisma/migrations/0034_approvals_reconcile/migration.sql',
);

async function loadSql(): Promise<string> {
  return fs.readFile(MIGRATION, 'utf-8');
}

describe('Sprint 15H — Migration 0034 estrutural', () => {
  it('arquivo migration.sql existe (não colide com 0033 já em prod)', async () => {
    const sql = await loadSql();
    expect(sql.length).toBeGreaterThan(100);
  });

  it('recria o enum ApprovalStatus incluindo ORPHANED (pattern RENAME_old)', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/ALTER TYPE\s+"ApprovalStatus"\s+RENAME TO\s+"ApprovalStatus_old"/i);
    expect(sql).toMatch(/CREATE TYPE\s+"ApprovalStatus"\s+AS ENUM/i);
    expect(sql).toMatch(/'ORPHANED'/);
    expect(sql).toMatch(/DROP TYPE\s+"ApprovalStatus_old"/i);
  });

  it('casta approvals.status via text intermediário (migration-pitfalls #1)', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/status::text::"ApprovalStatus"/i);
  });

  it('adiciona applicable_rule_id + FK ON DELETE SET NULL', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/ADD COLUMN\s+applicable_rule_id\s+UUID/i);
    expect(sql).toMatch(
      /FOREIGN KEY\s*\(\s*applicable_rule_id\s*\)\s*REFERENCES\s+approval_rules\s*\(\s*id\s*\)\s+ON DELETE SET NULL/i,
    );
  });

  it('adiciona colunas orphaned_at + orphaned_reason', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/ADD COLUMN\s+orphaned_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/ADD COLUMN\s+orphaned_reason\s+TEXT/i);
  });

  it('cria índice parcial WHERE status = PENDING pro reconcile', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(
      /CREATE INDEX\s+approvals_pending_reconcile_idx\s+ON\s+approvals\s*\(\s*tenant_id\s*\)\s+WHERE\s+status\s*=\s*'PENDING'/i,
    );
  });

  it('recria o enum ANTES de referenciar ORPHANED (ordem correta)', async () => {
    const sql = await loadSql();
    const createEnum = sql.search(/CREATE TYPE\s+"ApprovalStatus"\s+AS ENUM/i);
    const addColumns = sql.search(/ADD COLUMN\s+applicable_rule_id/i);
    expect(createEnum).toBeGreaterThan(-1);
    expect(addColumns).toBeGreaterThan(createEnum);
  });

  it('schema.prisma tem ORPHANED no enum + applicableRule na relação', async () => {
    const schema = await fs.readFile(
      path.resolve(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    );
    expect(schema).toMatch(/enum ApprovalStatus \{[^}]*ORPHANED/);
    expect(schema).toMatch(/applicableRule\s+ApprovalRule\?\s+@relation\("ApplicableRule"/);
  });
});
