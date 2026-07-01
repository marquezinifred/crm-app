import { describe, it, expect } from 'vitest';
import {
  ROLE_DEFAULT_PERMISSIONS,
  hasPermissionByRole,
  computeEffectivePermissions,
} from '@/lib/auth/rbac';
import { PERMISSION_KEYS, type Permission } from '@/lib/auth/permissions-catalog';

/**
 * Contagens autoritativas — validadas célula a célula na
 * `docs/permission-matrix.md` (2026-07-01). Qualquer mudança aqui
 * exige atualização paralela do matrix doc + Sprint spec.
 */
const EXPECTED_COUNTS: Record<keyof typeof ROLE_DEFAULT_PERMISSIONS, number> = {
  ADMIN: 60,
  DIRETOR_COMERCIAL: 39,
  DIRETOR_OPERACOES: 25,
  DIRETOR_FINANCEIRO: 18,
  GESTOR: 31,
  ANALISTA: 23,
  PARCEIRO: 5,
};

describe('ROLE_DEFAULT_PERMISSIONS — Sprint 15E', () => {
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

  it('ANALISTA NÃO tem opportunity:read_others (breaking change 15E)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('opportunity:read_others')).toBe(false);
    // Mas as demais roles têm
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('opportunity:read_others')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.has('opportunity:read_others')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('opportunity:read_others')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.has('opportunity:read_others')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.has('opportunity:read_others')).toBe(true);
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
    expect(set.has('opportunity:read_others')).toBe(false);
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
    expect(hasPermissionByRole('ANALISTA', 'opportunity:read_others')).toBe(false);
    expect(hasPermissionByRole('GESTOR', 'opportunity:read_others')).toBe(true);
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
    expect(set.has('opportunity:read_others')).toBe(false);
    expect(set.size).toBe(23);
  });

  it('grant adiciona permission fora do default', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [{ permission: 'opportunity:read_others', action: 'granted' }],
    });
    expect(set.has('opportunity:read_others')).toBe(true);
    expect(set.size).toBe(24);
  });

  it('revoke remove permission do default', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [{ permission: 'company:read', action: 'revoked' }],
    });
    expect(set.has('company:read')).toBe(false);
    expect(set.size).toBe(22);
  });

  it('revoked > granted quando ambos existem (conflito legítimo → revoga vence)', () => {
    const set = computeEffectivePermissions({
      role: 'ANALISTA',
      overrides: [
        { permission: 'opportunity:read_others', action: 'granted' },
        { permission: 'opportunity:read_others', action: 'revoked' },
      ],
    });
    expect(set.has('opportunity:read_others')).toBe(false);
  });

  it('ignora permissions inválidas nos overrides (defensive)', () => {
    const set = computeEffectivePermissions({
      role: 'ADMIN',
      overrides: [
        { permission: 'foo:bar', action: 'granted' },
        { permission: 'user:create', action: 'revoked' },
      ],
    });
    // ADMIN perde user:create (revoked válido); foo:bar (inválido) ignorado
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
