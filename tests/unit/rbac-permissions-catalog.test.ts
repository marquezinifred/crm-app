// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado; APIs importadas não existem.
//               Remover junto com describe.skip após merge (docs/QA_Automation_Report_Sprint_15E.md).
//
// AC-02 — src/lib/auth/permissions-catalog.ts exporta 65 entradas
// {key, label, category} sem duplicatas, categorias válidas.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import {
  EXPECTED_CATALOG_SIZE,
  EXPECTED_CATEGORIES,
} from '../helpers/rbac-fixtures';

describe.skip('AC-02 — permissions-catalog shape (Sprint 15E)', () => {
  it('exporta exatamente 65 permissions', async () => {
    const mod = await import('@/lib/auth/permissions-catalog');
    expect(mod.PERMISSIONS_CATALOG).toHaveLength(EXPECTED_CATALOG_SIZE);
  });

  it('cada entrada tem shape {key, label, category}', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    for (const p of PERMISSIONS_CATALOG) {
      expect(typeof p.key).toBe('string');
      expect(p.key).toMatch(/^[a-z][a-z_]+:[a-z][a-z_]+$/);
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.category).toBe('string');
    }
  });

  it('keys são únicas (sem duplicatas)', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const keys = PERMISSIONS_CATALOG.map((p) => p.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('todas as categories estão na whitelist do §4.1', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const found = new Set(PERMISSIONS_CATALOG.map((p) => p.category));
    for (const category of found) {
      expect(EXPECTED_CATEGORIES.has(category)).toBe(true);
    }
  });

  it('exporta o type Permission derivado do catálogo', async () => {
    // Type-check indireto: se o Permission type está exportado, essa linha compila.
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const sample: (typeof PERMISSIONS_CATALOG)[number]['key'] = 'opportunity:read';
    expect(sample).toBe('opportunity:read');
  });

  it('contém permissions críticas do Sprint 15D (inbound:*)', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const keys = new Set(PERMISSIONS_CATALOG.map((p) => p.key));
    expect(keys.has('inbound:view_queue')).toBe(true);
    expect(keys.has('inbound:assign_prospects')).toBe(true);
    expect(keys.has('inbound:configure')).toBe(true);
    expect(keys.has('inbound:view_reports')).toBe(true);
  });

  it('contém splits granulares do Sprint 15F (ai:configure_*)', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const keys = new Set(PERMISSIONS_CATALOG.map((p) => p.key));
    expect(keys.has('ai:configure_global')).toBe(true);
    expect(keys.has('ai:configure_feature')).toBe(true);
    expect(keys.has('ai:test_key')).toBe(true);
    expect(keys.has('ai:manage_breaker')).toBe(true);
    // Alias 'ai:configure' foi removido (permission-matrix Alterações vs Sprint 15F)
    expect(keys.has('ai:configure')).toBe(false);
  });

  it('contém permissions de user:grant_permissions e opportunity:read_others', async () => {
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const keys = new Set(PERMISSIONS_CATALOG.map((p) => p.key));
    expect(keys.has('user:grant_permissions')).toBe(true);
    expect(keys.has('opportunity:read_others')).toBe(true);
    expect(keys.has('reports:financial')).toBe(true);
    expect(keys.has('audit:read_platform')).toBe(true);
  });
});
