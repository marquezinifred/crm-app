import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS_CATALOG,
  PERMISSION_KEYS,
  isValidPermission,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type PermissionCategory,
} from '@/lib/auth/permissions-catalog';

/**
 * Sprint 15G Fase 1b — mudanças específicas no catálogo de permissions.
 *
 * Spec: `docs/Sprint_15G_estrutura_comercial.md` §6
 * - REMOVIDO: opportunity:read_others (substituído por read_team + read_all)
 * - ADICIONADO: opportunity:read_team, opportunity:read_all
 * - ADICIONADO: sales_structure:read, sales_structure:manage (nova category "commercial")
 * - Total: 61 - 1 + 4 = 64 permissions
 */
describe('permissions catalog — Sprint 15G Fase 1b', () => {
  it('opportunity:read_others está AUSENTE do catálogo (Sprint 15G removeu)', () => {
    const found = PERMISSIONS_CATALOG.find(
      (p) => (p.key as string) === 'opportunity:read_others',
    );
    expect(found).toBeUndefined();
    expect(PERMISSION_KEYS.has('opportunity:read_others' as never)).toBe(false);
    expect(isValidPermission('opportunity:read_others')).toBe(false);
  });

  it('opportunity:read_team PRESENTE com label PT-BR + category opportunities', () => {
    const entry = PERMISSIONS_CATALOG.find((p) => p.key === 'opportunity:read_team');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Ver oportunidades da equipe gerenciada');
    expect(entry?.category).toBe('opportunities');
    expect(isValidPermission('opportunity:read_team')).toBe(true);
  });

  it('opportunity:read_all PRESENTE com label PT-BR + category opportunities', () => {
    const entry = PERMISSIONS_CATALOG.find((p) => p.key === 'opportunity:read_all');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Ver todas as oportunidades do tenant');
    expect(entry?.category).toBe('opportunities');
    expect(isValidPermission('opportunity:read_all')).toBe(true);
  });

  it('opportunity:transfer PRESENTE com label PT-BR + category opportunities (Sprint 15G.5 T12)', () => {
    const entry = PERMISSIONS_CATALOG.find((p) => p.key === 'opportunity:transfer');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Transferir responsabilidade de oportunidade');
    expect(entry?.category).toBe('opportunities');
    expect(isValidPermission('opportunity:transfer')).toBe(true);
  });

  it('sales_structure:read PRESENTE com label PT-BR + category commercial', () => {
    const entry = PERMISSIONS_CATALOG.find((p) => p.key === 'sales_structure:read');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Ver estrutura organizacional comercial');
    expect(entry?.category).toBe('commercial');
    expect(isValidPermission('sales_structure:read')).toBe(true);
  });

  it('sales_structure:manage PRESENTE com label PT-BR + category commercial', () => {
    const entry = PERMISSIONS_CATALOG.find((p) => p.key === 'sales_structure:manage');
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('Gerenciar estrutura e membros');
    expect(entry?.category).toBe('commercial');
    expect(isValidPermission('sales_structure:manage')).toBe(true);
  });

  it('total = 65 permissions distintas (61 baseline − 1 removida + 4 adicionadas + 1 transfer 15G.5)', () => {
    expect(PERMISSIONS_CATALOG.length).toBe(65);
    expect(PERMISSION_KEYS.size).toBe(65);
  });

  it('nova category "commercial" existe em CATEGORY_ORDER + CATEGORY_LABELS com 2 permissions', () => {
    expect(CATEGORY_ORDER).toContain('commercial' as PermissionCategory);
    expect(CATEGORY_LABELS.commercial).toBe('Estrutura comercial');

    const commercialPerms = PERMISSIONS_CATALOG.filter((p) => p.category === 'commercial');
    expect(commercialPerms).toHaveLength(2);
    expect(commercialPerms.map((p) => p.key).sort()).toEqual([
      'sales_structure:manage',
      'sales_structure:read',
    ]);
  });

  it('todas as 64 permissions têm label não-vazio e category válida', () => {
    for (const p of PERMISSIONS_CATALOG) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.key).toMatch(/^[a-z_]+:[a-z_]+$/);
      expect(CATEGORY_LABELS[p.category as PermissionCategory]).toBeTruthy();
      expect(CATEGORY_ORDER).toContain(p.category as PermissionCategory);
    }
  });
});
