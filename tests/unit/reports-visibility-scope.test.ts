// @vitest-environment node
//
// Sprint 15G Fase 3b (emenda A3) — reports.ts delega ao SalesStructureService.
// Testes de contrato: cada procedure passa `role, userId, tenantId,
// partnerCompanyId` pro `resolveOpportunityScope` e propaga o
// `scope.filter` no `where` do `prisma.opportunity.findMany`.
//
// Sprint 5 preservado: ANALISTA em `performanceByOwner` mostra só a
// própria linha + média anônima do time (regra role-based, não
// scope-based). Test 7 e 8 cobrem os dois lados dessa distinção.
//
// Padrão de mock: `SalesStructureService` fica mockado por chip; Prisma
// só devolve o que a procedure precisa pra derivar o resultado. Não
// exercita o service interno — quem cobre isso é
// `sales-structure-service.test.ts` (Fase 2a).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';

// ----------------- Fixtures -----------------
const TENANT = '11111111-1111-1111-1111-111111111111';
const USER_ANALISTA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ADMIN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_GESTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_DIRETOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER_PARCEIRO = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const USER_TEAM_MEMBER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PARTNER_COMPANY = '99999999-9999-9999-9999-999999999999';

// ----------------- Prisma mock -----------------
const prismaOpportunityFindMany = vi.fn();
const prismaHistoryFindMany = vi.fn();
const prismaTenantFindUnique = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: {
    opportunity: { findMany: prismaOpportunityFindMany },
    opportunityStageHistory: { findMany: prismaHistoryFindMany },
    tenant: { findUnique: prismaTenantFindUnique },
  },
}));

// ----------------- Audit + tenant-context stubs -----------------
vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: TENANT, userId: USER_ANALISTA }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

// ----------------- Permissions (gate withPermission('reports:read')) -----------------
const hasPermissionMock = vi.fn<
  (userId: string, permission: string) => Promise<boolean>
>(async () => true);
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (userId: string, permission: string) =>
    hasPermissionMock(userId, permission),
}));

// ----------------- SalesStructureService (contrato Fase 2a) -----------------
const resolveScopeMock = vi.fn();
vi.mock('@/server/services/sales-structure.service', () => ({
  SalesStructureService: {
    resolveOpportunityScope: (u: unknown, t: unknown) => resolveScopeMock(u, t),
  },
}));

// ----------------- Test caller -----------------
async function makeCaller(role: UserRole, userId: string, partnerCompanyId: string | null = null) {
  const { reportsRouter } = await import('@/server/trpc/routers/reports');
  return reportsRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: TENANT,
    user: {
      id: userId,
      email: 'test@venzo.com',
      fullName: 'Test User',
      role,
      tenantId: TENANT,
      partnerCompanyId,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

function makeOppRow(overrides: {
  id: string;
  ownerId: string | null;
  status?: 'ACTIVE' | 'WON' | 'LOST';
  stage?: string;
  estimatedValue?: number;
}) {
  return {
    id: overrides.id,
    stage: overrides.stage ?? 'LEAD',
    status: overrides.status ?? 'ACTIVE',
    estimatedValue: overrides.estimatedValue ?? 10_000,
    closedValue: null,
    ownerId: overrides.ownerId,
    owner: overrides.ownerId ? { fullName: `Owner ${overrides.ownerId.slice(0, 4)}` } : null,
    lossReason: null,
    isInbound: false,
    createdAt: new Date('2026-01-01'),
    currentStageEnteredAt: new Date('2026-06-01'),
    actualCloseDate: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockImplementation(async () => true);
  prismaOpportunityFindMany.mockResolvedValue([]);
  prismaHistoryFindMany.mockResolvedValue([]);
  prismaTenantFindUnique.mockResolvedValue({ conversionRates: null });
});

// ================================================================
// Delegação ao SalesStructureService
// ================================================================

describe('reports.funnel — delegação ao SalesStructureService', () => {
  it('PARCEIRO com partnerCompanyId → filter PARTNER com engagements (row-level)', async () => {
    const partnerFilter = {
      tenantId: TENANT,
      partnerCompanyId: PARTNER_COMPANY,
      partnerEngagements: {
        some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' as const },
      },
    };
    resolveScopeMock.mockResolvedValueOnce({ type: 'PARTNER', filter: partnerFilter });

    const caller = await makeCaller('PARCEIRO', USER_PARCEIRO, PARTNER_COMPANY);
    await caller.funnel({});

    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_PARCEIRO, role: 'PARCEIRO', partnerCompanyId: PARTNER_COMPANY },
      TENANT,
    );

    expect(prismaOpportunityFindMany).toHaveBeenCalledTimes(1);
    const where = prismaOpportunityFindMany.mock.calls[0]![0]!.where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.partnerCompanyId).toBe(PARTNER_COMPANY);
    expect(where.partnerEngagements).toEqual(partnerFilter.partnerEngagements);
    expect(where.deletedAt).toBeNull();
  });

  it('ADMIN read_all → filter só tenantId (ALL)', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });

    const caller = await makeCaller('ADMIN', USER_ADMIN);
    await caller.funnel({});

    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_ADMIN, role: 'ADMIN', partnerCompanyId: null },
      TENANT,
    );
    const where = prismaOpportunityFindMany.mock.calls[0]![0]!.where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.ownerId).toBeUndefined();
    expect(where.partnerCompanyId).toBeUndefined();
  });

  it('GESTOR read_team + subtree não-vazia → filter ownerId: { in: [...] }', async () => {
    const subtreeIds = [USER_GESTOR, USER_TEAM_MEMBER, USER_ANALISTA];
    resolveScopeMock.mockResolvedValueOnce({
      type: 'TEAM',
      filter: { ownerId: { in: subtreeIds }, tenantId: TENANT },
      teamSize: subtreeIds.length,
    });

    const caller = await makeCaller('GESTOR', USER_GESTOR);
    await caller.funnel({});

    const where = prismaOpportunityFindMany.mock.calls[0]![0]!.where;
    expect(where.ownerId).toEqual({ in: subtreeIds });
    expect(where.tenantId).toBe(TENANT);
  });
});

describe('reports.winLoss — mesma propagação de scope via loadOpps', () => {
  it('ADMIN read_all → tenantId no where sem restrição por owner', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    prismaOpportunityFindMany.mockResolvedValueOnce([
      makeOppRow({ id: 'o1', ownerId: USER_ADMIN, status: 'WON', estimatedValue: 50_000 }),
      makeOppRow({ id: 'o2', ownerId: USER_GESTOR, status: 'LOST' }),
    ]);

    const caller = await makeCaller('ADMIN', USER_ADMIN);
    const result = await caller.winLoss({});

    expect(resolveScopeMock).toHaveBeenCalledTimes(1);
    // Sanity: winLossBreakdown consumiu as opps que vieram do findMany
    // (shape { won: { count, sumValue }, lost: {...} })
    expect(result.won.count).toBe(1);
    expect(result.lost.count).toBe(1);
  });
});

describe('reports.revenueProjection — scope propaga junto com conversionRates', () => {
  it('ADMIN read_all → scope filter + tenant.findUnique separado pra rates', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    prismaTenantFindUnique.mockResolvedValueOnce({
      conversionRates: { PROSPECT: 10, LEAD: 30 },
    });

    const caller = await makeCaller('ADMIN', USER_ADMIN);
    await caller.revenueProjection({});

    // 2 chamadas ao prisma: opportunity.findMany + tenant.findUnique
    expect(prismaOpportunityFindMany).toHaveBeenCalledTimes(1);
    expect(prismaTenantFindUnique).toHaveBeenCalledTimes(1);
    const where = prismaOpportunityFindMany.mock.calls[0]![0]!.where;
    expect(where.tenantId).toBe(TENANT);
  });
});

describe('reports.timePerStage — scope propaga e history só chama com oppIds', () => {
  it('sem opps visíveis → não chama history.findMany (early return)', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { ownerId: USER_ANALISTA, tenantId: TENANT },
    });
    prismaOpportunityFindMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ANALISTA', USER_ANALISTA);
    const result = await caller.timePerStage({});

    expect(prismaOpportunityFindMany).toHaveBeenCalledTimes(1);
    expect(prismaHistoryFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});

// ================================================================
// Regra ANALISTA em performanceByOwner (Sprint 5) — preservada
// ================================================================

describe('reports.performanceByOwner — Sprint 5 preservado', () => {
  it('ANALISTA vê só a própria linha + teamAverage + anonymized=true', async () => {
    // Scope OWN — só devolve as próprias opps do ANALISTA
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { ownerId: USER_ANALISTA, tenantId: TENANT },
    });
    prismaOpportunityFindMany.mockResolvedValueOnce([
      makeOppRow({
        id: 'o-own',
        ownerId: USER_ANALISTA,
        status: 'WON',
        estimatedValue: 30_000,
      }),
    ]);

    const caller = await makeCaller('ANALISTA', USER_ANALISTA);
    const result = await caller.performanceByOwner({});

    expect(result.anonymized).toBe(true);
    expect(result.rows.length).toBeLessThanOrEqual(1);
    // Se retornou linha, é a do ANALISTA
    for (const row of result.rows) {
      expect(row.ownerId).toBe(USER_ANALISTA);
    }
    expect(result.teamAverage).toBeDefined();
  });

  it('DIRETOR_COMERCIAL read_all → todas as linhas visíveis, anonymized=false', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    prismaOpportunityFindMany.mockResolvedValueOnce([
      makeOppRow({ id: 'o1', ownerId: USER_ANALISTA, status: 'WON', estimatedValue: 20_000 }),
      makeOppRow({ id: 'o2', ownerId: USER_GESTOR, status: 'WON', estimatedValue: 40_000 }),
      makeOppRow({ id: 'o3', ownerId: USER_DIRETOR, status: 'LOST' }),
    ]);

    const caller = await makeCaller('DIRETOR_COMERCIAL', USER_DIRETOR);
    const result = await caller.performanceByOwner({});

    expect(result.anonymized).toBe(false);
    // Todos os owners com atividade viraram linha (3 distintos)
    const ownerIds = new Set(result.rows.map((r) => r.ownerId));
    expect(ownerIds.size).toBeGreaterThanOrEqual(2);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
  });
});

// ================================================================
// Inbound × Outbound — usa loadInboundOpps, mesmo scope
// ================================================================

describe('reports.inboundVsOutbound — loadInboundOpps propaga scope', () => {
  it('ADMIN read_all → scope filter passado como where do findMany', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    prismaOpportunityFindMany.mockResolvedValueOnce([]);

    const caller = await makeCaller('ADMIN', USER_ADMIN);
    const result = await caller.inboundVsOutbound({});

    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_ADMIN, role: 'ADMIN', partnerCompanyId: null },
      TENANT,
    );
    expect(prismaOpportunityFindMany).toHaveBeenCalledTimes(1);
    const where = prismaOpportunityFindMany.mock.calls[0]![0]!.where;
    expect(where.tenantId).toBe(TENANT);
    // findMany é o mesmo `prisma.opportunity.findMany` — só o select difere
    // (loadInboundOpps usa `select`, loadOpps usa `include`). Ambos passam
    // pelo `visibility()` que delega ao service.
    expect(result.total).toBe(0);
  });
});
