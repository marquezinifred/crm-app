// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';

/**
 * Sprint 15G Fase 3a — testes de visibilidade em opportunities.ts.
 *
 * O router agora delega a `SalesStructureService.resolveOpportunityScope`.
 * Aqui mockamos o service (contrato do Fase 2a) e verificamos que:
 *  - Cada procedure (list/kanban/byId) chama o service com
 *    `{id, role, partnerCompanyId}` + `tenantId`.
 *  - O `scope.filter` retornado entra na query via `AND: [scopeFilter]`,
 *    preservando composição com filtros de user input SEM permitir
 *    override de chaves protegidas (ownerId, partnerCompanyId).
 *  - Kill-switch OFF (mock devolvendo fallback binário) mantém o formato
 *    de composição — o router só delega, não muda de shape.
 */

// ---- Prisma mocks (padrão do rbac-opportunities-visibility.test.ts) ---
const mockOpp = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { opportunity: mockOpp },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'user-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

// Audit no-op — não é foco aqui
vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

// Todas as permission checks passam — RBAC não é foco (é foco de outro chip)
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: vi.fn(async () => true),
}));

// ---- Service mock — foco deste chip -----------------------------------
const resolveScopeMock = vi.fn();
vi.mock('@/server/services/sales-structure.service', () => ({
  SalesStructureService: {
    resolveOpportunityScope: (u: unknown, t: unknown) => resolveScopeMock(u, t),
  },
}));

// ---- Constants --------------------------------------------------------
const TENANT = 'tenant-A';
const USER_ANALISTA = '11111111-1111-1111-1111-111111111111';
const USER_GESTOR = '22222222-2222-2222-2222-222222222222';
const USER_ADMIN = '33333333-3333-3333-3333-333333333333';
const USER_PARCEIRO = '44444444-4444-4444-4444-444444444444';
const PARTNER_COMPANY = '55555555-5555-5555-5555-555555555555';
const OTHER_USER = '66666666-6666-6666-6666-666666666666';
const OPP_ID = '77777777-7777-7777-7777-777777777777';
const CLIENT_COMPANY = '88888888-8888-8888-8888-888888888888';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function makeCtx(overrides: {
  userId?: string;
  role?: UserRole;
  partnerCompanyId?: string | null;
}) {
  const userId = overrides.userId ?? USER_ANALISTA;
  const role = overrides.role ?? ('ANALISTA' as UserRole);
  return {
    req: new Request('http://localhost/test'),
    tenantId: TENANT,
    user: {
      id: userId,
      email: 'user@test.co',
      fullName: 'User',
      role,
      tenantId: TENANT,
      partnerCompanyId: overrides.partnerCompanyId ?? null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  };
}

async function makeCaller(ctxOverrides: Parameters<typeof makeCtx>[0] = {}) {
  const { opportunitiesRouter } = await import(
    '@/server/trpc/routers/opportunities'
  );
  return opportunitiesRouter.createCaller(makeCtx(ctxOverrides));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// list — delegação + composição via AND
// =====================================================================

describe('opportunities.list — delegação a resolveOpportunityScope', () => {
  it('ADMIN + read_all → scope ALL, filter tem só tenantId, AND wrapper preservado', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_ADMIN, role: 'ADMIN' as UserRole });
    await caller.list({ page: 1, pageSize: 50 });

    // Service chamado com shape exato
    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_ADMIN, role: 'ADMIN', partnerCompanyId: null },
      TENANT,
    );

    // Query montada com AND: [scopeFilter]
    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([{ tenantId: TENANT }]);
    expect(call.where.deletedAt).toBeNull();
  });

  it('GESTOR + read_team → scope TEAM, filter tem ownerId IN subtree', async () => {
    const subtree = [USER_GESTOR, USER_ANALISTA, OTHER_USER];
    resolveScopeMock.mockResolvedValueOnce({
      type: 'TEAM',
      filter: { tenantId: TENANT, ownerId: { in: subtree } },
      teamSize: subtree.length,
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_GESTOR, role: 'GESTOR' as UserRole });
    await caller.list({ page: 1, pageSize: 50 });

    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_GESTOR, role: 'GESTOR', partnerCompanyId: null },
      TENANT,
    );

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: { in: subtree } },
    ]);
  });

  it('ANALISTA sem overrides → scope OWN, filter tem ownerId=self', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { tenantId: TENANT, ownerId: USER_ANALISTA },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_ANALISTA, role: 'ANALISTA' as UserRole });
    await caller.list({ page: 1, pageSize: 50 });

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: USER_ANALISTA },
    ]);
  });

  it('PARCEIRO com partnerCompanyId → scope PARTNER, filter tem engagements APPROVED', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'PARTNER',
      filter: {
        tenantId: TENANT,
        partnerCompanyId: PARTNER_COMPANY,
        partnerEngagements: {
          some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
        },
      },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({
      userId: USER_PARCEIRO,
      role: 'PARCEIRO' as UserRole,
      partnerCompanyId: PARTNER_COMPANY,
    });
    await caller.list({ page: 1, pageSize: 50 });

    // Service chamado COM partnerCompanyId no user shape (A4)
    expect(resolveScopeMock).toHaveBeenCalledWith(
      {
        id: USER_PARCEIRO,
        role: 'PARCEIRO',
        partnerCompanyId: PARTNER_COMPANY,
      },
      TENANT,
    );

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND[0]).toEqual({
      tenantId: TENANT,
      partnerCompanyId: PARTNER_COMPANY,
      partnerEngagements: {
        some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
      },
    });
  });

  it('PARCEIRO sem partnerCompanyId → scope NONE, filter tem uuid zero', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'NONE',
      filter: { tenantId: TENANT, id: ZERO_UUID },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({
      userId: USER_PARCEIRO,
      role: 'PARCEIRO' as UserRole,
      partnerCompanyId: null,
    });
    await caller.list({ page: 1, pageSize: 50 });

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, id: ZERO_UUID },
    ]);
  });

  it('compõe scope filter + input.stage + input.search preservando todos via AND + spread', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { tenantId: TENANT, ownerId: USER_ANALISTA },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_ANALISTA, role: 'ANALISTA' as UserRole });
    await caller.list({
      page: 1,
      pageSize: 50,
      stage: 'LEAD',
      search: 'Cliente Alfa',
    });

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    // scope preservado no AND
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: USER_ANALISTA },
    ]);
    // input filters no spread principal
    expect(call.where.stage).toBe('LEAD');
    expect(call.where.OR).toEqual([
      { title: { contains: 'Cliente Alfa', mode: 'insensitive' } },
      { clientCompany: { razaoSocial: { contains: 'Cliente Alfa', mode: 'insensitive' } } },
    ]);
    expect(call.where.deletedAt).toBeNull();
  });

  it('input.ownerId=X + scope OWN (ownerId=analista) — Prisma intersecção resolve zero rows', async () => {
    // Regressão do risco de spread: se scope.filter entrasse via spread,
    // input.ownerId sobrescreveria o ownerId protegido. Com AND wrapper,
    // Prisma resolve como (scope.ownerId=analista) AND (input.ownerId=X).
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { tenantId: TENANT, ownerId: USER_ANALISTA },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_ANALISTA, role: 'ANALISTA' as UserRole });
    await caller.list({
      page: 1,
      pageSize: 50,
      ownerId: OTHER_USER, // tentativa de filtrar por outro user
    });

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    // Ambos coexistem no where — Prisma resolve AND(scope.ownerId=analista, ownerId=OTHER)
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: USER_ANALISTA },
    ]);
    expect(call.where.ownerId).toBe(OTHER_USER);
    // Semantic: scope.ownerId NÃO foi sobrescrito → intersection é vazia no DB
  });
});

// =====================================================================
// kanban — mesmo pattern
// =====================================================================

describe('opportunities.kanban — delegação a resolveOpportunityScope', () => {
  it('GESTOR + read_team → scope TEAM aplicado + status ACTIVE + composição via AND', async () => {
    const subtree = [USER_GESTOR, USER_ANALISTA];
    resolveScopeMock.mockResolvedValueOnce({
      type: 'TEAM',
      filter: { tenantId: TENANT, ownerId: { in: subtree } },
      teamSize: subtree.length,
    });
    mockOpp.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller({ userId: USER_GESTOR, role: 'GESTOR' as UserRole });
    await caller.kanban({});

    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: USER_GESTOR, role: 'GESTOR', partnerCompanyId: null },
      TENANT,
    );

    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: { in: subtree } },
    ]);
    expect(call.where.status).toBe('ACTIVE');
    expect(call.where.deletedAt).toBeNull();
  });
});

// =====================================================================
// byId — mesmo pattern
// =====================================================================

describe('opportunities.byId — delegação a resolveOpportunityScope', () => {
  it('cross-tenant (findFirst retorna null pois AND scope.tenantId ≠ opp.tenantId) → NOT_FOUND', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: TENANT },
    });
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller({ userId: USER_ADMIN, role: 'ADMIN' as UserRole });
    await expect(caller.byId({ id: OPP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Scope filter chegou no where com AND wrapper
    const call = mockOpp.findFirst.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([{ tenantId: TENANT }]);
    expect(call.where.id).toBe(OPP_ID);
    expect(call.where.deletedAt).toBeNull();
  });

  it('PARCEIRO byId opp não engajada → NOT_FOUND (scope PARTNER filtra engagements APPROVED)', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'PARTNER',
      filter: {
        tenantId: TENANT,
        partnerCompanyId: PARTNER_COMPANY,
        partnerEngagements: {
          some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
        },
      },
    });
    // Prisma resolve o filter — sem engagement APPROVED, opp não retorna
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller({
      userId: USER_PARCEIRO,
      role: 'PARCEIRO' as UserRole,
      partnerCompanyId: PARTNER_COMPANY,
    });
    await expect(caller.byId({ id: OPP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const call = mockOpp.findFirst.mock.calls[0]![0]!;
    expect(call.where.AND[0]).toMatchObject({
      partnerEngagements: {
        some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
      },
    });
  });
});

// =====================================================================
// Kill-switch — router não muda de shape (comportamento é do service)
// =====================================================================

describe('opportunities.* — kill-switch OFF é responsabilidade do service', () => {
  it('quando kill-switch OFF, service devolve fallback binário → router propaga sem mudar shape', async () => {
    // Mock do service simulando fallback pré-15G quando SALES_STRUCTURE_ENABLED=false:
    // não-PARCEIRO com nenhuma permission → OWN (mesmo shape ALL do path novo,
    // mas contendo ownerId em vez de só tenantId).
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { tenantId: TENANT, ownerId: USER_ANALISTA },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({ userId: USER_ANALISTA, role: 'ANALISTA' as UserRole });
    await caller.list({ page: 1, pageSize: 50 });

    // O router só delega — não sabe se é path novo ou fallback.
    // O que chegou do service entra direto no AND wrapper.
    const call = mockOpp.findMany.mock.calls[0]![0]!;
    expect(call.where.AND).toEqual([
      { tenantId: TENANT, ownerId: USER_ANALISTA },
    ]);
    expect(resolveScopeMock).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// Regressão P-42: byId cross-tenant volta NOT_FOUND (Prisma extension + AND wrapper)
// =====================================================================

describe('opportunities.list — count reusa o mesmo where do findMany', () => {
  it('count é chamado com o mesmo where que findMany (consistência de contagem vs listagem)', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      type: 'OWN',
      filter: { tenantId: TENANT, ownerId: USER_ANALISTA },
    });
    mockOpp.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValueOnce(0);

    const caller = await makeCaller({
      userId: USER_ANALISTA,
      role: 'ANALISTA' as UserRole,
    });
    await caller.list({
      page: 1,
      pageSize: 50,
      stage: 'PROSPECT',
      clientCompanyId: CLIENT_COMPANY,
    });

    const findManyWhere = mockOpp.findMany.mock.calls[0]![0]!.where;
    const countWhere = mockOpp.count.mock.calls[0]![0]!.where;

    // Mesma referência ou deep equal — router extrai `const where = ...` e passa
    expect(countWhere).toBe(findManyWhere);
  });
});
