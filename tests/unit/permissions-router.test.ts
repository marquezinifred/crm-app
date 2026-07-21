// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// Prisma mocks
const mockUser = {
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
};
const mockOverride = {
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: mockUser,
    userPermissionOverride: mockOverride,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'admin-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

// Sprint 15E — stubamos hasPermission por default true; testes específicos
// sobrescrevem pra simular guard anti-escalada.
const hasPermissionMock = vi.fn<(userId: string, permission: string) => Promise<boolean>>(
  async () => true,
);
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (userId: string, permission: string) => hasPermissionMock(userId, permission),
  computeAndCacheUserPermissions: vi.fn(async () => new Set(['user:create'])),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: (role: string) => (role === 'ANALISTA' ? ['company:read'] : ['user:create']),
}));

async function makeCaller(opts?: {
  callerId?: string;
  role?: 'ADMIN' | 'ANALISTA';
  platformRole?: 'PLATFORM_OWNER' | null;
}) {
  const { permissionsRouter } = await import('@/server/trpc/routers/permissions');
  return permissionsRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: 'tenant-A',
    user: {
      id: opts?.callerId ?? 'admin-1',
      email: 'admin@test.co',
      fullName: 'Admin',
      role: opts?.role ?? 'ADMIN',
      tenantId: 'tenant-A',
      partnerCompanyId: null,
    },
    platformUser: opts?.platformRole
      ? { id: 'platform-1', email: 'platform@test.co', fullName: 'Platform', platformRole: opts.platformRole }
      : null,
    platformRole: opts?.platformRole ?? null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockImplementation(async () => true);
});

describe('permissionsRouter.listCatalog', () => {
  it('retorna catálogo completo com categorias', async () => {
    const caller = await makeCaller();
    const out = await caller.listCatalog();
    expect(out.permissions.length).toBe(65);
    expect(out.categoryOrder.length).toBeGreaterThan(0);
    expect(out.categoryLabels).toBeDefined();
  });
});

describe('permissionsRouter.forUser', () => {
  it('retorna structure completa do user com defaults + overrides + effective', async () => {
    mockUser.findFirst.mockResolvedValueOnce({
      id: 'target-1',
      fullName: 'Maria',
      email: 'maria@test.co',
      role: 'ANALISTA',
      cachedPermissions: ['company:read', 'inbound:view_queue'],
      cachedPermissionsAt: new Date(),
      permissionOverrides: [
        {
          id: 'o1',
          permission: 'inbound:view_queue',
          action: 'granted',
          grantedAt: new Date(),
          reason: 'Migrado do 15E',
          grantedByUser: { id: 'admin-1', fullName: 'Admin', email: 'a@a.co' },
        },
      ],
    });

    const caller = await makeCaller();
    const out = await caller.forUser({ userId: '11111111-1111-1111-1111-111111111111' });

    expect(out.userId).toBe('target-1');
    expect(out.role).toBe('ANALISTA');
    expect(out.defaults).toEqual(['company:read']);
    expect(out.overrides.length).toBe(1);
    expect(out.overrides[0]!.action).toBe('granted');
    expect(out.counts).toEqual({ defaults: 1, granted: 1, revoked: 0, effective: 2 });
  });

  it('lança NOT_FOUND quando user pertence a outro tenant', async () => {
    mockUser.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(
      caller.forUser({ userId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('permissionsRouter.grant — guard anti-escalada §6.5', () => {
  it('ADMIN COM audit:read concede audit:read a outro user — sucesso', async () => {
    hasPermissionMock.mockResolvedValueOnce(true); // caller tem audit:read
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    mockOverride.upsert.mockResolvedValueOnce({ id: 'o1' });

    const caller = await makeCaller();
    const out = await caller.grant({
      userId: '22222222-2222-2222-2222-222222222222',
      permission: 'audit:read',
      reason: 'Nova responsabilidade',
    });

    expect(out.ok).toBe(true);
    expect(mockOverride.upsert).toHaveBeenCalledOnce();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.permission_granted',
        tenantIdOverride: 'tenant-A',
      }),
    );
  });

  it('ADMIN SEM audit:read tentando conceder audit:read → 403', async () => {
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    // caller NÃO tem audit:read (retorna false pra essa permission)
    hasPermissionMock.mockResolvedValueOnce(false);

    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: '22222222-2222-2222-2222-222222222222',
        permission: 'audit:read',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mockOverride.upsert).not.toHaveBeenCalled();
  });

  it('Platform Owner concede qualquer permission — bypass total', async () => {
    // Nunca chama hasPermission (Platform Owner bypass).
    // Mas o middleware `canGrantPermissions` (withPermission('user:grant_permissions'))
    // ainda faz um check. Nesse teste stubamos hasPermissionMock=true no beforeEach.
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    mockOverride.upsert.mockResolvedValueOnce({ id: 'o1' });

    // Sobrescreve pra false — sinaliza que caller NÃO tem a permission,
    // mas o guard deve pular por platformRole=PLATFORM_OWNER.
    hasPermissionMock.mockImplementation(async (_uid: string, perm: string) => {
      if (perm === 'user:grant_permissions') return true; // passa o middleware
      return false; // guard interno deveria falhar sem bypass
    });

    const caller = await makeCaller({ platformRole: 'PLATFORM_OWNER' });
    const out = await caller.grant({
      userId: '22222222-2222-2222-2222-222222222222',
      permission: 'ai:manage_breaker',
    });
    expect(out.ok).toBe(true);
  });

  it('rejeita permission fora do catálogo (Zod)', async () => {
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: '22222222-2222-2222-2222-222222222222',
        permission: 'foo:bar',
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('permissionsRouter.revoke — guard também aplica', () => {
  it('ADMIN sem audit:read tentando revogar audit:read → 403', async () => {
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    hasPermissionMock.mockResolvedValueOnce(false);

    const caller = await makeCaller();
    await expect(
      caller.revoke({
        userId: '22222222-2222-2222-2222-222222222222',
        permission: 'audit:read',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('grava audit com action user.permission_revoked', async () => {
    hasPermissionMock.mockResolvedValueOnce(true);
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    mockOverride.upsert.mockResolvedValueOnce({ id: 'o1' });

    const caller = await makeCaller();
    await caller.revoke({
      userId: '22222222-2222-2222-2222-222222222222',
      permission: 'reports:financial',
      reason: 'Não vê receita',
    });

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.permission_revoked',
        after: {
          permission: 'reports:financial',
          reason: 'Não vê receita',
        },
      }),
    );
  });
});

describe('permissionsRouter.restore — deleta override + guard', () => {
  it('deleta override e grava audit user.permission_restored', async () => {
    hasPermissionMock.mockResolvedValueOnce(true);
    mockUser.findFirst.mockResolvedValueOnce({ id: 'target-1' });
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 1 });

    const caller = await makeCaller();
    const out = await caller.restore({
      userId: '22222222-2222-2222-2222-222222222222',
      permission: 'reports:financial',
    });

    expect(out).toEqual({ ok: true, count: 1 });
    expect(mockOverride.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: '22222222-2222-2222-2222-222222222222',
        permission: 'reports:financial',
        tenantId: 'tenant-A',
      },
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.permission_restored' }),
    );
  });
});

describe('permissionsRouter.whoHas', () => {
  it('filtra users com permission no cachedPermissions', async () => {
    mockUser.findMany.mockResolvedValueOnce([
      { id: 'u1', fullName: 'Ana', email: 'ana@test.co', role: 'ADMIN' },
      { id: 'u2', fullName: 'Bruno', email: 'bruno@test.co', role: 'DIRETOR_COMERCIAL' },
    ]);

    const caller = await makeCaller();
    const out = await caller.whoHas({ permission: 'inbound:view_queue' });
    expect(out.length).toBe(2);
    expect(mockUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-A',
          cachedPermissions: { has: 'inbound:view_queue' },
        }),
      }),
    );
  });
});
