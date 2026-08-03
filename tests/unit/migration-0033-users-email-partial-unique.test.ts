// @vitest-environment node
// P-83 — valida estruturalmente a migration 0033 que torna o UNIQUE
// (tenant_id, email) PARCIAL (WHERE deleted_at IS NULL). Parse do SQL
// estático — não roda contra Postgres real (a gestão aplica via
// `prisma migrate deploy` no rollout).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'prisma/migrations/0033_users_email_partial_unique/migration.sql',
);

async function loadSql(): Promise<string> {
  return fs.readFile(MIGRATION, 'utf-8');
}

describe('P-83 — Migration 0033 estrutural', () => {
  it('arquivo migration.sql existe', async () => {
    const sql = await loadSql();
    expect(sql.length).toBeGreaterThan(100);
  });

  it('dropa o índice CHEIO antigo users_tenant_id_email_key (idempotente)', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/DROP INDEX\s+IF EXISTS\s+users_tenant_id_email_key/i);
  });

  it('cria o índice PARCIAL users_tenant_id_email_active_key WHERE deleted_at IS NULL', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX\s+users_tenant_id_email_active_key\s+ON\s+users\s*\(\s*tenant_id\s*,\s*email\s*\)\s+WHERE\s+deleted_at\s+IS\s+NULL/i,
    );
  });

  it('documenta a intenção via COMMENT ON INDEX', async () => {
    const sql = await loadSql();
    expect(sql).toMatch(/COMMENT ON INDEX\s+users_tenant_id_email_active_key/i);
  });

  it('DROP acontece antes do CREATE (ordem correta)', async () => {
    const sql = await loadSql();
    const dropIdx = sql.search(/DROP INDEX/i);
    const createIdx = sql.search(/CREATE UNIQUE INDEX\s+users_tenant_id_email_active_key/i);
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });

  it('schema.prisma mapeia o @@unique para o nome do índice parcial', async () => {
    const schema = await fs.readFile(
      path.resolve(process.cwd(), 'prisma/schema.prisma'),
      'utf-8',
    );
    expect(schema).toMatch(
      /@@unique\(\[tenantId, email\], map: "users_tenant_id_email_active_key"\)/,
    );
  });
});
