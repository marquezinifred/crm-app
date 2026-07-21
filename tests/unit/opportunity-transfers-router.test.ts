// @vitest-environment node
//
// Sprint 15G.5 Fase 2a — router `opportunityTransfers` (P-87).
// Testa as 7 procedures via createCaller com prisma + TransferScopeService
// + notification service mockados (padrão tasks-router.test.ts +
// sales-structure-service.test.ts).
//
// Cobre: máquina de estado (T8), kill-switch OFF (T3), FORBIDDEN de scope
// (T7), CONFLICT de race (T1), audit com tenantIdOverride (T4), notificação
// best-effort (T5), cross-tenant NOT_FOUND (T6), troca de owner via audit
// NÃO stageHistory (T17), anti-escalada no approve (T10).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { TransferStatus } from '@prisma/client';

const {
  mockPrisma,
  mockEnv,
  hasPermissionMock,
  auditMock,
  notifyMock,
  canTransferMock,
  isValidTargetMock,
  canReceiveMock,
} = vi.hoisted(() => ({
  mockPrisma: {
    opportunity: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    opportunityTransfer: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tenantSettings: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockEnv: { OPPORTUNITY_TRANSFER_ENABLED: true } as {
    OPPORTUNITY_TRANSFER_ENABLED: boolean;
  },
  hasPermissionMock: vi.fn(async () => true),
  auditMock: vi.fn(),
  notifyMock: vi.fn(),
  canTransferMock: vi.fn(async () => true),
  isValidTargetMock: vi.fn(async () => true),
  canReceiveMock: vi.fn(async () => true),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: hasPermissionMock,
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));
vi.mock('@/server/services/audit.service', () => ({ audit: auditMock }));
vi.mock('@/server/services/transfer-notification.service', () => ({
  notifyTransferEvent: notifyMock,
}));
vi.mock('@/server/services/transfer-scope.service', () => ({
  TransferScopeService: {
    canTransferOpportunity: canTransferMock,
    isValidTransferTarget: isValidTargetMock,
    canReceiveAsNewOwner: canReceiveMock,
    resolveTransferSources: vi.fn(async () => new Set()),
    resolveTransferTargets: vi.fn(async () => []),
  },
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const OPP_ID = '22222222-2222-2222-2222-222222222222';
const TRANSFER_ID = '33333333-3333-3333-3333-333333333333';
const CALLER_MANAGER = '44444444-4444-4444-4444-444444444444'; // disparador
const ORIGINAL_OWNER = '55555555-5555-5555-5555-555555555555';
const TARGET_MANAGER = '66666666-6666-6666-6666-666666666666'; // destinatário
const NEW_OWNER = '77777777-7777-7777-7777-777777777777';

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

/** Row de opportunity_transfers com opportunity incluída (shape do include). */
function transferRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRANSFER_ID,
    tenantId: TENANT_A,
    opportunityId: OPP_ID,
    requestedById: CALLER_MANAGER,
    originalOwnerId: ORIGINAL_OWNER,
    targetManagerId: TARGET_MANAGER,
    newOwnerId: null,
    status: TransferStatus.PENDING,
    reason: 'cliente mudou de região',
    decisionReason: null,
    decidedById: null,
    expiresAt: new Date('2026-08-01T00:00:00Z'),
    opportunity: {
      title: 'Projeto X',
      clientCompany: { razaoSocial: 'ACME Ltda' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.OPPORTUNITY_TRANSFER_ENABLED = true;
  hasPermissionMock.mockResolvedValue(true);
  canTransferMock.mockResolvedValue(true);
  isValidTargetMock.mockResolvedValue(true);
  canReceiveMock.mockResolvedValue(true);
  auditMock.mockResolvedValue(undefined);
  notifyMock.mockResolvedValue(undefined);
  mockPrisma.tenantSettings.findUnique.mockResolvedValue({ transferTimeoutHours: 72 });
  mockPrisma.opportunity.update.mockResolvedValue({});
  mockPrisma.opportunityTransfer.findMany.mockResolvedValue([]);
  // $transaction interativo: passa o próprio mockPrisma como tx.
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(mockPrisma),
  );
});

// ════════════════════════════════════════════════════════════════════
// request
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.request', () => {
  const validInput = {
    opportunityId: OPP_ID,
    targetManagerId: TARGET_MANAGER,
    reason: 'cliente mudou de região',
  };

  it('happy path: cria PENDING, seta current_transfer_id, audita e notifica REQUESTED', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: { razaoSocial: 'ACME Ltda' },
    });
    mockPrisma.opportunityTransfer.create.mockResolvedValueOnce(transferRow());

    const caller = await makeCaller();
    const result = await caller.request(validInput);

    expect(result.id).toBe(TRANSFER_ID);

    // Cria a row com dados corretos
    const createArgs = mockPrisma.opportunityTransfer.create.mock.calls[0]![0]!;
    expect(createArgs.data).toMatchObject({
      tenantId: TENANT_A,
      opportunityId: OPP_ID,
      requestedById: CALLER_MANAGER,
      originalOwnerId: ORIGINAL_OWNER,
      targetManagerId: TARGET_MANAGER,
      status: TransferStatus.PENDING,
      reason: 'cliente mudou de região',
    });
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);

    // Seta a flag na opp (dentro da transação)
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: OPP_ID },
      data: { currentTransferId: TRANSFER_ID },
    });

    // Audit com tenantIdOverride (T4)
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: 'opportunity.transfer_requested',
      tableName: 'opportunity_transfers',
      recordId: TRANSFER_ID,
      tenantIdOverride: TENANT_A,
    });

    // Notifica REQUESTED (T5)
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![0]).toBe('REQUESTED');
    expect(notifyMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_A,
      transferId: TRANSFER_ID,
      opportunityId: OPP_ID,
      opportunityTitle: 'Projeto X',
      companyName: 'ACME Ltda',
      targetManagerId: TARGET_MANAGER,
      originalOwnerId: ORIGINAL_OWNER,
    });
  });

  it('calcula expires_at a partir de tenant_settings.transfer_timeout_hours', async () => {
    mockPrisma.tenantSettings.findUnique.mockResolvedValueOnce({ transferTimeoutHours: 24 });
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    mockPrisma.opportunityTransfer.create.mockResolvedValueOnce(transferRow());

    const before = Date.now();
    const caller = await makeCaller();
    await caller.request(validInput);
    const after = Date.now();

    const expiresAt: Date = mockPrisma.opportunityTransfer.create.mock.calls[0]![0]!.data
      .expiresAt;
    const deltaMs = expiresAt.getTime() - before;
    expect(deltaMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 5);
  });

  it('FORBIDDEN genérico quando caller não é ancestor do dono (T7)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    canTransferMock.mockResolvedValueOnce(false);

    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Seu perfil não tem acesso a esta operação.',
    });
    expect(mockPrisma.opportunityTransfer.create).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('FORBIDDEN quando destino não é par/superior (T14)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    isValidTargetMock.mockResolvedValueOnce(false);

    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.opportunityTransfer.create).not.toHaveBeenCalled();
  });

  it('CONFLICT quando a opp já tem transfer pendente (pré-check current_transfer_id, T1)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: 'existing-transfer',
      title: 'Projeto X',
      clientCompany: null,
    });

    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Já existe transferência pendente para esta oportunidade.',
    });
    expect(mockPrisma.opportunityTransfer.create).not.toHaveBeenCalled();
  });

  it('CONFLICT quando o partial UNIQUE dispara P2002 na race (T1)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    mockPrisma.opportunityTransfer.create.mockRejectedValueOnce({ code: 'P2002' });

    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(auditMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('kill-switch OFF → FORBIDDEN "Recurso indisponível." antes de qualquer query (T3)', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;

    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
    });
    expect(mockPrisma.opportunity.findFirst).not.toHaveBeenCalled();
  });

  it('NOT_FOUND quando a opp é de outro tenant (findFirst filtra tenantId, T6)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: OPP_ID, tenantId: TENANT_A, deletedAt: null },
      select: expect.any(Object),
    });
  });

  it('BAD_REQUEST quando a opp não tem dono (nada a transferir)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: null,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(canTransferMock).not.toHaveBeenCalled();
  });

  it('FORBIDDEN quando o user não tem a permission opportunity:transfer (gate T12)', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);
    const caller = await makeCaller();
    await expect(caller.request(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // gate roda antes do body — nem consulta a opp
    expect(mockPrisma.opportunity.findFirst).not.toHaveBeenCalled();
  });

  it('notificação best-effort: falha em notifyTransferEvent não derruba a mutation (T5)', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValueOnce({
      id: OPP_ID,
      ownerId: ORIGINAL_OWNER,
      currentTransferId: null,
      title: 'Projeto X',
      clientCompany: null,
    });
    mockPrisma.opportunityTransfer.create.mockResolvedValueOnce(transferRow());
    notifyMock.mockRejectedValueOnce(new Error('push down'));

    const caller = await makeCaller();
    await expect(caller.request(validInput)).resolves.toMatchObject({ id: TRANSFER_ID });
  });
});

// ════════════════════════════════════════════════════════════════════
// approve
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.approve', () => {
  const validInput = {
    transferId: TRANSFER_ID,
    newOwnerId: NEW_OWNER,
    decisionReason: 'aceito, atribuindo à Ana',
  };

  it('happy: troca owner, limpa flag, audita owner_transferred e NÃO grava stageHistory (T17)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    mockPrisma.opportunityTransfer.update.mockResolvedValueOnce(
      transferRow({
        status: TransferStatus.APPROVED,
        newOwnerId: NEW_OWNER,
        decidedById: TARGET_MANAGER,
        decisionReason: 'aceito, atribuindo à Ana',
      }),
    );

    const caller = await makeCaller(TARGET_MANAGER);
    const result = await caller.approve(validInput);
    expect(result.status).toBe(TransferStatus.APPROVED);

    // Troca owner + limpa flag na opp
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: OPP_ID },
      data: { ownerId: NEW_OWNER, currentTransferId: null, updatedBy: TARGET_MANAGER },
    });

    // Audit da troca de owner (T17: tabela opportunities, NUNCA stageHistory)
    expect(auditMock).toHaveBeenCalledTimes(1);
    const entry = auditMock.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'opportunity.owner_transferred',
      tableName: 'opportunities',
      recordId: OPP_ID,
      tenantIdOverride: TENANT_A,
    });
    // T17 — o mock de prisma nem tem opportunityStageHistory; garante que a
    // action de audit é de owner, não de estágio.
    expect(entry.action).not.toContain('stage');

    // Notifica APPROVED
    expect(notifyMock).toHaveBeenCalledWith('APPROVED', expect.objectContaining({
      newOwnerId: NEW_OWNER,
    }));
  });

  it('FORBIDDEN quando caller não é o destinatário', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    const caller = await makeCaller(CALLER_MANAGER); // não é o target_manager
    await expect(caller.approve(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.opportunityTransfer.update).not.toHaveBeenCalled();
  });

  it('FORBIDDEN quando newOwner está fora da subárvore do destinatário (T10)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    canReceiveMock.mockResolvedValueOnce(false);
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.approve(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.opportunityTransfer.update).not.toHaveBeenCalled();
    expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
  });

  it('CONFLICT quando o transfer não está mais PENDING (T8)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(
      transferRow({ status: TransferStatus.CANCELLED }),
    );
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.approve(validInput)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Transferência não está mais pendente.',
    });
    expect(canReceiveMock).not.toHaveBeenCalled();
  });

  it('NOT_FOUND quando o transfer é de outro tenant (T6)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.approve(validInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockPrisma.opportunityTransfer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRANSFER_ID, tenantId: TENANT_A },
      }),
    );
  });

  it('kill-switch OFF → FORBIDDEN "Recurso indisponível."', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.approve(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
    });
    expect(mockPrisma.opportunityTransfer.findFirst).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// reject
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.reject', () => {
  const validInput = { transferId: TRANSFER_ID, decisionReason: 'sem fit' };

  it('happy: status → REJECTED, limpa flag (opp fica com disparador — owner inalterado), notifica', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    mockPrisma.opportunityTransfer.update.mockResolvedValueOnce(
      transferRow({ status: TransferStatus.REJECTED, decidedById: TARGET_MANAGER }),
    );

    const caller = await makeCaller(TARGET_MANAGER);
    const result = await caller.reject(validInput);
    expect(result.status).toBe(TransferStatus.REJECTED);

    // Só limpa a flag — NÃO troca owner (regra 6 §2)
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: OPP_ID },
      data: { currentTransferId: null },
    });
    const updateData = mockPrisma.opportunity.update.mock.calls[0]![0]!.data;
    expect(updateData).not.toHaveProperty('ownerId');

    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: 'opportunity.transfer_rejected',
      tenantIdOverride: TENANT_A,
    });
    expect(notifyMock).toHaveBeenCalledWith('REJECTED', expect.any(Object));
  });

  it('FORBIDDEN quando caller não é o destinatário', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    const caller = await makeCaller(CALLER_MANAGER);
    await expect(caller.reject(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.opportunityTransfer.update).not.toHaveBeenCalled();
  });

  it('CONFLICT quando não está mais PENDING (T8)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(
      transferRow({ status: TransferStatus.APPROVED }),
    );
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.reject(validInput)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ════════════════════════════════════════════════════════════════════
// cancel
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers.cancel', () => {
  const validInput = { transferId: TRANSFER_ID };

  it('happy: disparador cancela, status → CANCELLED, limpa flag, notifica', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    mockPrisma.opportunityTransfer.update.mockResolvedValueOnce(
      transferRow({ status: TransferStatus.CANCELLED, decidedById: CALLER_MANAGER }),
    );

    const caller = await makeCaller(CALLER_MANAGER);
    const result = await caller.cancel(validInput);
    expect(result.status).toBe(TransferStatus.CANCELLED);

    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: OPP_ID },
      data: { currentTransferId: null },
    });
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: 'opportunity.transfer_cancelled',
      tenantIdOverride: TENANT_A,
    });
    expect(notifyMock).toHaveBeenCalledWith('CANCELLED', expect.any(Object));
  });

  it('FORBIDDEN quando caller não é o disparador (só o requested_by cancela)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(transferRow());
    const caller = await makeCaller(TARGET_MANAGER); // destinatário não cancela
    await expect(caller.cancel(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.opportunityTransfer.update).not.toHaveBeenCalled();
  });

  it('CONFLICT quando não está mais PENDING (T8)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(
      transferRow({ status: TransferStatus.TIMED_OUT }),
    );
    const caller = await makeCaller(CALLER_MANAGER);
    await expect(caller.cancel(validInput)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('NOT_FOUND cross-tenant (T6)', async () => {
    mockPrisma.opportunityTransfer.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller(CALLER_MANAGER);
    await expect(caller.cancel(validInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ════════════════════════════════════════════════════════════════════
// queries
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers queries', () => {
  it('pendingForMe filtra tenantId + targetManagerId + PENDING (T6)', async () => {
    mockPrisma.opportunityTransfer.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller(TARGET_MANAGER);
    await caller.pendingForMe();

    expect(mockPrisma.opportunityTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_A,
          targetManagerId: TARGET_MANAGER,
          status: TransferStatus.PENDING,
        },
      }),
    );
  });

  it('myOutgoing filtra tenantId + requestedById; sem status não injeta filtro', async () => {
    mockPrisma.opportunityTransfer.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller(CALLER_MANAGER);
    await caller.myOutgoing();

    const where = mockPrisma.opportunityTransfer.findMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({ tenantId: TENANT_A, requestedById: CALLER_MANAGER });
    expect(where).not.toHaveProperty('status');
  });

  it('myOutgoing aplica filtro opcional por status', async () => {
    mockPrisma.opportunityTransfer.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller(CALLER_MANAGER);
    await caller.myOutgoing({ status: TransferStatus.APPROVED });

    const where = mockPrisma.opportunityTransfer.findMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({
      tenantId: TENANT_A,
      requestedById: CALLER_MANAGER,
      status: TransferStatus.APPROVED,
    });
  });

  it('historyForOpportunity filtra tenantId + opportunityId (cross-tenant → lista vazia)', async () => {
    mockPrisma.opportunityTransfer.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller(CALLER_MANAGER);
    const result = await caller.historyForOpportunity({ opportunityId: OPP_ID });

    expect(result).toEqual([]);
    expect(mockPrisma.opportunityTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_A, opportunityId: OPP_ID },
      }),
    );
  });

  it('kill-switch OFF → FORBIDDEN em pendForMe (query também gateada, T3)', async () => {
    mockEnv.OPPORTUNITY_TRANSFER_ENABLED = false;
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(caller.pendingForMe()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
    });
    expect(mockPrisma.opportunityTransfer.findMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// Zod input validation
// ════════════════════════════════════════════════════════════════════
describe('opportunityTransfers input validation', () => {
  it('request rejeita opportunityId não-uuid via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.request({ opportunityId: 'nope', targetManagerId: TARGET_MANAGER }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockPrisma.opportunity.findFirst).not.toHaveBeenCalled();
  });

  it('approve rejeita newOwnerId não-uuid via Zod', async () => {
    const caller = await makeCaller(TARGET_MANAGER);
    await expect(
      caller.approve({ transferId: TRANSFER_ID, newOwnerId: 'nope' }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockPrisma.opportunityTransfer.findFirst).not.toHaveBeenCalled();
  });
});
