// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado; APIs importadas não existem.
//               Remover junto com describe.skip após merge.
//
// AC-04 — hasPermission(userId, perm) async: bypass Platform Owner,
//          cache hit, cache miss → computa e popula, respeita
//          revoked > granted > default.
// AC-05 — hasPermissionByRole(role, perm) síncrono retorna só o default
//          do role (sem overrides).
// AC-06 — cachedPermissions nullable — null força recompute; []
//          legítimo pra PARCEIRO com defaults revogadas.
//
// TODO(Sprint 15E): remover describe.skip após merge da Fase 1.
// Depende de: src/lib/auth/rbac.ts refatorado.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ANALISTA_DEFAULT_PERMS,
  PARCEIRO_DEFAULT_PERMS,
  USER_IDS,
  makeOverride,
  makeUser,
} from '../helpers/rbac-fixtures';

const mockUser = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: mockUser,
    userPermissionOverride: { findMany: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ==== AC-04 ================================================================

describe.skip('AC-04 — hasPermission async (bypass, cache, compute)', () => {
  it('Platform Owner sempre retorna true (bypass total)', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ platformRole: 'PLATFORM_OWNER', cachedPermissions: null }),
    );
    const ok = await hasPermission(USER_IDS.platformOwner, 'audit:read_platform' as never);
    expect(ok).toBe(true);
    // Não pode ler cache pra decidir — bypass é primeiro
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it('cache hit — retorna direto do cachedPermissions sem recompute', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({
        cachedPermissions: ['opportunity:read', 'opportunity:create'],
      }),
    );
    const ok = await hasPermission(USER_IDS.analista, 'opportunity:read' as never);
    expect(ok).toBe(true);
    // Não popula (cache hit)
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it('cache hit negativo — permission não no cache retorna false', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ cachedPermissions: ['opportunity:read'] }),
    );
    const ok = await hasPermission(USER_IDS.analista, 'user:delete' as never);
    expect(ok).toBe(false);
  });

  it('cache miss (null) — computa e popula cache', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    // Primeiro findUnique: cachedPermissions=null → força recompute
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ role: 'ANALISTA', cachedPermissions: null }),
    );
    // Segundo findUnique dentro do compute (include overrides): retorna user + overrides vazio
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'ANALISTA' }),
      permissionOverrides: [],
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });

    const ok = await hasPermission(USER_IDS.analista, 'opportunity:read' as never);
    expect(ok).toBe(true);
    // Cache foi populado
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_IDS.analista },
        data: expect.objectContaining({
          cachedPermissions: expect.any(Array),
        }),
      }),
    );
  });

  it('user inativo → false pra qualquer permission', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(makeUser({ active: false }));
    const ok = await hasPermission(USER_IDS.analista, 'opportunity:read' as never);
    expect(ok).toBe(false);
  });

  it('user soft-deleted → false pra qualquer permission', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ deletedAt: new Date('2026-06-01') }),
    );
    const ok = await hasPermission(USER_IDS.analista, 'opportunity:read' as never);
    expect(ok).toBe(false);
  });

  it('user inexistente → false', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(null);
    const ok = await hasPermission('ghost', 'opportunity:read' as never);
    expect(ok).toBe(false);
  });
});

// ==== Cascata revoked > granted > default =================================

describe.skip('AC-04 — cascata de resolução (revoked > granted > default)', () => {
  it('granted concede permission que default não tem', async () => {
    const { computeAndCacheUserPermissions } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'ANALISTA' }),
      permissionOverrides: [
        makeOverride({ permission: 'inbound:view_queue', action: 'granted' }),
      ],
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });

    const set = await computeAndCacheUserPermissions(USER_IDS.analista);
    expect(set.has('inbound:view_queue')).toBe(true);
  });

  it('revoked tira permission que default tem', async () => {
    const { computeAndCacheUserPermissions } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'ANALISTA' }),
      permissionOverrides: [
        makeOverride({ permission: 'opportunity:create', action: 'revoked' }),
      ],
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });

    const set = await computeAndCacheUserPermissions(USER_IDS.analista);
    expect(set.has('opportunity:create')).toBe(false);
  });

  it('revoked > granted (conflito na mesma permission — revoked vence)', async () => {
    // Cenário: override criado como granted, depois virou revoked. UNIQUE
    // (user_id, permission) força upsert — só 1 override existe por vez.
    // Este teste cobre o caso raro de INSERT duplicado se lógica falhar.
    const { computeAndCacheUserPermissions } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'ANALISTA' }),
      permissionOverrides: [
        makeOverride({ permission: 'reports:financial', action: 'granted' }),
        makeOverride({ permission: 'reports:financial', action: 'revoked' }),
      ],
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });

    const set = await computeAndCacheUserPermissions(USER_IDS.analista);
    expect(set.has('reports:financial')).toBe(false);
  });
});

// ==== AC-05 ================================================================

describe.skip('AC-05 — hasPermissionByRole síncrono (ignora overrides)', () => {
  it('retorna true se permission está no default do role', async () => {
    const { hasPermissionByRole } = await import('@/lib/auth/rbac');
    expect(hasPermissionByRole('ADMIN', 'user:delete' as never)).toBe(true);
    expect(hasPermissionByRole('ANALISTA', 'opportunity:create' as never)).toBe(true);
    expect(hasPermissionByRole('PARCEIRO', 'opportunity:read' as never)).toBe(true);
  });

  it('retorna false se permission NÃO está no default do role', async () => {
    const { hasPermissionByRole } = await import('@/lib/auth/rbac');
    expect(hasPermissionByRole('ANALISTA', 'user:delete' as never)).toBe(false);
    expect(hasPermissionByRole('PARCEIRO', 'company:create' as never)).toBe(false);
    expect(hasPermissionByRole('ANALISTA', 'opportunity:read_others' as never)).toBe(false);
  });

  it('role null/undefined → false', async () => {
    const { hasPermissionByRole } = await import('@/lib/auth/rbac');
    expect(hasPermissionByRole(null, 'opportunity:read' as never)).toBe(false);
    expect(hasPermissionByRole(undefined, 'opportunity:read' as never)).toBe(false);
  });

  it('NÃO faz query ao banco — puramente síncrono', async () => {
    const { hasPermissionByRole } = await import('@/lib/auth/rbac');
    hasPermissionByRole('ANALISTA', 'opportunity:read' as never);
    expect(mockUser.findUnique).not.toHaveBeenCalled();
  });

  it('nunca considera overrides (ANALISTA com override granted continua false via API síncrona)', async () => {
    const { hasPermissionByRole } = await import('@/lib/auth/rbac');
    // Não há como setar override aqui — API é síncrona, só olha ROLE_DEFAULT.
    // ANALISTA por default NÃO tem opportunity:read_others.
    expect(hasPermissionByRole('ANALISTA', 'opportunity:read_others' as never)).toBe(false);
  });
});

// ==== AC-06 ================================================================

describe.skip('AC-06 — cachedPermissions nullable (null vs [] semantics)', () => {
  it('null força recompute (não é tratado como "nada permitido")', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');

    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ role: 'ANALISTA', cachedPermissions: null }),
    );
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'ANALISTA', cachedPermissions: null }),
      permissionOverrides: [],
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });

    const ok = await hasPermission(USER_IDS.analista, 'opportunity:read' as never);
    expect(ok).toBe(true);
    // Update foi chamado — cache foi populado
    expect(mockUser.update).toHaveBeenCalledTimes(1);
  });

  it('[] vazio legítimo (PARCEIRO com todas defaults revogadas) — NÃO dispara recompute', async () => {
    const { hasPermission } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce(
      makeUser({ role: 'PARCEIRO', cachedPermissions: [] }),
    );
    const ok = await hasPermission(USER_IDS.parceiro, 'opportunity:read' as never);
    expect(ok).toBe(false);
    // Não recomputou — não chama update
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it('invalidateUserPermissionsCache seta null (não [])', async () => {
    const { invalidateUserPermissionsCache } = await import('@/lib/auth/rbac');
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.analista });
    await invalidateUserPermissionsCache(USER_IDS.analista);
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_IDS.analista },
        data: { cachedPermissions: null },
      }),
    );
  });

  it('computeAndCacheUserPermissions grava array (mesmo se vazio)', async () => {
    const { computeAndCacheUserPermissions } = await import('@/lib/auth/rbac');
    mockUser.findUnique.mockResolvedValueOnce({
      ...makeUser({ role: 'PARCEIRO' }),
      permissionOverrides: PARCEIRO_DEFAULT_PERMS.map((p) =>
        makeOverride({ permission: p, action: 'revoked' }),
      ),
    });
    mockUser.update.mockResolvedValueOnce({ id: USER_IDS.parceiro });

    await computeAndCacheUserPermissions(USER_IDS.parceiro);
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cachedPermissions: expect.any(Array),
        }),
      }),
    );
    // Não seta null quando compute terminou
    const call = mockUser.update.mock.calls[0]![0]!;
    expect(call.data.cachedPermissions).not.toBeNull();
  });
});

// ==== Sanity: fixtures batem com defaults =================================

describe.skip('Sanity — ANALISTA_DEFAULT_PERMS confere com ROLE_DEFAULT_PERMISSIONS', () => {
  it('helper de fixture tem mesmas 23 permissions que o rbac.ts', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    const fromRbac = Array.from(ROLE_DEFAULT_PERMISSIONS.ANALISTA).sort();
    const fromFixture = [...ANALISTA_DEFAULT_PERMS].sort();
    expect(fromRbac).toEqual(fromFixture);
  });
});

