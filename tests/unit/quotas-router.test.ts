// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { UserRole } from '@prisma/client';

/**
 * Sprint 15H Bloco B (Chip 2b) — testes do router `quotas`.
 *
 * Contrato: o router delega ao `QuotaService` (Chip 1b) e ao
 * `SalesUnitRepository` (Sprint 15G). Ambos são mockados — o foco é a
 * camada tRPC: Zod input, permissions (RBAC granular), kill-switch
 * `SALES_QUOTAS_ENABLED`, cross-tenant, delegação correta e audit da
 * mutation exclusiva do router (`updatePeriodType`). A semântica interna
 * (subtree ltree, agregação WON, partial UNIQUE, audit do CRUD) é escopo
 * de `quota-service.test.ts`.
 *
 * `isValidPeriod`/`periodToDateRange` são preservados REAIS (importActual)
 * porque o `periodSchema` do router usa `isValidPeriod` no refine do Zod.
 */

// ----------------- env (kill-switch) -----------------
const mockEnv = { SALES_QUOTAS_ENABLED: true } as { SALES_QUOTAS_ENABLED: boolean };
vi.mock('@/lib/env', () => ({ env: mockEnv }));

// ----------------- Prisma mock (só tenant — CRUD de metas vai pro service) -----------------
const mockTenant = {
  findFirst: vi.fn(),
  update: vi.fn(),
};
vi.mock('@/server/db/client', () => ({
  prisma: { tenant: mockTenant },
}));

// ----------------- Audit mock -----------------
const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

// ----------------- Permissions mock (RBAC granular) -----------------
const hasPermissionMock = vi.fn<(userId: string, permission: string) => Promise<boolean>>(
  async () => true,
);
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (userId: string, permission: string) => hasPermissionMock(userId, permission),
}));

// ----------------- Repository mock (Sprint 15G) -----------------
const repoGetTree = vi.fn();
vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: { getTree: (t: string) => repoGetTree(t) },
}));

// ----------------- QuotaService mock (isValidPeriod REAL preservado) -----------------
const svcList = vi.fn();
const svcCompute = vi.fn();
const svcCreate = vi.fn();
const svcUpdate = vi.fn();
const svcRemove = vi.fn();
vi.mock('@/server/services/quota.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/quota.service')>();
  return {
    ...actual, // mantém isValidPeriod + periodToDateRange reais
    QuotaService: {
      listQuotasByPeriod: (i: unknown) => svcList(i),
      computeQuotaProgress: (u: string, p: string, t: string) => svcCompute(u, p, t),
      createQuota: (i: unknown) => svcCreate(i),
      updateQuota: (i: unknown) => svcUpdate(i),
      removeQuota: (i: unknown) => svcRemove(i),
    },
  };
});

// UUIDs de fixtura (válidos pra passar Zod)
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const UUID_UNIT = '22222222-2222-2222-2222-222222222222';
const UUID_QUOTA = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

async function makeCaller(role: UserRole = 'ADMIN') {
  const { quotasRouter } = await import('@/server/trpc/routers/quotas');
  return quotasRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: TENANT_A,
    user: {
      id: ADMIN_ID,
      email: 'admin@test.co',
      fullName: 'Admin',
      role,
      tenantId: TENANT_A,
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.SALES_QUOTAS_ENABLED = true;
  hasPermissionMock.mockImplementation(async () => true);
});

// ================================================================
// listByPeriod
// ================================================================

describe('quotasRouter.listByPeriod', () => {
  it('delega ao service com tenantId + period', async () => {
    svcList.mockResolvedValueOnce([{ id: UUID_QUOTA, period: '2026-Q3' }]);

    const caller = await makeCaller();
    const out = await caller.listByPeriod({ period: '2026-Q3' });

    expect(out.length).toBe(1);
    expect(svcList).toHaveBeenCalledWith({ tenantId: TENANT_A, period: '2026-Q3' });
  });

  it('rejeita período inválido via Zod (isValidPeriod real)', async () => {
    const caller = await makeCaller();
    await expect(caller.listByPeriod({ period: '2026-13' })).rejects.toBeDefined();
    expect(svcList).not.toHaveBeenCalled();
  });
});

// ================================================================
// getByUnit — progresso
// ================================================================

describe('quotasRouter.getByUnit', () => {
  it('delega ao service.computeQuotaProgress(unitId, period, tenantId)', async () => {
    svcCompute.mockResolvedValueOnce({
      unitId: UUID_UNIT,
      unitName: 'Equipe A',
      period: '2026-Q3',
      target: 100000,
      actual: 42000,
      progressPct: 42,
    });

    const caller = await makeCaller();
    const out = await caller.getByUnit({ unitId: UUID_UNIT, period: '2026-Q3' });

    expect(out.progressPct).toBe(42);
    expect(svcCompute).toHaveBeenCalledWith(UUID_UNIT, '2026-Q3', TENANT_A);
  });

  it('sem meta configurada → target/progressPct null propagados', async () => {
    svcCompute.mockResolvedValueOnce({
      unitId: UUID_UNIT,
      unitName: 'Equipe A',
      period: '2026-Q3',
      target: null,
      actual: 42000,
      progressPct: null,
    });

    const caller = await makeCaller();
    const out = await caller.getByUnit({ unitId: UUID_UNIT, period: '2026-Q3' });

    expect(out.target).toBeNull();
    expect(out.progressPct).toBeNull();
    expect(out.actual).toBe(42000);
  });

  it('cross-tenant / unit inexistente → NOT_FOUND propagado do service', async () => {
    svcCompute.mockRejectedValueOnce(
      new TRPCError({ code: 'NOT_FOUND', message: 'Unidade não encontrada.' }),
    );

    const caller = await makeCaller();
    await expect(
      caller.getByUnit({ unitId: UUID_UNIT, period: '2026-Q3' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ================================================================
// dashboardTree
// ================================================================

describe('quotasRouter.dashboardTree', () => {
  it('enriquece cada nó da árvore com progresso do período', async () => {
    repoGetTree.mockResolvedValueOnce([
      { id: 'u1', name: 'Diretoria', path: 'root.a', depth: 1 },
      { id: 'u2', name: 'Regional', path: 'root.a.b', depth: 2 },
    ]);
    svcCompute
      .mockResolvedValueOnce({ unitId: 'u1', target: 200000, actual: 50000, progressPct: 25 })
      .mockResolvedValueOnce({ unitId: 'u2', target: null, actual: 0, progressPct: null });

    const caller = await makeCaller();
    const out = await caller.dashboardTree({ period: '2026-Q3' });

    expect(out.period).toBe('2026-Q3');
    expect(out.nodes.length).toBe(2);
    expect(out.nodes[0]!.id).toBe('u1');
    expect(out.nodes[0]!.progress.progressPct).toBe(25);
    expect(out.nodes[1]!.progress.progressPct).toBeNull();
    expect(repoGetTree).toHaveBeenCalledWith(TENANT_A);
    expect(svcCompute).toHaveBeenNthCalledWith(1, 'u1', '2026-Q3', TENANT_A);
    expect(svcCompute).toHaveBeenNthCalledWith(2, 'u2', '2026-Q3', TENANT_A);
  });

  it('árvore vazia → nodes []', async () => {
    repoGetTree.mockResolvedValueOnce([]);

    const caller = await makeCaller();
    const out = await caller.dashboardTree({ period: '2026' });

    expect(out.nodes).toEqual([]);
    expect(svcCompute).not.toHaveBeenCalled();
  });
});

// ================================================================
// create
// ================================================================

describe('quotasRouter.create', () => {
  it('delega ao service com tenantId + createdBy do ctx', async () => {
    svcCreate.mockResolvedValueOnce({ id: UUID_QUOTA, unitId: UUID_UNIT, period: '2026-Q3' });

    const caller = await makeCaller();
    const out = await caller.create({
      unitId: UUID_UNIT,
      period: '2026-Q3',
      targetValue: 100000,
      currency: 'BRL',
    });

    expect(out.id).toBe(UUID_QUOTA);
    expect(svcCreate).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      unitId: UUID_UNIT,
      period: '2026-Q3',
      targetValue: 100000,
      currency: 'BRL',
      createdBy: ADMIN_ID,
    });
  });

  it('duplicata ativa → CONFLICT propagado do service (partial UNIQUE)', async () => {
    svcCreate.mockRejectedValueOnce(
      new TRPCError({ code: 'CONFLICT', message: 'Já existe uma meta ativa...' }),
    );

    const caller = await makeCaller();
    await expect(
      caller.create({ unitId: UUID_UNIT, period: '2026-Q3', targetValue: 100000 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('recriar após soft-delete → OK (service resolve normalmente)', async () => {
    svcCreate.mockResolvedValueOnce({ id: 'novo-quota', unitId: UUID_UNIT, period: '2026-Q3' });

    const caller = await makeCaller();
    const out = await caller.create({
      unitId: UUID_UNIT,
      period: '2026-Q3',
      targetValue: 50000,
    });

    expect(out.id).toBe('novo-quota');
    // currency omitido → não força default no router (service aplica 'BRL')
    expect(svcCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: undefined, createdBy: ADMIN_ID }),
    );
  });

  it('rejeita period inválido via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.create({ unitId: UUID_UNIT, period: 'foo', targetValue: 10 }),
    ).rejects.toBeDefined();
    expect(svcCreate).not.toHaveBeenCalled();
  });

  it('rejeita targetValue negativo via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.create({ unitId: UUID_UNIT, period: '2026-Q3', targetValue: -5 }),
    ).rejects.toBeDefined();
    expect(svcCreate).not.toHaveBeenCalled();
  });
});

// ================================================================
// update
// ================================================================

describe('quotasRouter.update', () => {
  it('delega ao service com tenantId + id + campos', async () => {
    svcUpdate.mockResolvedValueOnce({ id: UUID_QUOTA, targetValue: 120000 });

    const caller = await makeCaller();
    const out = await caller.update({ id: UUID_QUOTA, targetValue: 120000 });

    expect(out.id).toBe(UUID_QUOTA);
    expect(svcUpdate).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      id: UUID_QUOTA,
      targetValue: 120000,
      currency: undefined,
    });
  });

  it('cross-tenant → NOT_FOUND propagado do service', async () => {
    svcUpdate.mockRejectedValueOnce(
      new TRPCError({ code: 'NOT_FOUND', message: 'Meta não encontrada.' }),
    );

    const caller = await makeCaller();
    await expect(
      caller.update({ id: UUID_QUOTA, targetValue: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ================================================================
// delete
// ================================================================

describe('quotasRouter.delete', () => {
  it('soft delete via service + retorna { ok: true }', async () => {
    svcRemove.mockResolvedValueOnce(undefined);

    const caller = await makeCaller();
    const out = await caller.delete({ id: UUID_QUOTA });

    expect(out.ok).toBe(true);
    expect(svcRemove).toHaveBeenCalledWith({ tenantId: TENANT_A, id: UUID_QUOTA });
  });

  it('cross-tenant → NOT_FOUND propagado do service', async () => {
    svcRemove.mockRejectedValueOnce(
      new TRPCError({ code: 'NOT_FOUND', message: 'Meta não encontrada.' }),
    );

    const caller = await makeCaller();
    await expect(caller.delete({ id: UUID_QUOTA })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ================================================================
// updatePeriodType (adminOnly)
// ================================================================

describe('quotasRouter.updatePeriodType', () => {
  it('ADMIN muda tenant.quotaPeriodType + audit com tenantIdOverride', async () => {
    mockTenant.findFirst.mockResolvedValueOnce({ quotaPeriodType: 'QUARTERLY' });
    mockTenant.update.mockResolvedValueOnce({ id: TENANT_A, quotaPeriodType: 'MONTHLY' });

    const caller = await makeCaller('ADMIN');
    const out = await caller.updatePeriodType({ periodType: 'MONTHLY' });

    expect(out.quotaPeriodType).toBe('MONTHLY');
    expect(mockTenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_A },
        data: { quotaPeriodType: 'MONTHLY' },
      }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_quota.period_type_updated',
        tableName: 'tenants',
        recordId: TENANT_A,
        tenantIdOverride: TENANT_A,
        before: { quotaPeriodType: 'QUARTERLY' },
        after: { quotaPeriodType: 'MONTHLY' },
      }),
    );
  });

  it('NOT_FOUND quando tenant não existe (não audita)', async () => {
    mockTenant.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.updatePeriodType({ periodType: 'ANNUAL' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockTenant.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('FORBIDDEN pra role não-ADMIN (adminOnlyProcedure)', async () => {
    const caller = await makeCaller('GESTOR');
    await expect(
      caller.updatePeriodType({ periodType: 'MONTHLY' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mockTenant.update).not.toHaveBeenCalled();
  });

  it('rejeita periodType inválido via Zod', async () => {
    const caller = await makeCaller('ADMIN');
    await expect(
      // @ts-expect-error — força valor fora do enum
      caller.updatePeriodType({ periodType: 'WEEKLY' }),
    ).rejects.toBeDefined();
    expect(mockTenant.update).not.toHaveBeenCalled();
  });
});

// ================================================================
// RBAC — permissions guard
// ================================================================

describe('quotasRouter RBAC', () => {
  it('FORBIDDEN sem sales_structure:read (getByUnit)', async () => {
    hasPermissionMock.mockImplementation(async (_uid, perm) => perm !== 'sales_structure:read');

    const caller = await makeCaller();
    await expect(
      caller.getByUnit({ unitId: UUID_UNIT, period: '2026-Q3' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svcCompute).not.toHaveBeenCalled();
  });

  it('FORBIDDEN sem sales_structure:manage (create)', async () => {
    hasPermissionMock.mockImplementation(async (_uid, perm) => perm !== 'sales_structure:manage');

    const caller = await makeCaller();
    await expect(
      caller.create({ unitId: UUID_UNIT, period: '2026-Q3', targetValue: 100 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svcCreate).not.toHaveBeenCalled();
  });
});

// ================================================================
// Kill-switch — SALES_QUOTAS_ENABLED
// ================================================================

describe('quotasRouter kill-switch (SALES_QUOTAS_ENABLED)', () => {
  it('flag OFF → FORBIDDEN em leitura (getByUnit), sem tocar o service', async () => {
    mockEnv.SALES_QUOTAS_ENABLED = false;

    const caller = await makeCaller();
    await expect(
      caller.getByUnit({ unitId: UUID_UNIT, period: '2026-Q3' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svcCompute).not.toHaveBeenCalled();
  });

  it('flag OFF → FORBIDDEN em mutation (create), sem tocar o service', async () => {
    mockEnv.SALES_QUOTAS_ENABLED = false;

    const caller = await makeCaller();
    await expect(
      caller.create({ unitId: UUID_UNIT, period: '2026-Q3', targetValue: 100 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svcCreate).not.toHaveBeenCalled();
  });

  it('flag OFF → FORBIDDEN em updatePeriodType (após passar o adminOnly)', async () => {
    mockEnv.SALES_QUOTAS_ENABLED = false;

    const caller = await makeCaller('ADMIN');
    await expect(
      caller.updatePeriodType({ periodType: 'MONTHLY' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockTenant.update).not.toHaveBeenCalled();
  });
});
