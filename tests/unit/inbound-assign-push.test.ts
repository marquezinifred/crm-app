// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P-31 — Push nativo pro vendedor alocado (best-effort).
 *
 * Coverage:
 *   1. Alocação bem-sucedida dispara sendPushToUser com args esperados
 *   2. Push falha (mock rejeitando) NÃO desfaz a alocação (best-effort)
 *   3. Push success — mutation retorna ok + push registrada
 *   4. Cross-tenant: opp de outro tenant → NOT_FOUND, push NÃO chamada
 *   5. clientCompany nulo/sem razaoSocial → fallback "Empresa"
 */

const mockOpp = {
  findFirst: vi.fn(),
  update: vi.fn(),
};
const mockUser = {
  findFirst: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { opportunity: mockOpp, user: mockUser },
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

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

const pushSpy = vi.fn();
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: (userId: string, payload: unknown) => pushSpy(userId, payload),
}));

type TenantCtx = {
  req: Request;
  tenantId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
    partnerCompanyId: null;
  };
  platformUser: null;
  platformRole: null;
  ip: string;
  userAgent: string;
};

async function makeCaller(tenantId = 'tenant-A') {
  const { inboundRouter } = await import('@/server/trpc/routers/inbound');
  const ctx: TenantCtx = {
    req: new Request('http://localhost/test'),
    tenantId,
    user: {
      id: 'user-1',
      email: 'admin@empresa.com',
      fullName: 'Admin',
      role: 'ADMIN',
      tenantId,
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inboundRouter.createCaller(ctx as any);
}

const validOppId = '11111111-1111-1111-1111-111111111111';
const validOwnerId = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  pushSpy.mockResolvedValue({ sent: 1, failed: 0 });
});

// Deixa o microtask do push best-effort resolver antes das assertions
async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
}

describe('inboundRouter.assignInbound — P-31 push nativo', () => {
  it('dispara sendPushToUser com título/body/url esperados após alocar', async () => {
    mockOpp.findFirst.mockResolvedValueOnce({
      id: 'opp-abc',
      title: 'Lead X',
      stage: 'PROSPECT',
      clientCompany: { razaoSocial: 'ACME LTDA' },
    });
    mockUser.findFirst.mockResolvedValueOnce({
      id: validOwnerId,
      fullName: 'Vendedor',
      email: 'v@empresa.com',
    });
    mockOpp.update.mockResolvedValueOnce({
      id: 'opp-abc',
      ownerId: validOwnerId,
      stage: 'PROSPECT',
    });

    const caller = await makeCaller();
    const result = await caller.assignInbound({
      opportunityId: validOppId,
      ownerId: validOwnerId,
    });
    await flushMicrotasks();

    expect(result).toMatchObject({ id: 'opp-abc', ownerId: validOwnerId });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(validOwnerId, {
      title: 'Novo prospect atribuído',
      body: 'ACME LTDA — comece a qualificação.',
      url: '/pipeline/opp-abc',
    });
  });

  it('mutation retorna ok mesmo se push falhar (best-effort)', async () => {
    mockOpp.findFirst.mockResolvedValueOnce({
      id: 'opp-abc',
      title: 'Lead X',
      stage: 'PROSPECT',
      clientCompany: { razaoSocial: 'ACME LTDA' },
    });
    mockUser.findFirst.mockResolvedValueOnce({
      id: validOwnerId,
      fullName: 'Vendedor',
      email: 'v@empresa.com',
    });
    mockOpp.update.mockResolvedValueOnce({
      id: 'opp-abc',
      ownerId: validOwnerId,
      stage: 'PROSPECT',
    });
    pushSpy.mockRejectedValueOnce(new Error('push service down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const caller = await makeCaller();
    await expect(
      caller.assignInbound({ opportunityId: validOppId, ownerId: validOwnerId }),
    ).resolves.toMatchObject({ id: 'opp-abc', ownerId: validOwnerId });

    await flushMicrotasks();

    expect(mockOpp.update).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    // Falha deve ter caído no .catch com console.warn
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0]!;
    expect(String(warnArgs[0])).toContain('[inbound.assignInbound] push falhou');

    warnSpy.mockRestore();
  });

  it('cross-tenant: opp de outro tenant → NOT_FOUND, push NÃO chamada', async () => {
    mockOpp.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller('tenant-A');
    await expect(
      caller.assignInbound({ opportunityId: validOppId, ownerId: validOwnerId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockOpp.findFirst).toHaveBeenCalledWith({
      where: {
        id: validOppId,
        tenantId: 'tenant-A',
        isInbound: true,
        ownerId: null,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        stage: true,
        clientCompany: { select: { razaoSocial: true } },
      },
    });
    expect(mockOpp.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('clientCompany sem razaoSocial → fallback "Empresa" no body', async () => {
    mockOpp.findFirst.mockResolvedValueOnce({
      id: 'opp-abc',
      title: 'Lead X',
      stage: 'PROSPECT',
      clientCompany: null,
    });
    mockUser.findFirst.mockResolvedValueOnce({
      id: validOwnerId,
      fullName: 'Vendedor',
      email: 'v@empresa.com',
    });
    mockOpp.update.mockResolvedValueOnce({
      id: 'opp-abc',
      ownerId: validOwnerId,
      stage: 'PROSPECT',
    });

    const caller = await makeCaller();
    await caller.assignInbound({
      opportunityId: validOppId,
      ownerId: validOwnerId,
    });
    await flushMicrotasks();

    expect(pushSpy).toHaveBeenCalledWith(validOwnerId, {
      title: 'Novo prospect atribuído',
      body: 'Empresa — comece a qualificação.',
      url: '/pipeline/opp-abc',
    });
  });

  it('vendedor inativo → BAD_REQUEST, sem update, sem push', async () => {
    mockOpp.findFirst.mockResolvedValueOnce({
      id: 'opp-abc',
      title: 'Lead X',
      stage: 'PROSPECT',
      clientCompany: { razaoSocial: 'ACME' },
    });
    mockUser.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller();
    await expect(
      caller.assignInbound({ opportunityId: validOppId, ownerId: validOwnerId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockOpp.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
