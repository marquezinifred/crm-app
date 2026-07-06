// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P-30 — createInboundLead com forcePromoted + preParsed.
 *
 * Cobertura:
 *   1. Sem forcePromoted + confidence < 0.4 → rejected (comportamento pré-P-30)
 *   2. Com forcePromoted + confidence < 0.4 → created (bypass do check)
 *   3. Sem forcePromoted + email blacklisted → rejected
 *   4. Com forcePromoted + email blacklisted → created (bypass)
 *   5. preParsed presente pula parseLead (não chama IA)
 *   6. Sem preParsed + sem forcePromoted → path legado inalterado
 */

const parseLeadSpy = vi.fn();
vi.mock('@/server/services/inbound-parser.service', () => ({
  parseLead: (opts: unknown) => parseLeadSpy(opts),
}));

const mockPrisma = {
  inboundCaptureConfig: { findUnique: vi.fn() },
  company: { findFirst: vi.fn(), create: vi.fn() },
  contact: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  leadSource: { findFirst: vi.fn(), create: vi.fn() },
  opportunity: { create: vi.fn() },
  inboundLeadRejected: { create: vi.fn() },
};

vi.mock('@/server/db/client', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: null }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

const BASE_PARSED = {
  contact: { email: 'lead@blacklisted-domain.com', name: 'Lead X' },
  company: { name: 'ACME LTDA' },
  interest: { message: 'Interesse teste' },
  confidence: 0.35, // ABAIXO do MIN_CONFIDENCE=0.4
  parsedBy: 'test',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.inboundCaptureConfig.findUnique.mockResolvedValue({
    blacklistDomains: ['blacklisted-domain.com'],
  });
  mockPrisma.company.findFirst.mockResolvedValue(null);
  mockPrisma.company.create.mockResolvedValue({
    id: 'comp-1',
    razaoSocial: 'ACME LTDA',
  });
  mockPrisma.contact.findFirst.mockResolvedValue(null);
  mockPrisma.contact.create.mockResolvedValue({ id: 'ct-1' });
  mockPrisma.leadSource.findFirst.mockResolvedValue({
    id: 'ls-1',
    name: 'Inbound',
  });
  mockPrisma.opportunity.create.mockResolvedValue({
    id: 'opp-1',
    title: 'ACME',
  });
  mockPrisma.inboundLeadRejected.create.mockResolvedValue({ id: 'rej-1' });
});

describe('createInboundLead — P-30 forcePromoted flag', () => {
  it('sem forcePromoted + confidence 0.35 (< 0.4) → rejected low_confidence', async () => {
    parseLeadSpy.mockResolvedValueOnce({
      ...BASE_PARSED,
      contact: { email: 'ok@domain.com' }, // não-blacklisted
      confidence: 0.35,
    });
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    const result = await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'nome: fulano',
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.reason).toBe('low_confidence');
    }
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });

  it('COM forcePromoted + confidence 0.35 → created (bypass do check)', async () => {
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    const result = await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'nome: fulano',
      preParsed: {
        ...BASE_PARSED,
        contact: { email: 'ok@domain.com' },
        confidence: 0.35,
      },
      forcePromoted: true,
    });
    expect(result.kind).toBe('created');
    expect(mockPrisma.opportunity.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.inboundLeadRejected.create).not.toHaveBeenCalled();
    // Não chamou parseLead porque preParsed já veio
    expect(parseLeadSpy).not.toHaveBeenCalled();
  });

  it('sem forcePromoted + email blacklisted → rejected', async () => {
    parseLeadSpy.mockResolvedValueOnce({
      ...BASE_PARSED,
      confidence: 0.9, // alta confidence, mas blacklisted
    });
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    const result = await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'nome: fulano',
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.reason).toBe('blacklisted_domain');
    }
  });

  it('COM forcePromoted + email blacklisted → created', async () => {
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    const result = await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'nome: fulano',
      preParsed: { ...BASE_PARSED, confidence: 0.9 }, // email do BASE_PARSED bate blacklist
      forcePromoted: true,
    });
    expect(result.kind).toBe('created');
    expect(mockPrisma.opportunity.create).toHaveBeenCalledTimes(1);
    expect(parseLeadSpy).not.toHaveBeenCalled();
  });

  it('preParsed presente pula parseLead mesmo sem forcePromoted', async () => {
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'irrelevante',
      preParsed: {
        ...BASE_PARSED,
        contact: { email: 'ok@limpo.com' },
        confidence: 0.9,
      },
    });
    expect(parseLeadSpy).not.toHaveBeenCalled();
    expect(mockPrisma.opportunity.create).toHaveBeenCalledTimes(1);
  });

  it('sem preParsed e sem forcePromoted: chama parseLead (path legado preservado)', async () => {
    parseLeadSpy.mockResolvedValueOnce({
      ...BASE_PARSED,
      contact: { email: 'ok@ok.com' },
      confidence: 0.9,
    });
    const { createInboundLead } = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    await createInboundLead({
      tenantId: 'tenant-A',
      source: 'webhook_custom',
      raw: 'texto que precisa parse',
    });
    expect(parseLeadSpy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.opportunity.create).toHaveBeenCalledTimes(1);
  });
});
