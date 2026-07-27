// @vitest-environment node
//
// Sprint 15G.5 Fase 3 (backend) — queries de hidratação
// `targetsForOpportunity` + `newOwnerCandidates` no router
// `opportunityTransfers` (P-87). Populam os Selects dos modais de disparo
// (3a) e aceite (3b). Read-only, sem audit.
//
// Cobre: autoridade por-opp (T13, targetsForOpportunity valida
// canTransferOpportunity, NÃO flag global), hidratação com nome/role,
// kill-switch OFF (T3), cross-tenant explícito (T6), ordenação por fullName,
// ids não-hidratados somem (active/deletedAt), subárvore vazia → [],
// RBAC gate (T12).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockEnv,
  hasPermissionMock,
  canTransferMock,
  resolveTargetsMock,
  resolveNewOwnerCandidatesMock,
} = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findMany: vi.fn(),
    },
  },
  mockEnv: { OPPORTUNITY_TRANSFER_ENABLED: true } as {
    OPPORTUNITY_TRANSFER_ENABLED: boolean;
  },
  hasPermissionMock: vi.fn(async () => true),
  canTransferMock: vi.fn(async () => true),
  resolveTargetsMock: vi.fn(async () => [] as string[]),
  resolveNewOwnerCandidatesMock: vi.fn(async () => [] as string[]),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: hasPermissionMock,
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));
vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('@/server/services/transfer-notification.service', () => ({
  notifyTransferEvent: vi.fn(),
}));
vi.mock('@/server/services/transfer-scope.service', () => ({
  TransferScopeService: {
    canTransferOpportunity: canTransferMock,
    isValidTransferTarget: vi.fn(async () => true),
    canReceiveAsNewOwner: vi.fn(async () => true),
    resolveTransferSources: vi.fn(async () => new Set()),
    resolveTransferTargets: resolveTargetsMock,
    resolveNewOwnerCandidates: resolveNewOwnerCandidatesMock,
  },
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const OPP_ID = '22222222-2222-2222-2222-222222222222';
const CALLER_MANAGER = '44444444-4444-4444-4444-444444444444';
const TARGET_MANAGER = '66666666-6666-6666-6666-666666666666';

// candidatos hidratados
const PEER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PEER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SELLER_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SELLER_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

async function makeCaller(userId: string = CALLER_MANAGER) {
  const { opportunityTransfersRouter } = await import(
    '@/server/trpc/routers/opportunity-transfers'
  );
  return opportunityTransfersRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: TENANT_A,
    user: {
      id: userId,
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
  canTransferMock.mockResolvedValue(true);
  resolveTargetsMock.mockResolvedValue([]);
  resolveNewOwnerCandidatesMock.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
});

// ════════════════════════════════════════════════════════════════════
// targetsForOpportunity (Fase 3a)
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.targetsForOpportunity', () => {
  it('happy: valida por-opp, resolve targets e hidrata em { id, fullName, role }', async () => {
    canTransferMock.mockResolvedValueOnce(true);
    resolveTargetsMock.mockResolvedValueOnce([PEER_A, PEER_B]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: PEER_A, fullName: 'Ana Régia', role: 'GESTOR' },
      { id: PEER_B, fullName: 'Bruno Peer', role: 'DIRETOR_COMERCIAL' },
    ]);

    const caller = await makeCaller(CALLER_MANAGER);
    const result = await caller.targetsForOpportunity({ opportunityId: OPP_ID });

    expect(result).toEqual([
      { id: PEER_A, fullName: 'Ana Régia', role: 'GESTOR' },
      { id: PEER_B, fullName: 'Bruno Peer', role: 'DIRETOR_COMERCIAL' },
    ]);

    // Autoridade avaliada POR-OPP (T13), não por flag global.
    expect(canTransferMock).toHaveBeenCalledWith(CALLER_MANAGER, OPP_ID, TENANT_A);
    expect(resolveTargetsMock).toHaveBeenCalledWith(CALLER_MANAGER, TENANT_A);
  });

  it('hidrata com filtro cross-tenant + active/deletedAt + ordena por fullName (T6)', async () => {
    canTransferMock.mockResolvedValueOnce(true);
    resolveTargetsMock.mockResolvedValueOnce([PEER_A, PEER_B]);
    mockPrisma.user.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller(CALLER_MANAGER);
    await caller.targetsForOpportunity({ opportunityId: OPP_ID });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [PEER_A, PEER_B] },
        tenantId: TENANT_A,
        deletedAt: null,
        active: true,
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  });

  it('ids não-hidratados somem: findMany filtra active/deletedAt e o retorno é só o que hidratou', async () => {
    canTransferMock.mockResolvedValueOnce(true);
    // resolve 3 alvos, mas 1 é inativo/soft-deleted → findMany devolve só 2
    resolveTargetsMock.mockResolvedValueOnce([PEER_A, PEER_B, TARGET_MANAGER]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: PEER_A, fullName: 'Ana Régia', role: 'GESTOR' },
      { id: PEER_B, fullName: 'Bruno Peer', role: 'GESTOR' },
    ]);

    const caller = await makeCaller(CALLER_MANAGER);
    const result = await caller.targetsForOpportunity({ opportunityId: OPP_ID });

    expect(result).toHaveLength(2);
    expect(result.map((u) => u.id)).not.toContain(TARGET_MANAGER);
    // O filtro que remove inativos vive no where (defesa server-side).
    const where = mockPrisma.user.findMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({ deletedAt: null, active: true });
  });

  it('FORBIDDEN genérico quando caller não pode transferir a opp (T13/T7)', async () => {
    canTransferMock.mockResolvedValueOnce(false);

    const caller = await makeCaller(CALLER_MANAGER);
    await expect(
      caller.targetsForOpportunity({ opportunityId: OPP_ID }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Seu perfil não tem acesso a esta operação.',
    });
    expect(resolveTargetsMock).not.toHaveBeenCalled();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('targets vazio → [] sem consultar findMany (short-circuit)', async () => {
    canTransferMock.mockResolvedValueOnce(true);
    resolveTargetsMock.mockResolvedValueOnce([]);

    const caller = await makeCaller(CALLER_MANAGER);
    const result = await caller.targetsForOpportunity({ opportunityId: OPP_ID });

    expect(result).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('kill-switch OFF → FORBIDDEN "Recurso indisponível." antes de qualquer check (T3)', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;

    const caller = await makeCaller(CALLER_MANAGER);
    await expect(
      caller.targetsForOpportunity({ opportunityId: OPP_ID }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
    });
    expect(canTransferMock).not.toHaveBeenCalled();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('FORBIDDEN via gate quando sem permission opportunity:transfer (T12)', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);

    const caller = await makeCaller(CALLER_MANAGER);
    await expect(
      caller.targetsForOpportunity({ opportunityId: OPP_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // gate roda antes do body — nem avalia autoridade por-opp
    expect(canTransferMock).not.toHaveBeenCalled();
  });

  it('rejeita opportunityId não-uuid via Zod', async () => {
    const caller = await makeCaller(CALLER_MANAGER);
    await expect(
      caller.targetsForOpportunity({ opportunityId: 'nope' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(canTransferMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// newOwnerCandidates (Fase 3b)
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.newOwnerCandidates', () => {
  it('happy: hidrata a subárvore do destinatário em { id, fullName, role }', async () => {
    resolveNewOwnerCandidatesMock.mockResolvedValueOnce([SELLER_1, SELLER_2]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: SELLER_1, fullName: 'Carla Vendas', role: 'ANALISTA' },
      { id: SELLER_2, fullName: 'Diego Vendas', role: 'ANALISTA' },
    ]);

    const caller = await makeCaller(TARGET_MANAGER);
    const result = await caller.newOwnerCandidates();

    expect(result).toEqual([
      { id: SELLER_1, fullName: 'Carla Vendas', role: 'ANALISTA' },
      { id: SELLER_2, fullName: 'Diego Vendas', role: 'ANALISTA' },
    ]);
    // subárvore resolvida pelo caller (o destinatário decidindo)
    expect(resolveNewOwnerCandidatesMock).toHaveBeenCalledWith(TARGET_MANAGER, TENANT_A);
  });

  it('hidrata com filtro cross-tenant + active/deletedAt + ordena por fullName (T6)', async () => {
    resolveNewOwnerCandidatesMock.mockResolvedValueOnce([SELLER_1, SELLER_2]);
    mockPrisma.user.findMany.mockResolvedValueOnce([]);

    const caller = await makeCaller(TARGET_MANAGER);
    await caller.newOwnerCandidates();

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [SELLER_1, SELLER_2] },
        tenantId: TENANT_A,
        deletedAt: null,
        active: true,
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  });

  it('subárvore vazia → [] sem consultar findMany (short-circuit, não é erro)', async () => {
    resolveNewOwnerCandidatesMock.mockResolvedValueOnce([]);

    const caller = await makeCaller(TARGET_MANAGER);
    const result = await caller.newOwnerCandidates();

    expect(result).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('kill-switch OFF → FORBIDDEN "Recurso indisponível." (T3)', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;

    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.newOwnerCandidates()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
    });
    expect(resolveNewOwnerCandidatesMock).not.toHaveBeenCalled();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('FORBIDDEN via gate quando sem permission opportunity:transfer (T12)', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);

    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.newOwnerCandidates()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(resolveNewOwnerCandidatesMock).not.toHaveBeenCalled();
  });
});
