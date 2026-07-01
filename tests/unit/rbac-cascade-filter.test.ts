// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-12 — reports.performance respeita filtro herdado; activities.list,
//          tasks.list, documents.listByOpportunity também.
//
// A verdade: opportunity:read_others não é só sobre opps — cascateia pra
// todos os recursos que dependem de uma opp (activities, tasks, documents,
// e a agregação em reports.performance).

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
const mockActivity = { findMany: vi.fn() };
const mockTask = { findMany: vi.fn() };
const mockDocument = { findMany: vi.fn() };
const mockOpp = { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() };

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: {
    activity: mockActivity,
    task: mockTask,
    document: mockDocument,
    opportunity: mockOpp,
  },
}));

vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe.skip('AC-12 — reports.performance respeita read_others', () => {
  it('ANALISTA sem read_others: só vê própria linha + média anônima', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read' || perm === 'reports:read'),
    );
    mockOpp.groupBy.mockResolvedValueOnce([
      { ownerId: USER_IDS.analista, _count: { id: 3 }, _sum: { estimatedValue: 90000 } },
    ]);

    const { reportsRouter } = await import('@/server/trpc/routers/reports');
    const caller = reportsRouter.createCaller(
      makeCtx({ role: 'ANALISTA', userId: USER_IDS.analista }),
    );
    const result = await caller.performanceByOwner({});

    // Cada linha exposta ao ANALISTA deve ser a própria ou média
    const exposedOwnerIds = result.rows.map((r: { ownerId: string }) => r.ownerId);
    expect(exposedOwnerIds.every(
      (id: string) => id === USER_IDS.analista || id === 'average' || id === null,
    )).toBe(true);
  });

  it('ADMIN vê performance de todos os owners', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.groupBy.mockResolvedValueOnce([
      { ownerId: USER_IDS.analista, _count: { id: 3 }, _sum: { estimatedValue: 90000 } },
      { ownerId: USER_IDS.gestor, _count: { id: 5 }, _sum: { estimatedValue: 150000 } },
    ]);

    const { reportsRouter } = await import('@/server/trpc/routers/reports');
    const caller = reportsRouter.createCaller(makeCtx({ role: 'ADMIN' }));
    const result = await caller.performanceByOwner({});

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skip('AC-12 — activities.list respeita read_others da opp pai', () => {
  it('ANALISTA sem read_others tentando listar activities de opp alheia → filtrada ou 404', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    // A implementação pode: (1) 404 na verificação de opp, ou (2) list vazia
    mockOpp.findFirst.mockResolvedValueOnce(null); // opp alheia + sem read_others = não encontrada

    const { activitiesRouter } = await import(
      '@/server/trpc/routers/activities'
    );
    const caller = activitiesRouter.createCaller(
      makeCtx({ role: 'ANALISTA', userId: USER_IDS.analista }),
    );

    await expect(
      caller.list({ opportunityId: OPP_IDS.othersOwned }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ADMIN lista activities de qualquer opp do tenant', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findFirst.mockResolvedValueOnce(
      makeOpp({ id: OPP_IDS.othersOwned, ownerId: USER_IDS.gestor }),
    );
    mockActivity.findMany.mockResolvedValueOnce([]);

    const { activitiesRouter } = await import(
      '@/server/trpc/routers/activities'
    );
    const caller = activitiesRouter.createCaller(makeCtx({ role: 'ADMIN' }));
    const result = await caller.list({ opportunityId: OPP_IDS.othersOwned });

    expect(Array.isArray(result)).toBe(true);
  });
});

describe.skip('AC-12 — tasks.list respeita read_others da opp pai', () => {
  it('ANALISTA sem read_others tentando ver tasks de opp alheia → NOT_FOUND', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const { tasksRouter } = await import('@/server/trpc/routers/activities');
    const caller = tasksRouter.createCaller(
      makeCtx({ role: 'ANALISTA', userId: USER_IDS.analista }),
    );

    await expect(
      caller.list({ opportunityId: OPP_IDS.othersOwned }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe.skip('AC-12 — documents.listByOpportunity respeita read_others', () => {
  it('ANALISTA sem read_others tentando docs de opp alheia → NOT_FOUND', async () => {
    hasPermissionSpy.mockImplementation((_uid, perm) =>
      Promise.resolve(perm === 'opportunity:read'),
    );
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const { documentsRouter } = await import('@/server/trpc/routers/documents');
    const caller = documentsRouter.createCaller(
      makeCtx({ role: 'ANALISTA', userId: USER_IDS.analista }),
    );

    await expect(
      caller.listByOpportunity({ opportunityId: OPP_IDS.othersOwned }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
