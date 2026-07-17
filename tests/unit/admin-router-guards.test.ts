// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';

/**
 * P-91 — Bug em prod (Fred, 2026-07-11): ANALISTA logado acessa
 * `/admin/conversion-rates` e vê a tabela de taxas. Mutations já eram
 * gated (adminOnlyProcedure), mas as QUERIES estavam abertas
 * (protectedProcedure = qualquer autenticado). Vazamento de leitura
 * cross-role.
 *
 * Este teste cobre TODAS as queries admin-only que foram gated no fix
 * P-91. Para cada uma:
 *   - role ANALISTA  → FORBIDDEN (throw TRPCError)
 *   - role GESTOR    → FORBIDDEN
 *   - role PARCEIRO  → FORBIDDEN
 *   - role ADMIN     → passa (mock resolve dados)
 *
 * O gate `adminOnlyProcedure` = `withRoles('ADMIN')`. Não passa pelo
 * middleware `withPermission`, então basta stubar Prisma pra rodar até
 * o final quando role=ADMIN.
 */

// ============ Prisma mock ============
const mockTenant = { findUnique: vi.fn() };
const mockApprovalRule = { findMany: vi.fn() };
const mockCompany = { findMany: vi.fn(), findFirst: vi.fn() };
const mockProduct = { findMany: vi.fn(), findFirst: vi.fn() };
const mockDocumentTemplate = { findMany: vi.fn() };
const mockAIUsageLog = { groupBy: vi.fn() };

vi.mock('@/server/db/client', () => ({
  prisma: {
    tenant: mockTenant,
    approvalRule: mockApprovalRule,
    company: mockCompany,
    product: mockProduct,
    documentTemplate: mockDocumentTemplate,
    aIUsageLog: mockAIUsageLog,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'user-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

// permissions.service — passe direto (adminOnlyProcedure não chama, mas
// alguma cascata pode invocar).
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: vi.fn(async () => true),
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
  defaultsForRole: vi.fn(() => []),
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: vi.fn(),
}));

// theme.service — não bater no cache real
vi.mock('@/server/services/theme.service', () => ({
  getThemeConfig: vi.fn(async () => ({})),
  updateThemeConfig: vi.fn(),
  ThemeUpdateError: class ThemeUpdateError extends Error {},
}));

vi.mock('@/server/services/wcag-validator.service', () => ({
  validateThemeCombinations: vi.fn(() => []),
}));

vi.mock('@/server/services/contrast-suggester.service', () => ({
  suggestContrastFix: vi.fn(() => ({})),
}));

// AI usage service — retorno mínimo pra query passar
vi.mock('@/server/services/ai-usage.service', () => ({
  getMonthlyUsage: vi.fn(async () => ({
    totalRequests: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    breakdown: [],
    totalFallbackTokens: 0,
    totalFallbackCostUsd: 0,
  })),
  AI_PRICING: {},
}));

function ctxFor(role: UserRole) {
  return {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: cada entrada é uma tupla [describe, factory, invoke].
 * factory devolve o caller pro role X. invoke chama a procedure sob teste.
 */
type GuardCase = {
  name: string;
  makeCaller: (role: UserRole) => Promise<unknown>;
  invoke: (caller: unknown) => Promise<unknown>;
  // stubs opcionais rodam antes do invoke ADMIN pra evitar erros de dados
  primeAdmin?: () => void;
};

const cases: GuardCase[] = [
  {
    name: 'reports.conversionRates',
    makeCaller: async (role) => {
      const { reportsRouter } = await import(
        '@/server/trpc/routers/reports'
      );
      return reportsRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { conversionRates: () => Promise<unknown> }).conversionRates(),
    primeAdmin: () =>
      mockTenant.findUnique.mockResolvedValueOnce({ conversionRates: null }),
  },
  {
    name: 'aiConfig.monthlyUsage',
    makeCaller: async (role) => {
      const { aiConfigRouter } = await import(
        '@/server/trpc/routers/ai-config'
      );
      return aiConfigRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { monthlyUsage: () => Promise<unknown> }).monthlyUsage(),
  },
  {
    name: 'aiConfig.pricingTable',
    makeCaller: async (role) => {
      const { aiConfigRouter } = await import(
        '@/server/trpc/routers/ai-config'
      );
      return aiConfigRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { pricingTable: () => Promise<unknown> }).pricingTable(),
  },
  {
    name: 'alerts.tenantConfig',
    makeCaller: async (role) => {
      const { alertsRouter } = await import(
        '@/server/trpc/routers/alerts'
      );
      return alertsRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { tenantConfig: () => Promise<unknown> }).tenantConfig(),
    primeAdmin: () =>
      mockTenant.findUnique.mockResolvedValueOnce({
        alertLeadDays: [7],
        centralCrmEmail: null,
        taskOverdueDays: 3,
      }),
  },
  {
    name: 'approvalRules.list',
    makeCaller: async (role) => {
      const { approvalRulesRouter } = await import(
        '@/server/trpc/routers/approval-rules'
      );
      return approvalRulesRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { list: () => Promise<unknown> }).list(),
    primeAdmin: () => mockApprovalRule.findMany.mockResolvedValueOnce([]),
  },
  {
    name: 'contractsConfig.getConfig',
    makeCaller: async (role) => {
      const { contractsConfigRouter } = await import(
        '@/server/trpc/routers/approval-rules'
      );
      return contractsConfigRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { getConfig: () => Promise<unknown> }).getConfig(),
    primeAdmin: () =>
      mockTenant.findUnique.mockResolvedValueOnce({
        handoffEmails: [],
        contractRenewalLeadDays: [90, 60, 30],
      }),
  },
  {
    name: 'theme.get',
    makeCaller: async (role) => {
      const { themeRouter } = await import('@/server/trpc/routers/theme');
      return themeRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { get: () => Promise<unknown> }).get(),
  },
  {
    name: 'partners.listWithStats',
    makeCaller: async (role) => {
      const { partnersRouter } = await import(
        '@/server/trpc/routers/partners'
      );
      return partnersRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { listWithStats: () => Promise<unknown> }).listWithStats(),
    primeAdmin: () => mockCompany.findMany.mockResolvedValueOnce([]),
  },
  {
    name: 'products.list',
    makeCaller: async (role) => {
      const { productsRouter } = await import(
        '@/server/trpc/routers/products'
      );
      return productsRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { list: (i: object) => Promise<unknown> }).list({}),
    primeAdmin: () => mockProduct.findMany.mockResolvedValueOnce([]),
  },
  {
    name: 'templates.list',
    makeCaller: async (role) => {
      const { templatesRouter } = await import(
        '@/server/trpc/routers/documents'
      );
      return templatesRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { list: () => Promise<unknown> }).list(),
    primeAdmin: () => mockDocumentTemplate.findMany.mockResolvedValueOnce([]),
  },
  {
    name: 'adminEmail.getSlug',
    makeCaller: async (role) => {
      const { adminEmailRouter } = await import(
        '@/server/trpc/routers/inbox'
      );
      return adminEmailRouter.createCaller(ctxFor(role));
    },
    invoke: async (c: unknown) =>
      (c as { getSlug: () => Promise<unknown> }).getSlug(),
    primeAdmin: () =>
      mockTenant.findUnique.mockResolvedValueOnce({ inboundEmailSlug: null }),
  },
];

describe('P-91 — Guards nas queries admin routers', () => {
  const nonAdminRoles: UserRole[] = ['ANALISTA', 'GESTOR', 'PARCEIRO'];

  for (const c of cases) {
    describe(c.name, () => {
      for (const role of nonAdminRoles) {
        it(`role=${role} → FORBIDDEN`, async () => {
          const caller = await c.makeCaller(role);
          await expect(c.invoke(caller)).rejects.toMatchObject({
            name: 'TRPCError',
            code: 'FORBIDDEN',
          });
        });
      }

      it('role=ADMIN → passa (não lança FORBIDDEN)', async () => {
        c.primeAdmin?.();
        const caller = await c.makeCaller('ADMIN');
        await expect(c.invoke(caller)).resolves.toBeDefined();
      });
    });
  }
});

// Mutations complementares testadas via smoke: garante que o gate
// admin já existente nas mutations (Sprint 8/15E) segue funcionando —
// prova de que nossa mudança de query pra `adminOnlyProcedure` não
// vira flaky se algum caller derrapar de query pra mutation.
describe('P-91 — Confirma que mutations admin não regridiram', () => {
  it('reports.updateConversionRates com ANALISTA → FORBIDDEN', async () => {
    const { reportsRouter } = await import('@/server/trpc/routers/reports');
    const caller = reportsRouter.createCaller(ctxFor('ANALISTA'));
    await expect(
      caller.updateConversionRates({
        rates: { PROSPECT: 5 } as Record<never, number>,
      }),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'FORBIDDEN' });
  });
});
