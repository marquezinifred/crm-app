// @vitest-environment node
//
// Sprint 15G.5 Fase 3a — `opportunities.byId` expõe `activeTransfer`
// flag-gated (P-87). É o sinal que o dono ANALISTA (sem
// `opportunity:transfer`) consegue ler pra saber que a opp está congelada.
//
// Cobre: flag ON + currentTransfer PENDING → resumo populado; flag OFF →
// null mesmo com currentTransfer setado (T16 — badge não mente no rollback);
// sem transfer → null; status != PENDING → null; targetManager null →
// toName null; include carrega `currentTransfer`; NOT_FOUND propaga.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockEnv, hasPermissionMock, resolveScopeMock } = vi.hoisted(
  () => ({
    mockPrisma: {
      opportunity: { findFirst: vi.fn() },
    },
    mockEnv: { OPPORTUNITY_TRANSFER_ENABLED: true } as {
      OPPORTUNITY_TRANSFER_ENABLED: boolean;
    },
    hasPermissionMock: vi.fn(async () => true),
    resolveScopeMock: vi.fn(async () => ({ filter: {} })),
  }),
);

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: hasPermissionMock,
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));
vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('@/server/services/sales-structure.service', () => ({
  SalesStructureService: { resolveOpportunityScope: resolveScopeMock },
}));
vi.mock('@/server/services/opportunity-stage.service', () => ({
  advanceStage: vi.fn(),
  cancelOpportunity: vi.fn(),
  STAGE_ORDER: [],
  StageTransitionError: class extends Error {},
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const OPP_ID = '22222222-2222-2222-2222-222222222222';
const CALLER = '33333333-3333-3333-3333-333333333333';
const TRANSFER_ID = '44444444-4444-4444-4444-444444444444';
const REQUESTER = '55555555-5555-5555-5555-555555555555';
const TARGET_MGR = '66666666-6666-6666-6666-666666666666';

/** Fixture da opp devolvida pelo findFirst (com a relation currentTransfer). */
function oppRow(currentTransfer: unknown) {
  return {
    id: OPP_ID,
    tenantId: TENANT_A,
    stage: 'LEAD',
    status: 'ACTIVE',
    ownerId: REQUESTER,
    clientCompany: { razaoSocial: 'ACME' },
    clientContact: null,
    partnerCompany: null,
    owner: { id: REQUESTER, fullName: 'Dono', email: 'd@x.co' },
    team: [],
    stageHistory: [],
    currentTransfer,
  };
}

async function makeCaller() {
  const { opportunitiesRouter } = await import(
    '@/server/trpc/routers/opportunities'
  );
  return opportunitiesRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: TENANT_A,
    user: {
      id: CALLER,
      email: 'caller@venzo.co',
      fullName: 'Caller',
      role: 'GESTOR',
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
  mockEnv.OPPORTUNITY_TRANSFER_ENABLED = true;
  hasPermissionMock.mockResolvedValue(true);
  resolveScopeMock.mockResolvedValue({ filter: {} });
});

describe('opportunities.byId → activeTransfer', () => {
  it('flag ON + currentTransfer PENDING → resumo { transferId, toName, requestedById }', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(
      oppRow({
        id: TRANSFER_ID,
        status: 'PENDING',
        requestedById: REQUESTER,
        targetManagerId: TARGET_MGR,
        targetManager: { fullName: 'Gestora Enterprise' },
      }),
    );

    const caller = await makeCaller();
    const result = await caller.byId({ id: OPP_ID });

    expect(result.activeTransfer).toEqual({
      transferId: TRANSFER_ID,
      toName: 'Gestora Enterprise',
      requestedById: REQUESTER,
    });
  });

  it('flag OFF + currentTransfer PENDING → activeTransfer null (T16, badge não mente no rollback)', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(
      oppRow({
        id: TRANSFER_ID,
        status: 'PENDING',
        requestedById: REQUESTER,
        targetManagerId: TARGET_MGR,
        targetManager: { fullName: 'Gestora Enterprise' },
      }),
    );

    const caller = await makeCaller();
    const result = await caller.byId({ id: OPP_ID });

    expect(result.activeTransfer).toBeNull();
  });

  it('sem currentTransfer → activeTransfer null', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(oppRow(null));

    const caller = await makeCaller();
    const result = await caller.byId({ id: OPP_ID });

    expect(result.activeTransfer).toBeNull();
  });

  it('currentTransfer com status != PENDING (APPROVED) → activeTransfer null', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(
      oppRow({
        id: TRANSFER_ID,
        status: 'APPROVED',
        requestedById: REQUESTER,
        targetManagerId: TARGET_MGR,
        targetManager: { fullName: 'Gestora Enterprise' },
      }),
    );

    const caller = await makeCaller();
    const result = await caller.byId({ id: OPP_ID });

    expect(result.activeTransfer).toBeNull();
  });

  it('targetManager null → toName null (defensivo)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(
      oppRow({
        id: TRANSFER_ID,
        status: 'PENDING',
        requestedById: REQUESTER,
        targetManagerId: TARGET_MGR,
        targetManager: null,
      }),
    );

    const caller = await makeCaller();
    const result = await caller.byId({ id: OPP_ID });

    expect(result.activeTransfer).toEqual({
      transferId: TRANSFER_ID,
      toName: null,
      requestedById: REQUESTER,
    });
  });

  it('include carrega a relation currentTransfer com o select certo', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(oppRow(null));

    const caller = await makeCaller();
    await caller.byId({ id: OPP_ID });

    const arg = mockPrisma.opportunity.findFirst.mock.calls[0]![0]!;
    expect(arg.include.currentTransfer).toEqual({
      select: {
        id: true,
        status: true,
        requestedById: true,
        targetManagerId: true,
        targetManager: { select: { fullName: true } },
      },
    });
  });

  it('opp não encontrada → NOT_FOUND', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller();
    await expect(caller.byId({ id: OPP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
