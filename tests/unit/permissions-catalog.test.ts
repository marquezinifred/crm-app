import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS_CATALOG,
  PERMISSION_KEYS,
  isValidPermission,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from '@/lib/auth/permissions-catalog';

describe('permissions catalog — Sprint 15E + 15G Fase 1b', () => {
  it('tem 64 permissions distintas (Sprint 15G: 61 − 1 + 4)', () => {
    expect(PERMISSIONS_CATALOG.length).toBe(64);
    expect(PERMISSION_KEYS.size).toBe(64);
  });

  it('todas as keys seguem formato `resource:action`', () => {
    for (const p of PERMISSIONS_CATALOG) {
      expect(p.key).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('não tem keys duplicadas', () => {
    const keys = PERMISSIONS_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('categoria de cada permission está em CATEGORY_LABELS', () => {
    for (const p of PERMISSIONS_CATALOG) {
      expect(CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS]).toBeTruthy();
    }
  });

  it('CATEGORY_ORDER cobre todas as categorias do catálogo', () => {
    const categoriesInCatalog = new Set(PERMISSIONS_CATALOG.map((p) => p.category));
    for (const cat of categoriesInCatalog) {
      expect(CATEGORY_ORDER).toContain(cat as (typeof CATEGORY_ORDER)[number]);
    }
  });

  it('isValidPermission aceita keys do catálogo e rejeita fora', () => {
    expect(isValidPermission('user:create')).toBe(true);
    expect(isValidPermission('opportunity:read_team')).toBe(true);
    expect(isValidPermission('opportunity:read_all')).toBe(true);
    expect(isValidPermission('ai:manage_breaker')).toBe(true);
    expect(isValidPermission('inexistente:foo')).toBe(false);
    expect(isValidPermission('')).toBe(false);
    // Permissions legadas removidas no 15E
    expect(isValidPermission('opportunity:assign')).toBe(false);
    expect(isValidPermission('opportunity:set_inbound_owner')).toBe(false);
    expect(isValidPermission('ai:configure')).toBe(false);
    // Sprint 15G Fase 1b — read_others substituída por read_team + read_all
    expect(isValidPermission('opportunity:read_others')).toBe(false);
  });

  it('novas permissions do 15D/15E/15F/P-19/P-20 estão presentes', () => {
    // Sprint 15D — inbound granular
    expect(PERMISSION_KEYS.has('inbound:view_queue')).toBe(true);
    expect(PERMISSION_KEYS.has('inbound:assign_prospects')).toBe(true);
    expect(PERMISSION_KEYS.has('inbound:configure')).toBe(true);
    expect(PERMISSION_KEYS.has('inbound:view_reports')).toBe(true);

    // Sprint 15F — AI split
    expect(PERMISSION_KEYS.has('ai:configure_global')).toBe(true);
    expect(PERMISSION_KEYS.has('ai:configure_feature')).toBe(true);
    expect(PERMISSION_KEYS.has('ai:test_key')).toBe(true);
    expect(PERMISSION_KEYS.has('ai:manage_breaker')).toBe(true);
    expect(PERMISSION_KEYS.has('ai:use_extraction')).toBe(true);
    expect(PERMISSION_KEYS.has('ai:use_scoring')).toBe(true);

    // Sprint 15E — 5 novos (opportunity:read_others removida no 15G Fase 1b)
    expect(PERMISSION_KEYS.has('user:grant_permissions')).toBe(true);
    expect(PERMISSION_KEYS.has('reports:financial')).toBe(true);
    expect(PERMISSION_KEYS.has('reports:export')).toBe(true);
    expect(PERMISSION_KEYS.has('audit:read_platform')).toBe(true);

    // Sprint 15G Fase 1b — split visibilidade + estrutura organizacional
    expect(PERMISSION_KEYS.has('opportunity:read_team')).toBe(true);
    expect(PERMISSION_KEYS.has('opportunity:read_all')).toBe(true);
    expect(PERMISSION_KEYS.has('sales_structure:read')).toBe(true);
    expect(PERMISSION_KEYS.has('sales_structure:manage')).toBe(true);

    // P-19 documents
    expect(PERMISSION_KEYS.has('document:upload')).toBe(true);
    expect(PERMISSION_KEYS.has('document:read')).toBe(true);
    expect(PERMISSION_KEYS.has('document:delete')).toBe(true);

    // P-20 tasks
    expect(PERMISSION_KEYS.has('task:create')).toBe(true);
    expect(PERMISSION_KEYS.has('task:update')).toBe(true);
    expect(PERMISSION_KEYS.has('task:delete')).toBe(true);

    // Import
    expect(PERMISSION_KEYS.has('import:run')).toBe(true);
    expect(PERMISSION_KEYS.has('import:read')).toBe(true);

    // Alert receive
    expect(PERMISSION_KEYS.has('alert:receive_admin')).toBe(true);
  });
});
