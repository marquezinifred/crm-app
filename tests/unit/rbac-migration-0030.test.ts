// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado; migration.sql não existe.
//               Remover junto com describe.skip após merge.
//
// AC-01 — Migration 0030 aplicada sem erro:
//   - backfill GESTOR_INBOUND → ADMIN + 4 grants
//   - ON CONFLICT DO NOTHING (idempotente)
//   - Cast enum via text intermediário (memory/migration-pitfalls #1)
//   - Remove enum antigo
//
// Estratégia: parse do SQL da migration (arquivo estático) e verifica
// presença dos padrões críticos. Não roda contra Postgres real
// (integration-level cobre isso via DATABASE_URL_TEST).
//
// TODO(Sprint 15E): remover describe.skip após merge da Fase 1.
// Depende de: prisma/migrations/0030_rbac_granular/migration.sql

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATION_DIR = path.resolve(
  process.cwd(),
  'prisma/migrations/0030_rbac_granular',
);

async function loadMigrationSql(): Promise<string> {
  const p = path.join(MIGRATION_DIR, 'migration.sql');
  return fs.readFile(p, 'utf-8');
}

describe.skip('AC-01 — Migration 0030 estrutural', () => {
  it('arquivo migration.sql existe', async () => {
    const sql = await loadMigrationSql();
    expect(sql.length).toBeGreaterThan(100);
  });

  it('cria tabela user_permission_overrides com colunas críticas', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/CREATE TABLE\s+user_permission_overrides/i);
    expect(sql).toMatch(/user_id\s+uuid\s+NOT NULL/i);
    expect(sql).toMatch(/tenant_id\s+uuid\s+NOT NULL/i);
    expect(sql).toMatch(/permission\s+text\s+NOT NULL/i);
    expect(sql).toMatch(/action\s+text\s+NOT NULL\s+CHECK\s*\(action\s+IN\s*\(\s*'granted'\s*,\s*'revoked'\s*\)\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*user_id\s*,\s*permission\s*\)/i);
  });

  it('adiciona coluna cached_permissions NULLABLE em users (AC-06)', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/ALTER TABLE\s+users/i);
    expect(sql).toMatch(/ADD COLUMN\s+cached_permissions\s+text\[\]/i);
    // Não pode ter NOT NULL nem DEFAULT '{}' — precisa ser nullable
    expect(sql).not.toMatch(/cached_permissions\s+text\[\]\s+NOT NULL/i);
    expect(sql).not.toMatch(/cached_permissions\s+text\[\]\s+DEFAULT\s+'\{\}'/i);
  });

  it('backfill GESTOR_INBOUND concede as 4 permissions inbound', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/INSERT INTO\s+user_permission_overrides/i);
    expect(sql).toMatch(/inbound:view_queue/);
    expect(sql).toMatch(/inbound:assign_prospects/);
    expect(sql).toMatch(/inbound:configure/);
    expect(sql).toMatch(/inbound:view_reports/);
    expect(sql).toMatch(/WHERE\s+role\s*=\s*'GESTOR_INBOUND'/i);
  });

  it('backfill usa ON CONFLICT DO NOTHING (idempotente)', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*user_id\s*,\s*permission\s*\)\s+DO NOTHING/i);
  });

  it('depois do INSERT, roda UPDATE role = ADMIN pros GESTOR_INBOUND', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/UPDATE\s+users\s+SET\s+role\s*=\s*'ADMIN'\s+WHERE\s+role\s*=\s*'GESTOR_INBOUND'/i);

    // Ordem crítica: INSERT antes do UPDATE (senão perde a rastreabilidade)
    const insertIdx = sql.search(/INSERT INTO\s+user_permission_overrides/i);
    const updateRoleIdx = sql.search(/UPDATE\s+users\s+SET\s+role\s*=\s*'ADMIN'\s+WHERE\s+role\s*=\s*'GESTOR_INBOUND'/i);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(updateRoleIdx).toBeGreaterThan(insertIdx);
  });

  it('sanitiza approval_rules.approver_roles removendo GESTOR_INBOUND antes de DROP', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/array_remove\(\s*approver_roles\s*,\s*'GESTOR_INBOUND'\s*\)/i);
  });

  it('faz cast do enum via text intermediário (memory/migration-pitfalls #1)', async () => {
    const sql = await loadMigrationSql();
    // Padrão: RENAME enum_old + CREATE novo + USING text::"UserRole" + DROP TYPE _old
    expect(sql).toMatch(/ALTER TYPE\s+"UserRole"\s+RENAME TO\s+"UserRole_old"/i);
    expect(sql).toMatch(/CREATE TYPE\s+"UserRole"\s+AS ENUM/i);
    expect(sql).toMatch(/USING\s+role::text::"UserRole"/i);
    expect(sql).toMatch(/DROP TYPE\s+"UserRole_old"/i);

    // Enum novo NÃO tem GESTOR_INBOUND
    const enumMatch = sql.match(/CREATE TYPE\s+"UserRole"\s+AS ENUM\s*\(([^)]+)\)/i);
    expect(enumMatch).toBeTruthy();
    if (enumMatch) {
      expect(enumMatch[1]).not.toMatch(/GESTOR_INBOUND/);
      expect(enumMatch[1]).toMatch(/'ADMIN'/);
      expect(enumMatch[1]).toMatch(/'PARCEIRO'/);
    }
  });

  it('adiciona approval_rules.approver_permission com CHECK XOR', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/ALTER TABLE\s+approval_rules\s+ADD COLUMN\s+approver_permission\s+text/i);
    // CHECK XOR: exclusividade entre approver_roles e approver_permission
    expect(sql).toMatch(/CHECK\s*\(/i);
    expect(sql).toMatch(/approver_roles/);
    expect(sql).toMatch(/approver_permission/);
  });

  it('cria índices esperados em user_permission_overrides', async () => {
    const sql = await loadMigrationSql();
    expect(sql).toMatch(/CREATE INDEX\s+user_permission_overrides_user_idx/i);
    expect(sql).toMatch(/CREATE INDEX\s+user_permission_overrides_tenant_idx/i);
  });

  it('não referencia GESTOR_INBOUND em nenhuma seed/insert nova', async () => {
    const sql = await loadMigrationSql();
    // Único uso permitido é em WHERE role='GESTOR_INBOUND' (backfill/sanitização)
    const gestorMentions = sql.match(/GESTOR_INBOUND/g) ?? [];
    // Esperado: 2× no INSERT (WHERE) + 1× no UPDATE + 1× no array_remove = 4 no máx.
    // Se > 6 provavelmente vazou pra CREATE TYPE ou seed.
    expect(gestorMentions.length).toBeLessThanOrEqual(6);
  });
});
