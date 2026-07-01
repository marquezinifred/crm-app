/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-09 — opportunities.list: ANALISTA sem override vê só ownerId===userId;
//          ADMIN grant opportunity:read_others → passa a ver tudo.
// AC-10 — opportunities.byId de opp alheia sem read_others → 404
//          (não 403 — evita enumeration).
// AC-11 — opportunities.count respeita mesmo filtro que list.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeCtx,
  makeOpp,
  OPP_IDS,
  TENANT_A,
  USER_IDS,
} from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();
const mockOpp = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
};

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: { opportunity: mockOpp },
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

async function makeCaller(role: 'ANALISTA' | 'ADMIN' | 'GESTOR' = 'ANALISTA') {
  const { opportunitiesRouter } = await import(
    '@/server/trpc/routers/opportunities'
  );
  return opportunitiesRouter.createCaller(makeCtx({ role, userId: USER_IDS.analista }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.skip('AC-09 — opportunities.list respeita opportunity:read_others', () => {
  it('ANALISTA sem read_others: query filtra por ownerId = ctx.user.id', async () => {
    // opportunity:read = true, opportunity:read_others = false
    hasPermissionSpy.mockImplementation((_userId, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ANALISTA');
    await caller.list({});

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      tenantId: TENANT_A,
      ownerId: USER_IDS.analista,
    });
  });

  it('ANALISTA com override granted read_others: query NÃO filtra por owner', async () => {
    // Ambos true (default + override granted)
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ANALISTA');
    await caller.list({});

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({ tenantId: TENANT_A });
    expect(call.where.ownerId).toBeUndefined();
  });

  it('ADMIN vê tudo por default (read_others incluído)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ADMIN');
    await caller.list({});

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.ownerId).toBeUndefined();
  });

  it('kanban aplica mesmo filtro que list', async () => {
    hasPermissionSpy.mockImplementation((_userId, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ANALISTA');
    await caller.kanban({});

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.ownerId).toBe(USER_IDS.analista);
  });
});

describe.skip('AC-10 — opportunities.byId de opp alheia → 404 (não 403)', () => {
  it('ANALISTA sem read_others acessando opp própria → 200', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findFirst.mockResolvedValueOnce(
      makeOpp({ id: OPP_IDS.mineOwned, ownerId: USER_IDS.analista }),
    );

    const caller = await makeCaller('ANALISTA');
    const result = await caller.byId({ id: OPP_IDS.mineOwned });
    expect(result.id).toBe(OPP_IDS.mineOwned);
  });

  it('ANALISTA sem read_others acessando opp alheia → NOT_FOUND', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findFirst.mockResolvedValueOnce(
      makeOpp({ id: OPP_IDS.othersOwned, ownerId: USER_IDS.gestor }),
    );

    const caller = await makeCaller('ANALISTA');
    await expect(
      caller.byId({ id: OPP_IDS.othersOwned }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Explicitamente NÃO é FORBIDDEN — evita enumeration
  });

  it('ANALISTA com override read_others acessando opp alheia → 200', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findFirst.mockResolvedValueOnce(
      makeOpp({ id: OPP_IDS.othersOwned, ownerId: USER_IDS.gestor }),
    );

    const caller = await makeCaller('ANALISTA');
    const result = await caller.byId({ id: OPP_IDS.othersOwned });
    expect(result.id).toBe(OPP_IDS.othersOwned);
  });

  it('opp de outro tenant → NOT_FOUND (findFirst com tenantId filter retorna null)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.byId({ id: OPP_IDS.crossTenant }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('opp soft-deleted → NOT_FOUND', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findFirst.mockResolvedValueOnce(null); // deletedAt filter no where

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.byId({ id: OPP_IDS.softDeleted }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe.skip('AC-11 — opportunities.count respeita mesmo filtro que list', () => {
  it('ANALISTA sem read_others: count com ownerId filter', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.count.mockResolvedValueOnce(3);

    const caller = await makeCaller('ANALISTA');
    const total = await caller.count({});

    expect(total).toBe(3);
    const call = mockOpp.count.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      tenantId: TENANT_A,
      ownerId: USER_IDS.analista,
    });
  });

  it('ADMIN: count sem ownerId filter (vê tudo)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.count.mockResolvedValueOnce(42);

    const caller = await makeCaller('ADMIN');
    const total = await caller.count({});

    expect(total).toBe(42);
    const call = mockOpp.count.mock.calls[0]![0]!;
    expect(call.where.ownerId).toBeUndefined();
  });

  it('count e list retornam o mesmo total (consistência)', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    const myOpps = [
      makeOpp({ id: 'a', ownerId: USER_IDS.analista }),
      makeOpp({ id: 'b', ownerId: USER_IDS.analista }),
    ];
    mockOpp.findMany.mockResolvedValueOnce(myOpps);
    mockOpp.count.mockResolvedValueOnce(2);

    const caller = await makeCaller('ANALISTA');
    const list = await caller.list({});
    const total = await caller.count({});

    expect(list.length).toBe(total);
  });
});
