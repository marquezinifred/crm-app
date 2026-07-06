// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// Prisma mock — cada teste seta os retornos dos métodos usados
const mockProposal = {
  findFirst: vi.fn(),
  update: vi.fn(),
};
const mockProposalVersion = {
  create: vi.fn(),
};
const mockOpportunity = {
  update: vi.fn(),
};
const mockTransaction = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: {
    proposal: mockProposal,
    proposalVersion: mockProposalVersion,
    opportunity: mockOpportunity,
    $transaction: mockTransaction,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'user-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: vi.fn(async () => true),
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));

const engineSpy = vi.fn(async (_tenantId: string, proposalVersionId: string) => ({
  proposalVersionId,
  rulesMatched: 0,
  approvalsCreated: 0,
  noApproverFor: [],
}));
vi.mock('@/server/services/approval-engine.service', () => ({
  createApprovalsForProposalVersion: (tenantId: string, id: string) =>
    engineSpy(tenantId, id),
  getApprovalState: vi.fn(),
}));

vi.mock('@/server/services/document-compare.service', () => ({
  compareDocumentVersions: vi.fn(),
}));

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

const PROPOSAL_ID = '11111111-1111-1111-1111-111111111111';
const OPP_ID = '22222222-2222-2222-2222-222222222222';
const VERSION_ID = '33333333-3333-3333-3333-333333333333';

async function makeCaller(role: 'ADMIN' | 'ANALISTA' = 'ADMIN') {
  const { proposalsRouter } = await import('@/server/trpc/routers/proposals');
  return proposalsRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: 'tenant-A',
    user: {
      id: 'user-1',
      email: 'a@b.co',
      fullName: 'Fred',
      role,
      tenantId: 'tenant-A',
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
  // $transaction default: resolve as promessas na ordem enviada.
  mockTransaction.mockImplementation(async (writes: Promise<unknown>[]) =>
    Promise.all(writes),
  );
});

describe('proposalsRouter.addVersion (P-65)', () => {
  it('cross-tenant → NOT_FOUND antes de qualquer write ou audit', async () => {
    mockProposal.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();

    await expect(
      caller.addVersion({
        proposalId: PROPOSAL_ID,
        contentJson: { items: [] },
        totalValue: 500000,
      }),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'NOT_FOUND' });

    expect(mockProposal.findFirst).toHaveBeenCalledWith({
      where: { id: PROPOSAL_ID, deletedAt: null },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        opportunity: { select: { id: true, estimatedValue: true } },
      },
    });
    expect(mockProposalVersion.create).not.toHaveBeenCalled();
    expect(mockProposal.update).not.toHaveBeenCalled();
    expect(mockOpportunity.update).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(engineSpy).not.toHaveBeenCalled();
  });

  it('sincroniza Opportunity.estimatedValue com totalValue=500000', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: 100000 },
      versions: [{ version: 2 }],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: { items: [{ name: 'x', total: 500000 }] },
      totalValue: 500000,
    });

    expect(mockOpportunity.update).toHaveBeenCalledTimes(1);
    const oppUpdateArgs = mockOpportunity.update.mock.calls[0]![0]!;
    expect(oppUpdateArgs).toEqual({
      where: { id: OPP_ID },
      data: { estimatedValue: 500000, updatedBy: 'user-1' },
    });
  });

  it('encapsula os 3 writes em $transaction (version + proposal + opportunity)', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: null },
      versions: [],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 250000,
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const writes = mockTransaction.mock.calls[0]![0]! as unknown[];
    expect(writes).toHaveLength(3);
    // Ordem: version.create → proposal.update → opportunity.update
    const versionOrder = mockProposalVersion.create.mock.invocationCallOrder[0]!;
    const proposalOrder = mockProposal.update.mock.invocationCallOrder[0]!;
    const oppOrder = mockOpportunity.update.mock.invocationCallOrder[0]!;
    expect(versionOrder).toBeLessThan(proposalOrder);
    expect(proposalOrder).toBeLessThan(oppOrder);
  });

  it('grava audit "opportunity.estimated_value.synced_from_proposal" com tenantIdOverride', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: 100000 },
      versions: [{ version: 1 }],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 500000,
    });

    const syncEntry = auditSpy.mock.calls.find(
      (c) => (c[0] as { action: string }).action ===
        'opportunity.estimated_value.synced_from_proposal',
    );
    expect(syncEntry).toBeDefined();
    expect(syncEntry![0]).toMatchObject({
      action: 'opportunity.estimated_value.synced_from_proposal',
      tableName: 'opportunities',
      recordId: OPP_ID,
      before: { estimatedValue: 100000 },
      after: {
        estimatedValue: 500000,
        proposalId: PROPOSAL_ID,
        proposalVersionId: VERSION_ID,
        version: 2,
      },
      tenantIdOverride: 'tenant-A',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('before.estimatedValue=null quando opportunity não tinha valor prévio', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: null },
      versions: [],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 300000,
    });

    const syncEntry = auditSpy.mock.calls.find(
      (c) => (c[0] as { action: string }).action ===
        'opportunity.estimated_value.synced_from_proposal',
    )!;
    expect((syncEntry[0] as { before: unknown }).before).toEqual({
      estimatedValue: null,
    });
  });

  it('ambos audits disparam: sync ANTES do proposal.add_version, e engine roda entre eles', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: 50000 },
      versions: [{ version: 3 }],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 750000,
    });

    // Ordem esperada de invocação:
    // 1. audit sync
    // 2. engine
    // 3. audit add_version
    const actions = auditSpy.mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    );
    expect(actions).toEqual([
      'opportunity.estimated_value.synced_from_proposal',
      'proposal.add_version',
    ]);
    expect(engineSpy).toHaveBeenCalledTimes(1);
    expect(engineSpy).toHaveBeenCalledWith('tenant-A', VERSION_ID);
  });

  it('sincroniza mesmo com totalValue=0 (0 não é null/undefined)', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: 1000 },
      versions: [],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    const caller = await makeCaller();

    await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 0,
    });

    expect(mockOpportunity.update).toHaveBeenCalledTimes(1);
    const oppArgs = mockOpportunity.update.mock.calls[0]![0]!;
    expect(oppArgs.data).toMatchObject({ estimatedValue: 0 });
  });

  it('rejeita totalValue negativo via Zod (sem writes nem audit)', async () => {
    const caller = await makeCaller();
    await expect(
      caller.addVersion({
        proposalId: PROPOSAL_ID,
        contentJson: {},
        totalValue: -1,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockProposal.findFirst).not.toHaveBeenCalled();
    expect(mockOpportunity.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('retorna versionId, version e resultado do engine', async () => {
    mockProposal.findFirst.mockResolvedValueOnce({
      id: 'p1',
      opportunityId: OPP_ID,
      opportunity: { id: OPP_ID, estimatedValue: null },
      versions: [{ version: 5 }],
    });
    mockProposalVersion.create.mockResolvedValueOnce({ id: VERSION_ID });
    mockProposal.update.mockResolvedValueOnce({ id: 'p1' });
    mockOpportunity.update.mockResolvedValueOnce({ id: OPP_ID });
    engineSpy.mockResolvedValueOnce({
      proposalVersionId: VERSION_ID,
      rulesMatched: 1,
      approvalsCreated: 2,
      noApproverFor: [],
    });
    const caller = await makeCaller();

    const out = await caller.addVersion({
      proposalId: PROPOSAL_ID,
      contentJson: {},
      totalValue: 800000,
    });

    expect(out).toEqual({
      versionId: VERSION_ID,
      version: 6,
      approvals: {
        proposalVersionId: VERSION_ID,
        rulesMatched: 1,
        approvalsCreated: 2,
        noApproverFor: [],
      },
    });
  });
});
