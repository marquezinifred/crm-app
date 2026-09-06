// @vitest-environment node
//
// Sprint 15H Bloco B (Chip 1b) — Service base de Metas por Unidade.
// Cobre `periodToDateRange`/`isValidPeriod` (puros), `computeQuotaProgress`
// (soma WON no subtree, período, sem meta, multi-tenant) e o CRUD base
// (create/update/list/remove com soft delete + cross-tenant + audit).
// Mocks fazem o teste puro (sem Postgres), alinhado ao padrão do
// `sales-structure-service.test.ts` (vi.hoisted + mock de prisma/repo/audit).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

const { mockPrisma, getSubtreeByUnitMock, auditMock } = vi.hoisted(() => ({
  mockPrisma: {
    salesUnit: { findFirst: vi.fn() },
    salesQuota: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    opportunity: { aggregate: vi.fn() },
  },
  getSubtreeByUnitMock: vi.fn(),
  auditMock: vi.fn(async () => undefined),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: { getSubtreeMemberIdsByUnit: getSubtreeByUnitMock },
}));
vi.mock('@/server/services/audit.service', () => ({ audit: auditMock }));

import {
  QuotaService,
  periodToDateRange,
  isValidPeriod,
} from '@/server/services/quota.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const UNIT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const QUOTA = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('periodToDateRange (puro)', () => {
  it('trimestre Q1 → jan-mar', () => {
    const { start, end } = periodToDateRange('2026-Q1');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('trimestre Q3 → jul-set', () => {
    const { start, end } = periodToDateRange('2026-Q3');
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });

  it('mês 2026-02 → fev inteiro (28 dias)', () => {
    const { start, end } = periodToDateRange('2026-02');
    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('semestre H2 → jul-dez', () => {
    const { start, end } = periodToDateRange('2026-H2');
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('anual → jan-dez', () => {
    const { start, end } = periodToDateRange('2026');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('formato inválido lança BAD_REQUEST', () => {
    expect(() => periodToDateRange('2026-Q5')).toThrowError(TRPCError);
    expect(() => periodToDateRange('2026-13')).toThrowError(TRPCError);
    expect(() => periodToDateRange('lixo')).toThrowError(TRPCError);
  });
});

describe('isValidPeriod (puro)', () => {
  it('aceita os 4 formatos', () => {
    expect(isValidPeriod('2026-Q4')).toBe(true);
    expect(isValidPeriod('2026-12')).toBe(true);
    expect(isValidPeriod('2026-H1')).toBe(true);
    expect(isValidPeriod('2026')).toBe(true);
  });
  it('rejeita formatos errados', () => {
    expect(isValidPeriod('2026-Q0')).toBe(false);
    expect(isValidPeriod('2026-00')).toBe(false);
    expect(isValidPeriod('26-Q1')).toBe(false);
    expect(isValidPeriod('')).toBe(false);
  });
});

describe('QuotaService.computeQuotaProgress', () => {
  it('unit inexistente no tenant → NOT_FOUND', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue(null);
    await expect(
      QuotaService.computeQuotaProgress(UNIT, '2026-Q1', TENANT),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSubtreeByUnitMock).not.toHaveBeenCalled();
  });

  it('subtree vazio → actual 0 e não consulta aggregate', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT, name: 'Equipe SP' });
    getSubtreeByUnitMock.mockResolvedValue([]);
    mockPrisma.salesQuota.findFirst.mockResolvedValue(null);

    const res = await QuotaService.computeQuotaProgress(UNIT, '2026-Q1', TENANT);

    expect(res.actual).toBe(0);
    expect(res.target).toBeNull();
    expect(res.progressPct).toBeNull();
    expect(res.unitName).toBe('Equipe SP');
    expect(mockPrisma.opportunity.aggregate).not.toHaveBeenCalled();
  });

  it('soma WON no subtree com meta → progressPct', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT, name: 'Equipe SP' });
    getSubtreeByUnitMock.mockResolvedValue([USER_A, USER_B]);
    mockPrisma.opportunity.aggregate.mockResolvedValue({
      _sum: { closedValue: 75000 },
    });
    mockPrisma.salesQuota.findFirst.mockResolvedValue({ targetValue: 100000 });

    const res = await QuotaService.computeQuotaProgress(UNIT, '2026-Q1', TENANT);

    expect(res.actual).toBe(75000);
    expect(res.target).toBe(100000);
    expect(res.progressPct).toBe(75);
    // aggregate filtra por tenant + membros do subtree + WON + range do período
    const args = mockPrisma.opportunity.aggregate.mock.calls[0]![0];
    expect(args.where.tenantId).toBe(TENANT);
    expect(args.where.ownerId).toEqual({ in: [USER_A, USER_B] });
    expect(args.where.status).toBe('WON');
    expect(args.where.actualCloseDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(args.where.actualCloseDate.lte.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('meta com target 0 → progressPct null (evita divisão por zero)', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT, name: 'Equipe SP' });
    getSubtreeByUnitMock.mockResolvedValue([USER_A]);
    mockPrisma.opportunity.aggregate.mockResolvedValue({ _sum: { closedValue: 5000 } });
    mockPrisma.salesQuota.findFirst.mockResolvedValue({ targetValue: 0 });

    const res = await QuotaService.computeQuotaProgress(UNIT, '2026-Q1', TENANT);
    expect(res.target).toBe(0);
    expect(res.progressPct).toBeNull();
    expect(res.actual).toBe(5000);
  });

  it('_sum null (nenhuma WON) → actual 0', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT, name: 'Equipe SP' });
    getSubtreeByUnitMock.mockResolvedValue([USER_A]);
    mockPrisma.opportunity.aggregate.mockResolvedValue({ _sum: { closedValue: null } });
    mockPrisma.salesQuota.findFirst.mockResolvedValue({ targetValue: 100000 });

    const res = await QuotaService.computeQuotaProgress(UNIT, '2026-Q1', TENANT);
    expect(res.actual).toBe(0);
    expect(res.progressPct).toBe(0);
  });

  it('multi-tenant: findFirst da unit e do quota + subtree usam o tenant do argumento', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT, name: 'U' });
    getSubtreeByUnitMock.mockResolvedValue([]);
    mockPrisma.salesQuota.findFirst.mockResolvedValue(null);

    await QuotaService.computeQuotaProgress(UNIT, '2026-Q1', OTHER_TENANT);

    expect(mockPrisma.salesUnit.findFirst.mock.calls[0]![0].where.tenantId).toBe(OTHER_TENANT);
    expect(getSubtreeByUnitMock).toHaveBeenCalledWith(UNIT, OTHER_TENANT);
    expect(mockPrisma.salesQuota.findFirst.mock.calls[0]![0].where.tenantId).toBe(OTHER_TENANT);
  });
});

describe('QuotaService.createQuota', () => {
  it('happy → cria e audita com tenantIdOverride', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT });
    mockPrisma.salesQuota.findFirst.mockResolvedValue(null);
    mockPrisma.salesQuota.create.mockResolvedValue({
      id: QUOTA,
      unitId: UNIT,
      period: '2026-Q1',
      targetValue: 100000,
      currency: 'BRL',
    });

    const res = await QuotaService.createQuota({
      tenantId: TENANT,
      unitId: UNIT,
      period: '2026-Q1',
      targetValue: 100000,
      createdBy: USER_A,
    });

    expect(res.id).toBe(QUOTA);
    const createArgs = mockPrisma.salesQuota.create.mock.calls[0]![0];
    expect(createArgs.data.tenantId).toBe(TENANT);
    expect(createArgs.data.currency).toBe('BRL');
    expect(createArgs.data.createdBy).toBe(USER_A);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_quota.created',
        tableName: 'sales_quotas',
        tenantIdOverride: TENANT,
        recordId: QUOTA,
      }),
    );
  });

  it('período inválido → BAD_REQUEST (não toca no banco)', async () => {
    await expect(
      QuotaService.createQuota({
        tenantId: TENANT,
        unitId: UNIT,
        period: '2026-Q9',
        targetValue: 100,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.salesUnit.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.salesQuota.create).not.toHaveBeenCalled();
  });

  it('target negativo → BAD_REQUEST', async () => {
    await expect(
      QuotaService.createQuota({
        tenantId: TENANT,
        unitId: UNIT,
        period: '2026-Q1',
        targetValue: -1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.salesQuota.create).not.toHaveBeenCalled();
  });

  it('unit de outro tenant → NOT_FOUND', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue(null);
    await expect(
      QuotaService.createQuota({
        tenantId: TENANT,
        unitId: UNIT,
        period: '2026-Q1',
        targetValue: 100,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockPrisma.salesQuota.create).not.toHaveBeenCalled();
  });

  it('meta ativa duplicada (tenant,unit,period) → CONFLICT', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValue({ id: UNIT });
    mockPrisma.salesQuota.findFirst.mockResolvedValue({ id: QUOTA });
    await expect(
      QuotaService.createQuota({
        tenantId: TENANT,
        unitId: UNIT,
        period: '2026-Q1',
        targetValue: 100,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mockPrisma.salesQuota.create).not.toHaveBeenCalled();
  });
});

describe('QuotaService.updateQuota', () => {
  it('cross-tenant → NOT_FOUND', async () => {
    mockPrisma.salesQuota.findFirst.mockResolvedValue(null);
    await expect(
      QuotaService.updateQuota({ tenantId: OTHER_TENANT, id: QUOTA, targetValue: 5 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockPrisma.salesQuota.update).not.toHaveBeenCalled();
  });

  it('happy → atualiza target e audita before/after', async () => {
    mockPrisma.salesQuota.findFirst.mockResolvedValue({
      id: QUOTA,
      targetValue: 100000,
      currency: 'BRL',
    });
    mockPrisma.salesQuota.update.mockResolvedValue({
      id: QUOTA,
      targetValue: 120000,
      currency: 'BRL',
    });

    await QuotaService.updateQuota({ tenantId: TENANT, id: QUOTA, targetValue: 120000 });

    expect(mockPrisma.salesQuota.update.mock.calls[0]![0]!.data).toEqual({
      targetValue: 120000,
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_quota.updated',
        tenantIdOverride: TENANT,
        before: { targetValue: 100000, currency: 'BRL' },
        after: { targetValue: 120000, currency: 'BRL' },
      }),
    );
  });

  it('target negativo → BAD_REQUEST', async () => {
    mockPrisma.salesQuota.findFirst.mockResolvedValue({
      id: QUOTA,
      targetValue: 1,
      currency: 'BRL',
    });
    await expect(
      QuotaService.updateQuota({ tenantId: TENANT, id: QUOTA, targetValue: -5 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.salesQuota.update).not.toHaveBeenCalled();
  });
});

describe('QuotaService.listQuotasByPeriod', () => {
  it('filtra tenant + period + deletedAt null', async () => {
    mockPrisma.salesQuota.findMany.mockResolvedValue([{ id: QUOTA }]);
    const res = await QuotaService.listQuotasByPeriod({ tenantId: TENANT, period: '2026-Q1' });
    expect(res).toHaveLength(1);
    expect(mockPrisma.salesQuota.findMany.mock.calls[0]![0]!.where).toEqual({
      tenantId: TENANT,
      period: '2026-Q1',
      deletedAt: null,
    });
  });
});

describe('QuotaService.removeQuota', () => {
  it('soft delete seta deletedAt + audita', async () => {
    mockPrisma.salesQuota.findFirst.mockResolvedValue({
      id: QUOTA,
      unitId: UNIT,
      period: '2026-Q1',
    });
    mockPrisma.salesQuota.update.mockResolvedValue({ id: QUOTA });

    await QuotaService.removeQuota({ tenantId: TENANT, id: QUOTA });

    const updateArgs = mockPrisma.salesQuota.update.mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: QUOTA });
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_quota.deleted',
        tenantIdOverride: TENANT,
        recordId: QUOTA,
      }),
    );
  });

  it('cross-tenant / inexistente → NOT_FOUND', async () => {
    mockPrisma.salesQuota.findFirst.mockResolvedValue(null);
    await expect(
      QuotaService.removeQuota({ tenantId: OTHER_TENANT, id: QUOTA }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockPrisma.salesQuota.update).not.toHaveBeenCalled();
  });
});
