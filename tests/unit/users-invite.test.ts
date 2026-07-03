// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';
process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.com';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = {
  findFirst: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { user: mockUser },
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

const createInvitationSpy = vi.fn(async () => ({ id: 'inv_1' }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: () => ({
    invitations: {
      createInvitation: createInvitationSpy,
    },
  }),
}));

async function makeCaller() {
  const { usersRouter } = await import('@/server/trpc/routers/users');
  return usersRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: 'tenant-A',
    user: {
      id: 'user-1',
      email: 'admin@x.co',
      fullName: 'Admin',
      role: 'ADMIN',
      tenantId: 'tenant-A',
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
  mockUser.findFirst.mockResolvedValue(null);
  mockUser.create.mockResolvedValue({
    id: 'local-user-1',
    tenantId: 'tenant-A',
    email: 'new@x.co',
    fullName: 'Novo Convidado',
    role: 'ANALISTA',
    active: false,
  });
});

describe('usersRouter.invite — Clerk redirectUrl (staging fix 2026-07-03)', () => {
  it('envia o convite Clerk com redirectUrl terminando em /sign-up', async () => {
    const caller = await makeCaller();

    await caller.invite({
      email: 'new@x.co',
      fullName: 'Novo Convidado',
      role: 'ANALISTA',
    });

    expect(createInvitationSpy).toHaveBeenCalledTimes(1);
    const [arg] = createInvitationSpy.mock.calls[0] as unknown as [
      { redirectUrl: string },
    ];
    expect(arg.redirectUrl).toBe('https://crm.example.com/sign-up');
    expect(arg.redirectUrl.endsWith('/sign-up')).toBe(true);
    expect(arg.redirectUrl).not.toMatch(/\/$/);
  });

  it('mantém publicMetadata com tenantId/role/localUserId', async () => {
    const caller = await makeCaller();

    await caller.invite({
      email: 'new@x.co',
      fullName: 'Novo Convidado',
      role: 'GESTOR',
    });

    const [arg] = createInvitationSpy.mock.calls[0] as unknown as [
      { publicMetadata: Record<string, unknown>; emailAddress: string },
    ];
    expect(arg.emailAddress).toBe('new@x.co');
    expect(arg.publicMetadata).toMatchObject({
      tenantId: 'tenant-A',
      role: 'GESTOR',
      localUserId: 'local-user-1',
    });
  });
});
