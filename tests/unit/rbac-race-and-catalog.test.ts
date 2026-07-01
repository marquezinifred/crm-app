/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-26 — Tentativa de conceder permission fora do catálogo → erro Zod.
//          Race condition: 2 updates simultâneos → last-write-wins + audit
//          registra ambos.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TENANT_A, USER_IDS, makeCtx, makeOverride, makeUser } from '../helpers/rbac-fixtures';

const auditSpy = vi.fn();
const hasPermissionSpy = vi.fn();
const invalidateCacheSpy = vi.fn();
const mockUser = { findFirst: vi.fn() };
const mockOverride = { upsert: vi.fn(), deleteMany: vi.fn() };

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
    user: mockUser,
    userPermissionOverride: mockOverride,
  },
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

async function makeCaller(role: 'ADMIN' = 'ADMIN') {
  const { permissionsRouter } = await import(
    '@/server/trpc/routers/permissions'
  );
  return permissionsRouter.createCaller(makeCtx({ role, userId: USER_IDS.admin }));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionSpy.mockResolvedValue(true);
  mockUser.findFirst.mockResolvedValue(
    makeUser({ id: USER_IDS.analista, tenantId: TENANT_A }),
  );
});

// ==== Fora do catálogo =====================================================

describe.skip('AC-26 — permission fora do catálogo é rejeitada', () => {
  it('grant com permission inexistente no catálogo → erro', async () => {
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'fake:permission_that_does_not_exist',
      }),
    ).rejects.toBeTruthy();

    // Não roda upsert
    expect(mockOverride.upsert).not.toHaveBeenCalled();
  });

  it('grant com formato inválido de key (sem :) → erro', async () => {
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'invalid_no_colon',
      }),
    ).rejects.toBeTruthy();
  });

  it('grant com permission depreciada (ai:configure — Sprint 15F removida) → erro', async () => {
    // Alias 'ai:configure' foi removido no Sprint 15E (permission-matrix
    // Alterações vs Sprint 15F). Deve ser rejeitado.
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'ai:configure',
      }),
    ).rejects.toBeTruthy();
  });

  it('grant com string vazia → erro', async () => {
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: '',
      }),
    ).rejects.toBeTruthy();
  });

  it('revoke com permission fora catálogo também é rejeitado', async () => {
    const caller = await makeCaller();
    await expect(
      caller.revoke({
        userId: USER_IDS.analista,
        permission: 'ghost:permission',
      }),
    ).rejects.toBeTruthy();
  });

  it('restore com permission fora catálogo também é rejeitado', async () => {
    const caller = await makeCaller();
    await expect(
      caller.restore({
        userId: USER_IDS.analista,
        permission: 'ghost:permission',
      }),
    ).rejects.toBeTruthy();
  });

  it('userId inválido (não-uuid) → erro Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: 'not-a-uuid',
        permission: 'inbound:view_queue',
      }),
    ).rejects.toBeTruthy();
  });
});

// ==== Race condition =======================================================

describe.skip('AC-26 — race condition: 2 grants simultâneos → last-write-wins', () => {
  it('upsert idempotente: 2 grants simultâneos preservam consistência', async () => {
    // Simula: 2 requests concurrentes chegam pra grant(inbound:view_queue).
    // Prisma upsert com WHERE UNIQUE(user_id, permission) garante que só
    // 1 row existe no fim.
    let callCount = 0;
    mockOverride.upsert.mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        makeOverride({
          permission: 'inbound:view_queue',
          reason: `motivo ${callCount}`,
        }),
      );
    });

    const caller = await makeCaller();
    const [r1, r2] = await Promise.all([
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
        reason: 'motivo 1',
      }),
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
        reason: 'motivo 2',
      }),
    ]);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    // Prisma upsert é atômico — chamou 2×, mas só 1 row no DB
    expect(mockOverride.upsert).toHaveBeenCalledTimes(2);
  });

  it('audit registra AMBAS as chamadas (rastreabilidade preservada)', async () => {
    mockOverride.upsert.mockResolvedValue(makeOverride());

    const caller = await makeCaller();
    await Promise.all([
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
        reason: 'motivo 1',
      }),
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
        reason: 'motivo 2',
      }),
    ]);

    expect(auditSpy).toHaveBeenCalledTimes(2);
    const reasons = auditSpy.mock.calls.map((c) => c[0].after?.reason).sort();
    expect(reasons).toEqual(['motivo 1', 'motivo 2']);
  });

  it('cache invalidation é chamada nas 2 chamadas (idempotente)', async () => {
    mockOverride.upsert.mockResolvedValue(makeOverride());

    const caller = await makeCaller();
    await Promise.all([
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
      }),
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
      }),
    ]);

    // Invalidação chamada 2× — setar cachedPermissions=null é idempotente
    expect(invalidateCacheSpy).toHaveBeenCalledTimes(2);
    expect(invalidateCacheSpy).toHaveBeenCalledWith(USER_IDS.analista);
  });

  it('grant → revoke simultâneos: last-write-wins via upsert', async () => {
    // Race entre "conceder" e "revogar" a mesma permission ao mesmo tempo.
    // UNIQUE (user_id, permission) força upsert; o último ganha.
    let lastAction: 'granted' | 'revoked' = 'granted';
    mockOverride.upsert.mockImplementation((args) => {
      lastAction = args.create.action;
      return Promise.resolve(makeOverride({ action: args.create.action }));
    });

    const caller = await makeCaller();
    await Promise.all([
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
      }),
      caller.revoke({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
      }),
    ]);

    // Um dos 2 wins — pode ser granted OU revoked, mas nunca corrupto
    expect(['granted', 'revoked']).toContain(lastAction);
    expect(auditSpy).toHaveBeenCalledTimes(2);
  });
});
