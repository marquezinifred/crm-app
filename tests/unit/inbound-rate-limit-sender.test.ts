// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P-29 — Rate limit por sender email em leads inbound.
 *
 * Complementa PUBLIC_FORM_LIMIT (por IP, Sprint 11): endpoint público já
 * trava IP, mas Zapier/integradores mandam de IPs rotativos. Aqui capamos
 * 10 leads/hora por email dentro do mesmo tenant, gravando os excedentes
 * em inbound_leads_rejected com reason='rate_limited_per_sender'.
 *
 * Coverage:
 *   1. Primeiro lead do email X → cria opp normal
 *   2. 10º lead do email X (limite exato) → ainda cria opp
 *   3. 11º lead do email X → rejected com reason='rate_limited_per_sender'
 *   4. Emails diferentes não compartilham contador
 *   5. Tenants diferentes não compartilham contador (isolamento)
 *   6. Case-insensitive: ABC@X.com == abc@x.com
 *   7. Lead sem contact.email pula o gate (pattern preservado)
 *   8. Redis "abrindo" (allowed=true) → cria opp normal
 */

const {
  mockInboundLeadRejected,
  mockInboundCaptureConfig,
  mockCompany,
  mockContact,
  mockLeadSource,
  mockOpportunity,
  parseLeadMock,
  checkRateMock,
} = vi.hoisted(() => ({
  mockInboundLeadRejected: { create: vi.fn() },
  mockInboundCaptureConfig: { findUnique: vi.fn() },
  mockCompany: { findFirst: vi.fn(), create: vi.fn() },
  mockContact: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  mockLeadSource: { findFirst: vi.fn(), create: vi.fn() },
  mockOpportunity: { create: vi.fn() },
  parseLeadMock: vi.fn(),
  checkRateMock: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({
  prisma: {
    inboundLeadRejected: mockInboundLeadRejected,
    inboundCaptureConfig: mockInboundCaptureConfig,
    company: mockCompany,
    contact: mockContact,
    leadSource: mockLeadSource,
    opportunity: mockOpportunity,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

vi.mock('@/server/services/inbound-parser.service', () => ({
  parseLead: (opts: unknown) => parseLeadMock(opts),
}));

vi.mock('@/server/services/rate-limiter.service', async () => {
  const actual = await vi.importActual<typeof import('@/server/services/rate-limiter.service')>(
    '@/server/services/rate-limiter.service',
  );
  return {
    ...actual,
    checkRate: (...args: unknown[]) => checkRateMock(...args),
  };
});

// Dynamic imports pra deixar `process.env.??=` acima rodar antes de src/lib/env.ts
// carregar (padrão do inbound-assign-push.test.ts). Cachea entre chamadas.
let _mod: typeof import('@/server/services/inbound-lead-creator.service') | undefined;
let _rl: typeof import('@/server/services/rate-limiter.service') | undefined;
async function createInboundLead(
  ...args: Parameters<typeof import('@/server/services/inbound-lead-creator.service').createInboundLead>
) {
  _mod ??= await import('@/server/services/inbound-lead-creator.service');
  return _mod.createInboundLead(...args);
}
async function getRateLimiterHelpers() {
  _rl ??= await import('@/server/services/rate-limiter.service');
  return { SENDER_INBOUND_LIMIT: _rl.SENDER_INBOUND_LIMIT, senderInboundKey: _rl.senderInboundKey };
}

function makeParsed(overrides: { email?: string | undefined; confidence?: number } = {}) {
  const email = 'email' in overrides ? overrides.email : 'lead@empresa.com';
  const confidence = overrides.confidence ?? 0.9;
  return {
    contact: { name: 'Fulano', email, phone: undefined, role: undefined },
    company: { name: 'ACME LTDA', cnpj: undefined },
    interest: { message: 'Quero conhecer', estimatedValue: undefined, expectedCloseAt: undefined },
    confidence,
    parsedBy: 'regex:test',
  };
}

function stubCreatePath() {
  // Nenhuma config → blacklist vazia
  mockInboundCaptureConfig.findUnique.mockResolvedValue(null);
  // Company nova
  mockCompany.findFirst.mockResolvedValue(null);
  mockCompany.create.mockResolvedValue({
    id: 'co-1',
    tenantId: 'tenant-A',
    razaoSocial: 'ACME LTDA',
  });
  // Contact novo
  mockContact.findFirst.mockResolvedValue(null);
  mockContact.create.mockResolvedValue({
    id: 'ct-1',
    tenantId: 'tenant-A',
    companyId: 'co-1',
    email: 'lead@empresa.com',
  });
  // LeadSource cai no create
  mockLeadSource.findFirst.mockResolvedValue(null);
  mockLeadSource.create.mockResolvedValue({ id: 'ls-1', name: 'Inbound' });
  // Opp
  mockOpportunity.create.mockResolvedValue({
    id: 'opp-1',
    tenantId: 'tenant-A',
    stage: 'PROSPECT',
  });
  // Rejected fallback também precisa retornar id
  mockInboundLeadRejected.create.mockResolvedValue({ id: 'rej-1' });
}

const baseInput = {
  tenantId: 'tenant-A',
  source: 'webhook_custom' as const,
  raw: { text: 'lead' },
};

beforeEach(() => {
  vi.clearAllMocks();
  stubCreatePath();
  parseLeadMock.mockResolvedValue(makeParsed());
  // Redis "aberto" por padrão — allowed=true
  checkRateMock.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: new Date(Date.now() + 3_600_000),
  });
});

describe('P-29 — rate limit por sender email', () => {
  it('primeiro lead do email → chama checkRate com a key correta e cria opp', async () => {
    const { SENDER_INBOUND_LIMIT, senderInboundKey } = await getRateLimiterHelpers();
    const result = await createInboundLead(baseInput);

    expect(result).toMatchObject({ kind: 'created', opportunityId: 'opp-1' });
    expect(checkRateMock).toHaveBeenCalledTimes(1);
    expect(checkRateMock).toHaveBeenCalledWith(
      senderInboundKey('tenant-A', 'lead@empresa.com'),
      SENDER_INBOUND_LIMIT.limit,
      SENDER_INBOUND_LIMIT.windowSeconds,
    );
    expect(mockOpportunity.create).toHaveBeenCalledTimes(1);
    expect(mockInboundLeadRejected.create).not.toHaveBeenCalled();
  });

  it('10º lead do email (dentro do limite) ainda cria opp', async () => {
    checkRateMock.mockResolvedValueOnce({
      allowed: true,
      remaining: 0,
      resetAt: new Date(Date.now() + 3_600_000),
    });

    const result = await createInboundLead(baseInput);

    expect(result).toMatchObject({ kind: 'created' });
    expect(mockOpportunity.create).toHaveBeenCalledTimes(1);
    expect(mockInboundLeadRejected.create).not.toHaveBeenCalled();
  });

  it('11º lead do email → rejected com reason=rate_limited_per_sender', async () => {
    checkRateMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });

    const result = await createInboundLead(baseInput);

    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'rate_limited_per_sender',
      rejectedId: 'rej-1',
    });
    expect(mockOpportunity.create).not.toHaveBeenCalled();
    expect(mockCompany.create).not.toHaveBeenCalled();
    expect(mockContact.create).not.toHaveBeenCalled();
    expect(mockInboundLeadRejected.create).toHaveBeenCalledTimes(1);
    expect(mockInboundLeadRejected.create.mock.calls[0]![0].data).toMatchObject({
      tenantId: 'tenant-A',
      reason: 'rate_limited_per_sender',
    });
  });

  it('emails diferentes não compartilham contador (keys distintas)', async () => {
    const { senderInboundKey } = await getRateLimiterHelpers();
    parseLeadMock
      .mockResolvedValueOnce(makeParsed({ email: 'a@x.com' }))
      .mockResolvedValueOnce(makeParsed({ email: 'b@x.com' }));

    await createInboundLead(baseInput);
    await createInboundLead(baseInput);

    expect(checkRateMock).toHaveBeenCalledTimes(2);
    const keyA = checkRateMock.mock.calls[0]![0];
    const keyB = checkRateMock.mock.calls[1]![0];
    expect(keyA).toBe(senderInboundKey('tenant-A', 'a@x.com'));
    expect(keyB).toBe(senderInboundKey('tenant-A', 'b@x.com'));
    expect(keyA).not.toBe(keyB);
  });

  it('tenants diferentes → keys isoladas mesmo com mesmo email', async () => {
    const { senderInboundKey } = await getRateLimiterHelpers();
    parseLeadMock
      .mockResolvedValueOnce(makeParsed({ email: 'same@empresa.com' }))
      .mockResolvedValueOnce(makeParsed({ email: 'same@empresa.com' }));

    await createInboundLead({ ...baseInput, tenantId: 'tenant-A' });
    await createInboundLead({ ...baseInput, tenantId: 'tenant-B' });

    expect(checkRateMock.mock.calls[0]![0]).toBe(
      senderInboundKey('tenant-A', 'same@empresa.com'),
    );
    expect(checkRateMock.mock.calls[1]![0]).toBe(
      senderInboundKey('tenant-B', 'same@empresa.com'),
    );
    expect(checkRateMock.mock.calls[0]![0]).not.toBe(checkRateMock.mock.calls[1]![0]);
  });

  it('case-insensitive: ABC@X.com e abc@x.com viram a mesma key', async () => {
    const { senderInboundKey } = await getRateLimiterHelpers();
    parseLeadMock
      .mockResolvedValueOnce(makeParsed({ email: 'ABC@X.com' }))
      .mockResolvedValueOnce(makeParsed({ email: 'abc@x.com' }));

    await createInboundLead(baseInput);
    await createInboundLead(baseInput);

    expect(checkRateMock.mock.calls[0]![0]).toBe(checkRateMock.mock.calls[1]![0]);
    expect(checkRateMock.mock.calls[0]![0]).toBe(
      senderInboundKey('tenant-A', 'abc@x.com'),
    );
  });

  it('lead sem contact.email → pula rate limit e cria opp normal', async () => {
    parseLeadMock.mockResolvedValueOnce(makeParsed({ email: undefined }));
    mockContact.create.mockResolvedValueOnce({
      id: 'ct-2',
      email: 'sem-email+placeholder@lead-inbound.local',
    });

    const result = await createInboundLead(baseInput);

    expect(result).toMatchObject({ kind: 'created' });
    expect(checkRateMock).not.toHaveBeenCalled();
    expect(mockOpportunity.create).toHaveBeenCalledTimes(1);
  });

  it('helper SENDER_INBOUND_LIMIT tem shape { limit, windowSeconds }', async () => {
    const { SENDER_INBOUND_LIMIT } = await getRateLimiterHelpers();
    expect(SENDER_INBOUND_LIMIT).toEqual({ limit: 10, windowSeconds: 60 * 60 });
  });

  it('senderInboundKey inclui prefixo, tenantId e email lowercased', async () => {
    const { senderInboundKey } = await getRateLimiterHelpers();
    expect(senderInboundKey('tenant-XYZ', 'LEAD@Example.COM')).toBe(
      'inbound:sender:tenant-XYZ:lead@example.com',
    );
  });
});
