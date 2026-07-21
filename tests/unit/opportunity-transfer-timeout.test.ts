// @vitest-environment node
// Sprint 15G.5 chip 2b — worker de timeout de transferência.
// Cobre: PENDING vencida → TIMED_OUT + limpa flag + notifica; não-vencida
// intacta; idempotência (updateMany count 0 não reprocessa); kill-switch OFF
// no-op; best-effort por tenant; notificação best-effort (push falha não
// derruba o processamento).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted junto com os vi.mock (evita "Cannot access before initialization",
// já que a import estática do worker dispara os factories no topo).
const { envStub, mockTenant, mockTransfer, mockOpportunity, emailSpy, pushSpy } = vi.hoisted(
  () => ({
    envStub: {
      OPPORTUNITY_TRANSFER_ENABLED: true,
      NEXT_PUBLIC_APP_URL: 'https://crm.venzo.app',
    } as { OPPORTUNITY_TRANSFER_ENABLED: boolean; NEXT_PUBLIC_APP_URL: string },
    mockTenant: { findMany: vi.fn() },
    mockTransfer: { findMany: vi.fn(), updateMany: vi.fn() },
    mockOpportunity: { updateMany: vi.fn() },
    emailSpy: vi.fn(),
    pushSpy: vi.fn(),
  }),
);

vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) =>
      prop in envStub ? (envStub as Record<string, unknown>)[prop as string] : undefined,
  }),
}));
vi.mock('@/server/db/client', () => ({
  prisma: {
    tenant: mockTenant,
    opportunityTransfer: mockTransfer,
    opportunity: mockOpportunity,
  },
}));
vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));
vi.mock('@/server/services/email-sender.service', () => ({
  sendEmail: (...a: unknown[]) => emailSpy(...a),
}));
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: (...a: unknown[]) => pushSpy(...a),
}));

import { expireDueTransfers } from '@/jobs/opportunity-transfer-timeout.worker';

const NOW = new Date('2026-07-21T12:00:00Z');

function dueTransfer(over: Record<string, unknown> = {}) {
  return {
    id: 'transfer-1',
    opportunityId: 'opp-1',
    requestedById: 'req-1',
    originalOwnerId: 'owner-1',
    opportunity: { title: 'Implantação ERP', clientCompany: { razaoSocial: 'ACME LTDA' } },
    requestedBy: { id: 'req-1', email: 'req@acme.com', fullName: 'Bruno Gestor' },
    originalOwner: { id: 'owner-1', email: 'owner@acme.com', fullName: 'Ana Dona' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envStub.OPPORTUNITY_TRANSFER_ENABLED = true;
  emailSpy.mockResolvedValue({ ok: true, providerId: 'x' });
  pushSpy.mockResolvedValue({ sent: 1, failed: 0 });
  mockTenant.findMany.mockResolvedValue([{ id: 'tenant-A' }]);
  mockTransfer.findMany.mockResolvedValue([]);
  mockTransfer.updateMany.mockResolvedValue({ count: 1 });
  mockOpportunity.updateMany.mockResolvedValue({ count: 1 });
});

describe('expireDueTransfers — kill-switch (T3)', () => {
  it('flag OFF → no-op total, nem toca no banco', async () => {
    envStub.OPPORTUNITY_TRANSFER_ENABLED = false;
    const res = await expireDueTransfers({ now: NOW });
    expect(res).toEqual([]);
    expect(mockTenant.findMany).not.toHaveBeenCalled();
    expect(mockTransfer.findMany).not.toHaveBeenCalled();
    expect(mockTransfer.updateMany).not.toHaveBeenCalled();
  });
});

describe('expireDueTransfers — expiração (T5/T8)', () => {
  it('PENDING vencida → TIMED_OUT + limpa flag da opp + notifica', async () => {
    mockTransfer.findMany.mockResolvedValueOnce([dueTransfer()]);

    const res = await expireDueTransfers({ now: NOW });

    // query filtra tenantId + PENDING + expiresAt < now (T6)
    expect(mockTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-A', status: 'PENDING', expiresAt: { lt: NOW } },
      }),
    );
    // transição idempotente: WHERE status=PENDING → TIMED_OUT + decidedAt
    expect(mockTransfer.updateMany).toHaveBeenCalledWith({
      where: { id: 'transfer-1', status: 'PENDING' },
      data: { status: 'TIMED_OUT', decidedAt: NOW },
    });
    // limpa flag só se ainda aponta pra este transfer (regra 6)
    expect(mockOpportunity.updateMany).toHaveBeenCalledWith({
      where: { id: 'opp-1', currentTransferId: 'transfer-1' },
      data: { currentTransferId: null },
    });
    expect(res).toEqual([{ tenantId: 'tenant-A', expired: 1, notified: 1 }]);
  });

  it('notifica disparador + dono original (email 2× + push 2×) com conteúdo certo', async () => {
    mockTransfer.findMany.mockResolvedValueOnce([dueTransfer()]);

    await expireDueTransfers({ now: NOW });

    expect(emailSpy).toHaveBeenCalledTimes(2);
    const toAddrs = emailSpy.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(toAddrs).toEqual(expect.arrayContaining(['req@acme.com', 'owner@acme.com']));
    const firstEmail = emailSpy.mock.calls[0]![0] as { subject: string; html: string };
    expect(firstEmail.subject).toContain('expirada');
    expect(firstEmail.html).toContain('Implantação ERP');

    expect(pushSpy).toHaveBeenCalledTimes(2);
    const pushUsers = pushSpy.mock.calls.map((c) => c[0]);
    expect(pushUsers).toEqual(expect.arrayContaining(['req-1', 'owner-1']));
    const pushPayload = pushSpy.mock.calls[0]![1] as { title: string; body: string; url: string };
    expect(pushPayload.title).toBe('Transferência expirada');
    expect(pushPayload.url).toBe('https://crm.venzo.app/pipeline/opp-1');
    // push não vaza email
    expect(`${pushPayload.title} ${pushPayload.body}`).not.toContain('@');
  });

  it('sem transferências vencidas → nada expira nem notifica', async () => {
    mockTransfer.findMany.mockResolvedValueOnce([]);
    const res = await expireDueTransfers({ now: NOW });
    expect(mockTransfer.updateMany).not.toHaveBeenCalled();
    expect(mockOpportunity.updateMany).not.toHaveBeenCalled();
    expect(emailSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(res).toEqual([{ tenantId: 'tenant-A', expired: 0, notified: 0 }]);
  });
});

describe('expireDueTransfers — idempotência (T8)', () => {
  it('updateMany count 0 (já não-PENDING) → não limpa flag, não notifica, expired 0', async () => {
    mockTransfer.findMany.mockResolvedValueOnce([dueTransfer()]);
    mockTransfer.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await expireDueTransfers({ now: NOW });

    expect(mockTransfer.updateMany).toHaveBeenCalledTimes(1);
    expect(mockOpportunity.updateMany).not.toHaveBeenCalled();
    expect(emailSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(res).toEqual([{ tenantId: 'tenant-A', expired: 0, notified: 0 }]);
  });

  it('2ª execução (fila já vazia após 1ª) → no-op', async () => {
    mockTransfer.findMany
      .mockResolvedValueOnce([dueTransfer()]) // 1ª run
      .mockResolvedValueOnce([]); // 2ª run já não vê nada PENDING vencido

    const first = await expireDueTransfers({ now: NOW });
    const second = await expireDueTransfers({ now: NOW });

    expect(first).toEqual([{ tenantId: 'tenant-A', expired: 1, notified: 1 }]);
    expect(second).toEqual([{ tenantId: 'tenant-A', expired: 0, notified: 0 }]);
  });
});

describe('expireDueTransfers — best-effort', () => {
  it('um tenant falha não derruba os outros', async () => {
    mockTenant.findMany.mockResolvedValueOnce([{ id: 'tenant-A' }, { id: 'tenant-B' }]);
    // tenant-A: findMany lança; tenant-B: uma vencida
    mockTransfer.findMany
      .mockRejectedValueOnce(new Error('DB down for A'))
      .mockResolvedValueOnce([dueTransfer({ id: 'transfer-B', opportunityId: 'opp-B' })]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await expireDueTransfers({ now: NOW });

    // só tenant-B foi processado com sucesso
    expect(res).toEqual([{ tenantId: 'tenant-B', expired: 1, notified: 1 }]);
    expect(mockOpportunity.updateMany).toHaveBeenCalledWith({
      where: { id: 'opp-B', currentTransferId: 'transfer-B' },
      data: { currentTransferId: null },
    });
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]![0])).toContain('tenant tenant-A falhou');
    errSpy.mockRestore();
  });

  it('notificação (push) falha → transfer ainda expira e flag é limpa', async () => {
    mockTransfer.findMany.mockResolvedValueOnce([dueTransfer()]);
    pushSpy.mockRejectedValue(new Error('push service down'));

    const res = await expireDueTransfers({ now: NOW });

    // expiração persistiu apesar da falha de push (best-effort via allSettled)
    expect(mockTransfer.updateMany).toHaveBeenCalledTimes(1);
    expect(mockOpportunity.updateMany).toHaveBeenCalledTimes(1);
    expect(res[0]!.expired).toBe(1);
  });
});
