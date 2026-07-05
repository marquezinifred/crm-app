// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTenant = {
  findUnique: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { tenant: mockTenant },
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

vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

async function makeCaller(opts: {
  role?: 'ADMIN' | 'DIRETOR_COMERCIAL' | 'GESTOR' | 'ANALISTA' | 'PARCEIRO';
  tenantId?: string;
} = {}) {
  const { billingRouter } = await import('@/server/trpc/routers/billing');
  return billingRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: opts.tenantId ?? 'tenant-A',
    user: {
      id: 'user-1',
      email: 'a@b.co',
      fullName: 'Fred',
      role: (opts.role ?? 'DIRETOR_COMERCIAL') as never,
      tenantId: opts.tenantId ?? 'tenant-A',
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
});

describe('billingRouter.statusForBanner (P-56)', () => {
  it('retorna isPastDue=true quando subscriptionStatus=PAST_DUE', async () => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'STARTER',
      subscriptionStatus: 'PAST_DUE',
      trialEndsAt: null,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isPastDue).toBe(true);
    expect(result.isTrialExpiring).toBe(false);
    expect(result.subscriptionStatus).toBe('PAST_DUE');
  });

  it('retorna isPastDue=true também quando subscriptionStatus=CANCELED', async () => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'PRO',
      subscriptionStatus: 'CANCELED',
      trialEndsAt: null,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isPastDue).toBe(true);
    expect(result.isTrialExpiring).toBe(false);
  });

  it('retorna isTrialExpiring=true quando trial termina em menos de 7 dias', async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'TRIAL',
      subscriptionStatus: 'TRIALING',
      trialEndsAt,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isPastDue).toBe(false);
    expect(result.isTrialExpiring).toBe(true);
    expect(result.trialEndsAt?.getTime()).toBe(trialEndsAt.getTime());
  });

  it('retorna isTrialExpiring=false quando trial termina em mais de 7 dias', async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'TRIAL',
      subscriptionStatus: 'TRIALING',
      trialEndsAt,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isTrialExpiring).toBe(false);
  });

  it('retorna isTrialExpiring=false quando plan não é TRIAL mesmo com trialEndsAt setado', async () => {
    const trialEndsAt = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isTrialExpiring).toBe(false);
    expect(result.isPastDue).toBe(false);
  });

  it('retorna false pra ambos os flags quando ACTIVE + sem trial', async () => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    });
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isPastDue).toBe(false);
    expect(result.isTrialExpiring).toBe(false);
    expect(result.trialEndsAt).toBeNull();
  });

  it('retorna defaults quando tenant não encontrado', async () => {
    mockTenant.findUnique.mockResolvedValueOnce(null);
    const caller = await makeCaller();

    const result = await caller.statusForBanner();

    expect(result.isPastDue).toBe(false);
    expect(result.isTrialExpiring).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.subscriptionStatus).toBeNull();
    expect(result.trialEndsAt).toBeNull();
  });

  it('cross-tenant: filtra por ctx.tenantId (WHERE injection preservado)', async () => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    });
    const caller = await makeCaller({ tenantId: 'tenant-B' });

    await caller.statusForBanner();

    expect(mockTenant.findUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-B' },
      select: {
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });
  });

  it('funciona pra DIRETOR_COMERCIAL (P-56 bug reportado por fredmarquezini@hotmail.com)', async () => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'PRO',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    });
    const caller = await makeCaller({ role: 'DIRETOR_COMERCIAL' });

    await expect(caller.statusForBanner()).resolves.toMatchObject({
      isPastDue: false,
      isTrialExpiring: false,
    });
  });

  it.each([
    ['DIRETOR_COMERCIAL' as const],
    ['GESTOR' as const],
    ['ANALISTA' as const],
    ['PARCEIRO' as const],
  ])('não lança FORBIDDEN pra role %s (protectedProcedure basta)', async (role) => {
    mockTenant.findUnique.mockResolvedValueOnce({
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    });
    const caller = await makeCaller({ role });

    await expect(caller.statusForBanner()).resolves.toBeDefined();
  });
});
