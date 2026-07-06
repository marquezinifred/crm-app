// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P-30 — Router de revisão de leads rejeitados.
 *
 * Coverage:
 *   1. rejectedList com filtro por reason (extension) — startsWith em parse_error
 *   2. rejectedPromote bypassa confidence + blacklist e cria opp
 *   3. rejectedPromote BAD_REQUEST quando parsedJson=null
 *   4. rejectedPromote BAD_REQUEST quando status != pending
 *   5. rejectedPromote marca como promoted + audit + retorna opportunityId
 *   6. rejectedRetryParser re-executa parser sem promover
 *   7. Cross-tenant NOT_FOUND (promote e retry)
 *   8. RBAC: user sem inbound:configure recebe FORBIDDEN
 */

const mockRejected = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    inboundLeadRejected: mockRejected,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'user-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

const hasPermissionMock = vi.fn(async (userId: string, permission: string) => {
  void userId;
  void permission;
  return true;
});
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (userId: string, permission: string) =>
    hasPermissionMock(userId, permission),
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

// createInboundLead sempre retorna "created" com opportunityId previsível pra
// isolar o comportamento do router. Os testes do service em si já cobrem
// forcePromoted + preParsed em cases separados abaixo.
const createInboundLeadSpy = vi.fn();
vi.mock('@/server/services/inbound-lead-creator.service', () => ({
  createInboundLead: (input: unknown) => createInboundLeadSpy(input),
}));

// parseLead: mock configurável por teste
const parseLeadSpy = vi.fn();
vi.mock('@/server/services/inbound-parser.service', () => ({
  parseLead: (input: unknown) => parseLeadSpy(input),
}));

// Push (usado por assignInbound — não deve ser chamada pelos endpoints
// de rejected, mas mockamos pra evitar imports pesados no test setup).
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: vi.fn(async () => ({ sent: 1, failed: 0 })),
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

async function makeCaller(tenantId = 'tenant-A', userId = 'user-1') {
  const { inboundRouter } = await import('@/server/trpc/routers/inbound');
  const ctx: TenantCtx = {
    req: new Request('http://localhost/test'),
    tenantId,
    user: {
      id: userId,
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

const REJECTED_ID = '11111111-1111-1111-1111-111111111111';

const baseRejectedRow = {
  id: REJECTED_ID,
  tenantId: 'tenant-A',
  source: 'webhook_custom',
  rawPayload: { text: 'Nome: Fulano\nEmail: fulano@acme.com' } as unknown,
  parsedJson: {
    contact: { name: 'Fulano', email: 'fulano@acme.com' },
    company: { name: 'ACME' },
    interest: { message: 'Quero saber mais' },
    confidence: '0.35',
    parsedBy: 'regex:plain-key-value',
  } as unknown,
  confidence: 0.35,
  reason: 'low_confidence',
  receivedAt: new Date('2026-06-01T10:00:00Z'),
  reviewedById: null,
  reviewedAt: null,
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
  createInboundLeadSpy.mockResolvedValue({
    kind: 'created',
    opportunityId: 'opp-created-abc',
    parsed: baseRejectedRow.parsedJson,
  });
});

describe('inbound.rejectedList — P-30 filtro por reason', () => {
  it('filtra por reason=blacklisted_domain exatamente', async () => {
    mockRejected.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller();
    await caller.rejectedList({ reason: 'blacklisted_domain', take: 25 });
    expect(mockRejected.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-A',
          reason: 'blacklisted_domain',
        }),
      }),
    );
  });

  it('filtra por reason=parse_error com startsWith (parse_error:X casa)', async () => {
    mockRejected.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller();
    await caller.rejectedList({ reason: 'parse_error', take: 10 });
    expect(mockRejected.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-A',
          reason: { startsWith: 'parse_error' },
        }),
      }),
    );
  });

  it('sem reason: retorna todos os motivos do tenant', async () => {
    mockRejected.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller();
    await caller.rejectedList({ take: 30 });
    const call = mockRejected.findMany.mock.calls[0]![0];
    expect(call.where).toEqual({ tenantId: 'tenant-A' });
  });

  it('combina reason + status no where', async () => {
    mockRejected.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller();
    await caller.rejectedList({
      reason: 'low_confidence',
      status: 'pending',
      take: 25,
    });
    expect(mockRejected.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-A',
          status: 'pending',
          reason: 'low_confidence',
        },
      }),
    );
  });
});

describe('inbound.rejectedPromote — P-30 bypassa confidence + blacklist', () => {
  it('chama createInboundLead com forcePromoted=true e preParsed reconstruído', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    mockRejected.update.mockResolvedValueOnce({ ...baseRejectedRow, status: 'promoted' });

    const caller = await makeCaller();
    const result = await caller.rejectedPromote({ id: REJECTED_ID });

    expect(result).toEqual({ ok: true, opportunityId: 'opp-created-abc' });
    expect(createInboundLeadSpy).toHaveBeenCalledTimes(1);
    const invokeArg = createInboundLeadSpy.mock.calls[0]![0];
    expect(invokeArg).toMatchObject({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      forcePromoted: true,
      raw: baseRejectedRow.rawPayload,
    });
    // confidence foi persistida como string ("0.35") mas deve chegar no
    // service como number
    expect(invokeArg.preParsed.confidence).toBe(0.35);
    expect(invokeArg.preParsed.contact.email).toBe('fulano@acme.com');
    expect(mockRejected.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REJECTED_ID },
        data: expect.objectContaining({ status: 'promoted', reviewedById: 'user-1' }),
      }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.rejected.promoted',
        tenantIdOverride: 'tenant-A',
        after: expect.objectContaining({
          status: 'promoted',
          opportunityId: 'opp-created-abc',
        }),
      }),
    );
  });

  it('BAD_REQUEST quando parsedJson é null (precisa retry parser primeiro)', async () => {
    mockRejected.findFirst.mockResolvedValueOnce({
      ...baseRejectedRow,
      parsedJson: null,
    });
    const caller = await makeCaller();
    await expect(caller.rejectedPromote({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(createInboundLeadSpy).not.toHaveBeenCalled();
    expect(mockRejected.update).not.toHaveBeenCalled();
  });

  it('BAD_REQUEST quando status != pending (já revisado)', async () => {
    mockRejected.findFirst.mockResolvedValueOnce({
      ...baseRejectedRow,
      status: 'discarded',
    });
    const caller = await makeCaller();
    await expect(caller.rejectedPromote({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(createInboundLeadSpy).not.toHaveBeenCalled();
  });

  it('cross-tenant NOT_FOUND (rejected de outro tenant)', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller('tenant-A');
    await expect(caller.rejectedPromote({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mockRejected.findFirst).toHaveBeenCalledWith({
      where: { id: REJECTED_ID, tenantId: 'tenant-A' },
    });
    expect(createInboundLeadSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('INTERNAL_SERVER_ERROR quando service devolve rejected em vez de created', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    createInboundLeadSpy.mockResolvedValueOnce({
      kind: 'rejected',
      rejectedId: 'nested-rej',
      reason: 'no_signal',
    });
    const caller = await makeCaller();
    await expect(caller.rejectedPromote({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(mockRejected.update).not.toHaveBeenCalled();
  });
});

describe('inbound.rejectedRetryParser — P-30', () => {
  it('re-executa parser e retorna preview com wouldPromote quando confidence ≥ 0.4', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    parseLeadSpy.mockResolvedValueOnce({
      contact: { email: 'fulano@acme.com' },
      company: {},
      interest: {},
      confidence: 0.72,
      parsedBy: 'ai:claude-haiku',
    });
    const caller = await makeCaller();
    const result = await caller.rejectedRetryParser({ id: REJECTED_ID });

    expect(parseLeadSpy).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      raw: baseRejectedRow.rawPayload,
      source: 'webhook_custom',
    });
    expect(result.wouldPromote).toBe(true);
    expect(result.parsed?.confidence).toBe(0.72);
    // NÃO altera o registro
    expect(mockRejected.update).not.toHaveBeenCalled();
    // NÃO cria opp
    expect(createInboundLeadSpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.rejected.retry_parser',
        tenantIdOverride: 'tenant-A',
      }),
    );
  });

  it('wouldPromote=false quando confidence continua abaixo de 0.4', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    parseLeadSpy.mockResolvedValueOnce({
      contact: { email: 'x@y.com' },
      company: {},
      interest: {},
      confidence: 0.3,
      parsedBy: 'regex:plain-key-value',
    });
    const caller = await makeCaller();
    const result = await caller.rejectedRetryParser({ id: REJECTED_ID });
    expect(result.wouldPromote).toBe(false);
  });

  it('wouldPromote=false quando parser volta null', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    parseLeadSpy.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    const result = await caller.rejectedRetryParser({ id: REJECTED_ID });
    expect(result.parsed).toBeNull();
    expect(result.wouldPromote).toBe(false);
  });

  it('cross-tenant NOT_FOUND (não chama parseLead)', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller('tenant-A');
    await expect(caller.rejectedRetryParser({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(parseLeadSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('INTERNAL_SERVER_ERROR quando parseLead throw', async () => {
    mockRejected.findFirst.mockResolvedValueOnce(baseRejectedRow);
    parseLeadSpy.mockRejectedValueOnce(new Error('provider 500'));
    const caller = await makeCaller();
    await expect(caller.rejectedRetryParser({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('inbound rejected — RBAC', () => {
  it('user sem inbound:configure → FORBIDDEN em rejectedPromote', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);
    const caller = await makeCaller();
    await expect(caller.rejectedPromote({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Não chega a bater no Prisma
    expect(mockRejected.findFirst).not.toHaveBeenCalled();
  });

  it('user sem inbound:configure → FORBIDDEN em rejectedRetryParser', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);
    const caller = await makeCaller();
    await expect(caller.rejectedRetryParser({ id: REJECTED_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(parseLeadSpy).not.toHaveBeenCalled();
  });

  it('user sem inbound:view_queue → FORBIDDEN em rejectedList', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);
    const caller = await makeCaller();
    await expect(caller.rejectedList({ take: 30 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
