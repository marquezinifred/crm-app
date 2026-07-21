// @vitest-environment node
//
// Sprint 15G.5 Fase 1b — TransferScopeService (autoridade estrutural T13/T14).
// Cobre cada regra cardinal §2 do spec: dono NÃO dispara sobre a própria opp;
// ancestor dispara sobre subordinado; non-ancestor não dispara; newOwner
// restrito à subárvore do destinatário (T10); destino válido = par/superior
// (T14). Repo + prisma mockados → teste puro sem Postgres.
//
// Padrão do mock alinhado com `sales-structure-service.test.ts` (vi.hoisted +
// vi.mock do repository e do prisma client).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, getSubtreeMock, resolveTargetsMock } = vi.hoisted(() => ({
  mockPrisma: {
    opportunity: { findFirst: vi.fn() },
  },
  getSubtreeMock: vi.fn(),
  resolveTargetsMock: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: {
    getSubtreeMemberIds: getSubtreeMock,
    resolveTransferTargets: resolveTargetsMock,
  },
}));

import { TransferScopeService } from '@/server/services/transfer-scope.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CALLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // gestor/ancestor
const SUBORDINATE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // dono na subárvore do caller
const OUTSIDER = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // dono fora da subárvore
const OPP = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PEER_MANAGER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; // par (unidade-irmã)
const SUPERIOR_MANAGER = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; // superior (unidade-pai)

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransferScopeService.resolveTransferSources', () => {
  it('devolve Set com a subárvore gerida (delegando a getSubtreeMemberIds)', async () => {
    getSubtreeMock.mockResolvedValueOnce([CALLER, SUBORDINATE]);

    const sources = await TransferScopeService.resolveTransferSources(CALLER, TENANT);

    expect(sources).toBeInstanceOf(Set);
    expect(sources.has(CALLER)).toBe(true);
    expect(sources.has(SUBORDINATE)).toBe(true);
    expect(sources.has(OUTSIDER)).toBe(false);
    expect(getSubtreeMock).toHaveBeenCalledWith(CALLER, TENANT);
  });

  it('caller sem subárvore (não é MANAGER em lugar nenhum) → Set vazio', async () => {
    getSubtreeMock.mockResolvedValueOnce([]);

    const sources = await TransferScopeService.resolveTransferSources(CALLER, TENANT);

    expect(sources.size).toBe(0);
  });
});

describe('TransferScopeService.canTransferOpportunity', () => {
  it('dono NÃO dispara sobre a própria opp (owner === caller → false)', async () => {
    // Regra §2.1: nunca o próprio dono. Retorna false ANTES de consultar a subárvore.
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({ ownerId: CALLER });

    const can = await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(can).toBe(false);
    expect(getSubtreeMock).not.toHaveBeenCalled();
  });

  it('ancestor dispara sobre subordinado (owner ∈ subárvore → true)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({ ownerId: SUBORDINATE });
    getSubtreeMock.mockResolvedValueOnce([CALLER, SUBORDINATE]);

    const can = await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(can).toBe(true);
    expect(getSubtreeMock).toHaveBeenCalledWith(CALLER, TENANT);
  });

  it('non-ancestor não dispara (owner fora da subárvore → false)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({ ownerId: OUTSIDER });
    getSubtreeMock.mockResolvedValueOnce([CALLER, SUBORDINATE]);

    const can = await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(can).toBe(false);
  });

  it('opp inexistente no tenant → false (sem consultar subárvore)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(null);

    const can = await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(can).toBe(false);
    expect(getSubtreeMock).not.toHaveBeenCalled();
  });

  it('opp sem owner (lead inbound não alocado) → false', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({ ownerId: null });

    const can = await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(can).toBe(false);
    expect(getSubtreeMock).not.toHaveBeenCalled();
  });

  it('lookup da opp filtra por tenantId + deletedAt (cross-tenant / soft-delete guard)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({ ownerId: SUBORDINATE });
    getSubtreeMock.mockResolvedValueOnce([CALLER, SUBORDINATE]);

    await TransferScopeService.canTransferOpportunity(CALLER, OPP, TENANT);

    expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: OPP, tenantId: TENANT, deletedAt: null },
      select: { ownerId: true },
    });
  });
});

describe('TransferScopeService.resolveTransferTargets', () => {
  it('delega ao repo (irmãos + pai unidos por membership — T14)', async () => {
    resolveTargetsMock.mockResolvedValueOnce([PEER_MANAGER, SUPERIOR_MANAGER]);

    const targets = await TransferScopeService.resolveTransferTargets(CALLER, TENANT);

    expect(targets).toEqual([PEER_MANAGER, SUPERIOR_MANAGER]);
    expect(resolveTargetsMock).toHaveBeenCalledWith(CALLER, TENANT);
  });

  it('caller sem targets estruturais → []', async () => {
    resolveTargetsMock.mockResolvedValueOnce([]);

    const targets = await TransferScopeService.resolveTransferTargets(CALLER, TENANT);

    expect(targets).toEqual([]);
  });
});

describe('TransferScopeService.canReceiveAsNewOwner (T10)', () => {
  it('newOwner na subárvore do destinatário → true', async () => {
    getSubtreeMock.mockResolvedValueOnce([PEER_MANAGER, SUBORDINATE]);

    const can = await TransferScopeService.canReceiveAsNewOwner(
      PEER_MANAGER,
      SUBORDINATE,
      TENANT,
    );

    expect(can).toBe(true);
    expect(getSubtreeMock).toHaveBeenCalledWith(PEER_MANAGER, TENANT);
  });

  it('newOwner FORA da subárvore do destinatário → false (anti-escalada)', async () => {
    getSubtreeMock.mockResolvedValueOnce([PEER_MANAGER]);

    const can = await TransferScopeService.canReceiveAsNewOwner(
      PEER_MANAGER,
      OUTSIDER,
      TENANT,
    );

    expect(can).toBe(false);
  });

  it('destinatário sem subárvore → false', async () => {
    getSubtreeMock.mockResolvedValueOnce([]);

    const can = await TransferScopeService.canReceiveAsNewOwner(
      PEER_MANAGER,
      SUBORDINATE,
      TENANT,
    );

    expect(can).toBe(false);
  });
});

describe('TransferScopeService.isValidTransferTarget (T14)', () => {
  it('destino é par imediato (unidade-irmã) → true', async () => {
    resolveTargetsMock.mockResolvedValueOnce([PEER_MANAGER, SUPERIOR_MANAGER]);

    const ok = await TransferScopeService.isValidTransferTarget(
      CALLER,
      PEER_MANAGER,
      TENANT,
    );

    expect(ok).toBe(true);
  });

  it('destino é superior direto (unidade-pai) → true', async () => {
    resolveTargetsMock.mockResolvedValueOnce([PEER_MANAGER, SUPERIOR_MANAGER]);

    const ok = await TransferScopeService.isValidTransferTarget(
      CALLER,
      SUPERIOR_MANAGER,
      TENANT,
    );

    expect(ok).toBe(true);
  });

  it('destino subordinado (fora dos targets estruturais) → false', async () => {
    // Subordinado seria delegação interna, não transferência (regra §2.2).
    resolveTargetsMock.mockResolvedValueOnce([PEER_MANAGER, SUPERIOR_MANAGER]);

    const ok = await TransferScopeService.isValidTransferTarget(
      CALLER,
      SUBORDINATE,
      TENANT,
    );

    expect(ok).toBe(false);
  });

  it('destino não-relacionado → false', async () => {
    resolveTargetsMock.mockResolvedValueOnce([PEER_MANAGER]);

    const ok = await TransferScopeService.isValidTransferTarget(
      CALLER,
      OUTSIDER,
      TENANT,
    );

    expect(ok).toBe(false);
  });
});
