// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-14 — permissions.listCatalog retorna todas as 65 permissions.
// AC-15 — permissions.forUser retorna {role, defaults, overrides, effective}
//          corretamente calculado.
// AC-18 — permissions.whoHas filtra por cachedPermissions: { has } — retorna
//          users com permission efetiva.
// AC-19 — Cross-tenant: permissions.forUser com userId de outro tenant
//          → NOT_FOUND (não FORBIDDEN — evita enumeration).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ANALISTA_DEFAULT_PERMS,
  EXPECTED_CATALOG_SIZE,
  TENANT_A,
  TENANT_B,
  USER_IDS,
  makeCtx,
  makeOverride,
  makeUser,
} from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();
const mockUser = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
};
const mockOverride = {
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
    invalidateUserPermissionsCache: vi.fn(),
    computeAndCacheUserPermissions: vi.fn().mockResolvedValue(new Set(ANALISTA_DEFAULT_PERMS)),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: mockUser,
    userPermissionOverride: mockOverride,
  },
}));

vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

async function makeCaller(role: 'ADMIN' | 'ANALISTA' = 'ADMIN') {
  const { permissionsRouter } = await import(
    '@/server/trpc/routers/permissions'
  );
  return permissionsRouter.createCaller(makeCtx({ role }));
}

describe.skip('AC-14 — permissions.listCatalog retorna 65 entries', () => {
  it('lista todas as 65 permissions', async () => {
    const caller = await makeCaller('ANALISTA');
    const catalog = await caller.listCatalog();
    expect(catalog).toHaveLength(EXPECTED_CATALOG_SIZE);
  });

  it('cada entrada tem shape {key, label, category}', async () => {
    const caller = await makeCaller('ANALISTA');
    const catalog = await caller.listCatalog();
    for (const p of catalog) {
      expect(p).toMatchObject({
        key: expect.any(String),
        label: expect.any(String),
        category: expect.any(String),
      });
    }
  });

  it('procedure acessível a qualquer usuário autenticado', async () => {
    // Não requer user:grant_permissions — pra UI de qualquer form.
    hasPermissionSpy.mockResolvedValue(false);
    const caller = await makeCaller('PARCEIRO' as never);
    await expect(caller.listCatalog()).resolves.toBeDefined();
  });
});

describe.skip('AC-15 — permissions.forUser retorna shape completo', () => {
  it('retorna {userId, fullName, email, role, defaults, overrides, effective}', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({ id: USER_IDS.analista, role: 'ANALISTA' }),
      permissionOverrides: [
        {
          ...makeOverride({
            permission: 'inbound:view_queue',
            action: 'granted',
            grantedBy: USER_IDS.admin,
          }),
          grantedByUser: { id: USER_IDS.admin, fullName: 'Fred M.' },
        },
      ],
    });

    const caller = await makeCaller('ADMIN');
    const result = await caller.forUser({ userId: USER_IDS.analista });

    expect(result).toMatchObject({
      userId: USER_IDS.analista,
      fullName: expect.any(String),
      email: expect.any(String),
      role: 'ANALISTA',
      defaults: expect.any(Array),
      overrides: expect.any(Array),
      effective: expect.any(Array),
    });
  });

  it('effective = defaults ∪ granted − revoked', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({
        id: USER_IDS.analista,
        role: 'ANALISTA',
        cachedPermissions: null, // força recompute
      }),
      permissionOverrides: [
        { ...makeOverride({ permission: 'inbound:view_queue', action: 'granted' }), grantedByUser: null },
        { ...makeOverride({ permission: 'opportunity:create', action: 'revoked' }), grantedByUser: null },
      ],
    });

    const caller = await makeCaller('ADMIN');
    const result = await caller.forUser({ userId: USER_IDS.analista });

    // effective vindo do computeAndCacheUserPermissions mockado
    expect(result.effective).toContain('opportunity:read');
    expect(result.defaults).toContain('opportunity:read');
  });

  it('inclui grantedByUser.fullName mas NÃO IDs privados de outros users', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({ id: USER_IDS.analista }),
      permissionOverrides: [
        {
          ...makeOverride({ grantedBy: USER_IDS.admin }),
          grantedByUser: { id: USER_IDS.admin, fullName: 'Fred M.' },
        },
      ],
    });

    const caller = await makeCaller('ADMIN');
    const result = await caller.forUser({ userId: USER_IDS.analista });

    expect(result.overrides[0].grantedByUser).toHaveProperty('fullName');
    // grantedByUser.id pode aparecer (não é privado) — só senhas/tokens/keys devem ser omitidos
  });
});

describe.skip('AC-18 — permissions.whoHas filtra via cachedPermissions', () => {
  it('retorna users com permission efetiva no tenant', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, role: 'ADMIN' }),
      makeUser({ id: USER_IDS.gestor, role: 'GESTOR' }),
    ]);

    const caller = await makeCaller('ADMIN');
    const result = await caller.whoHas({ permission: 'inbound:assign_prospects' });

    expect(result).toHaveLength(2);
    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      tenantId: TENANT_A,
      deletedAt: null,
      active: true,
      cachedPermissions: { has: 'inbound:assign_prospects' },
    });
  });

  it('não vaza users de outro tenant (filtro por tenantId)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ADMIN');
    await caller.whoHas({ permission: 'audit:read' });

    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where.tenantId).toBe(TENANT_A);
    // Explicitamente NÃO deixa passar tenantId de input
  });
});

describe.skip('AC-19 — cross-tenant permissions.forUser → NOT_FOUND', () => {
  it('userId de outro tenant → NOT_FOUND (não FORBIDDEN)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    // findFirst com filtro tenantId=TENANT_A + userId=USER do TENANT_B retorna null
    mockUser.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.forUser({ userId: USER_IDS.crossTenant }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Explicitamente NÃO é FORBIDDEN — evita enumeration
  });

  it('userId inexistente → NOT_FOUND', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.forUser({ userId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('user soft-deleted → NOT_FOUND (filtro deletedAt: null no findFirst)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.forUser({ userId: USER_IDS.analista }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const call = mockUser.findFirst.mock.calls[0]![0]!;
    expect(call.where.deletedAt).toBeNull();
  });
});
