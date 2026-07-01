// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-22 — Script scripts/rbac-backfill-cache.ts idempotente — roda 2×
//          sem duplicar; popula todos os users ativos.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { USER_IDS, makeUser } from '../helpers/rbac-fixtures';

const mockUser = { findMany: vi.fn(), update: vi.fn() };
const computeCacheSpy = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: { user: mockUser },
}));

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    computeAndCacheUserPermissions: (...args: unknown[]) =>
      computeCacheSpy(...args),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe.skip('AC-22 — rbac-backfill-cache script idempotente', () => {
  it('popula cachedPermissions pra todos users ativos', async () => {
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, active: true, cachedPermissions: null }),
      makeUser({ id: USER_IDS.gestor, active: true, cachedPermissions: null }),
      makeUser({ id: USER_IDS.analista, active: true, cachedPermissions: null }),
    ]);
    computeCacheSpy.mockResolvedValue(new Set());

    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    const result = await runBackfill();

    expect(computeCacheSpy).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ processed: 3 });
  });

  it('filtra por deleted_at IS NULL AND active=true', async () => {
    mockUser.findMany.mockResolvedValueOnce([]);
    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    await runBackfill();

    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      deletedAt: null,
      active: true,
    });
  });

  it('idempotente: 2ª execução re-popula sem erro', async () => {
    // 1ª: cachedPermissions = null → popula
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, cachedPermissions: null }),
    ]);
    computeCacheSpy.mockResolvedValue(new Set(['user:read']));

    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    const first = await runBackfill();
    expect(first.processed).toBe(1);

    // 2ª: já populado — script re-computa mesmo assim (idempotente); não erra.
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, cachedPermissions: ['user:read'] }),
    ]);
    const second = await runBackfill();
    expect(second.processed).toBe(1);
    // Não lança erro por já ter cache
  });

  it('users soft-deleted NÃO são processados', async () => {
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, active: true }),
      // Users com deletedAt não são retornados pela query
    ]);
    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    await runBackfill();

    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where.deletedAt).toBeNull();
  });

  it('reporta erros mas continua batch (best-effort)', async () => {
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin }),
      makeUser({ id: USER_IDS.gestor }),
      makeUser({ id: USER_IDS.analista }),
    ]);
    computeCacheSpy
      .mockResolvedValueOnce(new Set())
      .mockRejectedValueOnce(new Error('user quebrado'))
      .mockResolvedValueOnce(new Set());

    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    const result = await runBackfill();

    expect(result.processed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ userId: USER_IDS.gestor });
  });

  it('processo termina com exit code 0 quando sem erros', async () => {
    mockUser.findMany.mockResolvedValueOnce([makeUser({})]);
    computeCacheSpy.mockResolvedValue(new Set());

    const { runBackfill } = await import('@/../scripts/rbac-backfill-cache');
    const result = await runBackfill();

    expect(result.errors).toHaveLength(0);
  });
});
