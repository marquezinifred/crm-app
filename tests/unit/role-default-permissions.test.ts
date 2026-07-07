import { describe, it, expect } from 'vitest';
import {
  ROLE_DEFAULT_PERMISSIONS,
  hasPermissionByRole,
  computeEffectivePermissions,
} from '@/lib/auth/rbac';
import { PERMISSION_KEYS, type Permission } from '@/lib/auth/permissions-catalog';

/**
 * Contagens autoritativas — validadas contra `docs/permission-matrix.md`
 * + `docs/Sprint_15G_estrutura_comercial.md` §6. Sprint 15G Fase 1b removeu
 * `opportunity:read_others` e adicionou `opportunity:read_team`,
 * `opportunity:read_all`, `sales_structure:read`, `sales_structure:manage`.
 * Qualquer mudança aqui exige atualização paralela do matrix doc + spec.
 */
const EXPECTED_COUNTS: Record<keyof typeof ROLE_DEFAULT_PERMISSIONS, number> = {
  ADMIN: 63,
  DIRETOR_COMERCIAL: 41,
  DIRETOR_OPERACOES: 27,
  DIRETOR_FINANCEIRO: 19,
  GESTOR: 32,
  ANALISTA: 24,
  PARCEIRO: 5,
};

describe('ROLE_DEFAULT_PERMISSIONS — Sprint 15E + 15G Fase 1b', () => {
  it.each(Object.entries(EXPECTED_COUNTS) as Array<[keyof typeof ROLE_DEFAULT_PERMISSIONS, number]>)(
    '%s tem exatamente %i permissions default',
    (role, count) => {
      expect(ROLE_DEFAULT_PERMISSIONS[role].size).toBe(count);
    },
  );

  it('toda permission default de cada role está no catálogo', () => {
    for (const [role, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const p of perms) {
        expect(
          PERMISSION_KEYS.has(p),
          `${role} referencia permission fora do catálogo: ${p}`,
        ).toBe(true);
      }
    }
  });

  it('ADMIN NÃO tem audit:read_platform (Platform Owner only)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('audit:read_platform')).toBe(false);
  });

  it('PARCEIRO só tem 5 permissions (isolamento estrito)', () => {
    const set = ROLE_DEFAULT_PERMISSIONS.PARCEIRO;
    expect(set.has('company:read')).toBe(true);
    expect(set.has('contact:read')).toBe(true);
    expect(set.has('opportunity:read')).toBe(true);
    expect(set.has('document:upload')).toBe(true);
    expect(set.has('document:read')).toBe(true);
    // Nada mais
    expect(set.has('company:create')).toBe(false);
    expect(set.has('opportunity:read_team')).toBe(false);
    expect(set.has('opportunity:read_all')).toBe(false);
    expect(set.has('sales_structure:read')).toBe(false);
    expect(set.has('ai:use_summary')).toBe(false);
    expect(set.has('user:read')).toBe(false);
  });

  it('reports:financial default apenas em ADMIN + DIRETOR_C + DIRETOR_F', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('reports:financial')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.has('reports:financial')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.has('reports:financial')).toBe(true);
    // Restantes: não
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('reports:financial')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.has('reports:financial')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('reports:financial')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.PARCEIRO.has('reports:financial')).toBe(false);
  });

  it('ai:manage_breaker default apenas em ADMIN', () => {
    for (const role of Object.keys(ROLE_DEFAULT_PERMISSIONS) as Array<
      keyof typeof ROLE_DEFAULT_PERMISSIONS
    >) {
      const hasBreaker = ROLE_DEFAULT_PERMISSIONS[role].has('ai:manage_breaker');
      expect(hasBreaker).toBe(role === 'ADMIN');
    }
  });
});

describe('hasPermissionByRole (sync UI helper)', () => {
  it('confirma default sem overrides', () => {
    expect(hasPermissionByRole('ADMIN', 'user:create')).toBe(true);
    expect(hasPermissionByRole('ANALISTA', 'user:create')).toBe(false);
    // Sprint 15G Fase 1b: read_team/read_all substituíram read_others
    expect(hasPermissionByRole('ANALISTA', 'opportunity:read_team')).toBe(false);
    expect(hasPermissionByRole('ANALISTA', 'opportunity:read_all')).toBe(false);
    expect(hasPermissionByRole('GESTOR', 'opportunity:read_team')).toBe(true);
    expect(hasPermissionByRole('GESTOR', 'opportunity:read_all')).toBe(false);
  });

  it('role nulo → false', () => {
    expect(hasPermissionByRole(null, 'user:create')).toBe(false);
    expect(hasPermissionByRole(undefined, 'user:create')).toBe(false);
  });
});

describe('computeEffectivePermissions — cascata de resolução', () => {
  it('sem overrides retorna defaults do role', () => {
    const set = computeEffectivePermissions({ role: 'ANALISTA', overrides: [] });
    expect(set.has('company:read')).toBe(true);
    expect(set.has('opportunity:read_team')).toBe(false);
    expect(set.has('opportunity:read_all')).toBe(false);
    expect(set.size).toBe(24);
  });

  it('grant adiciona permission fora do default', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [{ permission: 'opportunity:read_team', action: 'granted' }],
    });
    expect(set.has('opportunity:read_team')).toBe(true);
    expect(set.size).toBe(25);
  });

  it('revoke remove permission do default', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [{ permission: 'company:read', action: 'revoked' }],
    });
    expect(set.has('company:read')).toBe(false);
    expect(set.size).toBe(23);
  });

  it('revoked > granted quando ambos existem (conflito legítimo → revoga vence)', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [
        { permission: 'opportunity:read_team', action: 'granted' },
        { permission: 'opportunity:read_team', action: 'revoked' },
      ],
    });
    expect(set.has('opportunity:read_team')).toBe(false);
  });

  it('ignora permissions inválidas nos overrides (defensive)', () => {
    const set = computeEffectivePermissions({
      role: 'ADMIN',
      overrides: [
        { permission: 'foo:bar', action: 'granted' },
        { permission: 'user:create', action: 'revoked' },
        // Legacy read_others permission — removida no 15G, override antigo é ignorado
        { permission: 'opportunity:read_others', action: 'granted' },
      ],
    });
    // ADMIN perde user:create (revoked válido); foo:bar e read_others (inválidas) ignoradas
    expect(set.has('user:create')).toBe(false);
    expect(set.has('foo:bar' as Permission)).toBe(false);
  });

  it('PARCEIRO com todas defaults revogadas → resultado []', () => {
    const set = computeEffectivePermissions({
      role: 'PARCEIRO',
      overrides: [
        { permission: 'company:read', action: 'revoked' },
        { permission: 'contact:read', action: 'revoked' },
        { permission: 'opportunity:read', action: 'revoked' },
        { permission: 'document:upload', action: 'revoked' },
        { permission: 'document:read', action: 'revoked' },
      ],
    });
    expect(set.size).toBe(0);
    // Este é o caso crítico do §6.6 — cache stampado como `[]` +
    // `cachedPermissionsAt: now()` evita loop de recompute.
  });
});
