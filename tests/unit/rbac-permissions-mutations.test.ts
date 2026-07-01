/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-16 — permissions.grant/revoke/restore faz upsert + audit com
//          tenantIdOverride + invalida cache.
// AC-17 — Guard anti-escalada: ADMIN sem audit:read tentando conceder
//          audit:read → 403 com mensagem clara. Platform Owner isento.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TENANT_A,
  USER_IDS,
  makeCtx,
  makeOverride,
  makeUser,
} from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();
const invalidateCacheSpy = vi.fn();
const auditSpy = vi.fn();
const mockOverride = { upsert: vi.fn(), deleteMany: vi.fn() };
const mockUser = { findFirst: vi.fn() };

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
    invalidateUserPermissionsCache: (...args: unknown[]) => invalidateCacheSpy(...args),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: {
    userPermissionOverride: mockOverride,
    user: mockUser,
  },
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

async function makeCaller(role: 'ADMIN' | 'ANALISTA' = 'ADMIN', platformRole?: 'PLATFORM_OWNER') {
  const { permissionsRouter } = await import(
    '@/server/trpc/routers/permissions'
  );
  return permissionsRouter.createCaller(
    makeCtx({ role, userId: USER_IDS.admin, platformRole: platformRole ?? null }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: ADMIN tenant tem user:grant_permissions
  hasPermissionSpy.mockResolvedValue(true);
  mockUser.findFirst.mockResolvedValue(
    makeUser({ id: USER_IDS.analista, tenantId: TENANT_A }),
  );
});

// ==== AC-16: grant ==========================================================

describe.skip('AC-16 — permissions.grant faz upsert + audit + invalida cache', () => {
  it('cria override granted via upsert', async () => {
    mockOverride.upsert.mockResolvedValueOnce(
      makeOverride({ permission: 'inbound:view_queue' }),
    );

    const caller = await makeCaller('ADMIN');
    const result = await caller.grant({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
      reason: 'Cobertura durante viagem do gestor',
    });

    expect(result).toEqual({ ok: true });
    const call = mockOverride.upsert.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      user_permission_unique: {
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
      },
    });
    expect(call.create).toMatchObject({
      userId: USER_IDS.analista,
      tenantId: TENANT_A,
      permission: 'inbound:view_queue',
      action: 'granted',
      grantedBy: USER_IDS.admin,
      reason: 'Cobertura durante viagem do gestor',
    });
  });

  it('invalida cache do user afetado', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());

    const caller = await makeCaller('ADMIN');
    await caller.grant({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
    });

    expect(invalidateCacheSpy).toHaveBeenCalledWith(USER_IDS.analista);
  });

  it('grava audit com tenantIdOverride + action user.permission_granted', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());

    const caller = await makeCaller('ADMIN');
    await caller.grant({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
      reason: 'motivo',
    });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'user.permission_granted',
      tableName: 'user_permission_overrides',
      recordId: USER_IDS.analista,
      tenantIdOverride: TENANT_A,
    });
    // Motivo pode aparecer no audit
    expect(JSON.stringify(entry)).toContain('inbound:view_queue');
  });
});

// ==== AC-16: revoke ========================================================

describe.skip('AC-16 — permissions.revoke: upsert action=revoked + audit + invalida', () => {
  it('upsert com action revoked', async () => {
    mockOverride.upsert.mockResolvedValueOnce(
      makeOverride({ action: 'revoked' }),
    );

    const caller = await makeCaller('ADMIN');
    await caller.revoke({
      userId: USER_IDS.analista,
      permission: 'reports:financial',
      reason: 'Estagiária',
    });

    const call = mockOverride.upsert.mock.calls[0]![0]!;
    expect(call.create.action).toBe('revoked');
  });

  it('grava audit com action user.permission_revoked', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride({ action: 'revoked' }));

    const caller = await makeCaller('ADMIN');
    await caller.revoke({
      userId: USER_IDS.analista,
      permission: 'reports:financial',
    });

    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'user.permission_revoked',
      tenantIdOverride: TENANT_A,
    });
  });
});

// ==== AC-16: restore =======================================================

describe.skip('AC-16 — permissions.restore deleta override + invalida cache', () => {
  it('deleta via deleteMany filtrado por userId + permission + tenantId', async () => {
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 1 });

    const caller = await makeCaller('ADMIN');
    const result = await caller.restore({
      userId: USER_IDS.analista,
      permission: 'reports:financial',
    });

    expect(result).toEqual({ ok: true });
    const call = mockOverride.deleteMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      userId: USER_IDS.analista,
      permission: 'reports:financial',
      tenantId: TENANT_A,
    });
  });

  it('invalida cache e grava audit user.permission_restored', async () => {
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 1 });

    const caller = await makeCaller('ADMIN');
    await caller.restore({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
    });

    expect(invalidateCacheSpy).toHaveBeenCalledWith(USER_IDS.analista);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry.action).toBe('user.permission_restored');
    expect(entry.tenantIdOverride).toBe(TENANT_A);
  });
});

// ==== AC-17: Guard anti-escalada ===========================================

describe.skip('AC-17 — anti-escalada: só delega o que você tem', () => {
  it('ADMIN sem audit:read tentando conceder audit:read → 403 com mensagem clara', async () => {
    // Simula: user:grant_permissions=true mas audit:read=false
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm !== 'audit:read'),
    );

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'audit:read',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('audit:read'),
    });

    // Não chega a fazer upsert
    expect(mockOverride.upsert).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('ADMIN sem ai:manage_breaker tentando conceder ai:manage_breaker → 403', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm !== 'ai:manage_breaker'),
    );

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.grant({
        userId: USER_IDS.gestor,
        permission: 'ai:manage_breaker',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('ADMIN com ai:configure_global concede ai:configure_global a GESTOR ✓', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.grant({
        userId: USER_IDS.gestor,
        permission: 'ai:configure_global',
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('Platform Owner isento: pode conceder qualquer permission', async () => {
    // Platform Owner NÃO tem tenant → não deveria ter permission via user default,
    // mas o bypass permite conceder qualquer coisa.
    hasPermissionSpy.mockResolvedValue(false);
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());

    const caller = await makeCaller('ADMIN', 'PLATFORM_OWNER');
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'audit:read_platform',
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('guard aplica em revoke também (não só grant)', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm !== 'audit:read'),
    );

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.revoke({
        userId: USER_IDS.diretorC,
        permission: 'audit:read',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('guard aplica em restore também', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm !== 'reports:financial'),
    );

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.restore({
        userId: USER_IDS.diretorC,
        permission: 'reports:financial',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
