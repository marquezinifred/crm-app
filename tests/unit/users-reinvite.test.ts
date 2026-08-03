// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';
process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.com';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// P-84 — reconvite reativa usuário soft-deleted em vez de colidir com o
// índice UNIQUE parcial (migration 0033 / P-83).
const mockUser = {
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
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

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
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

const SOFT_DELETED_ROW = {
  id: 'soft-1',
  tenantId: 'tenant-A',
  email: 'volta@x.co',
  fullName: 'Nome Antigo',
  role: 'ANALISTA' as const,
  active: false,
  deletedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usersRouter.invite — reconvite de soft-deleted (P-84)', () => {
  it('reativa a linha soft-deleted: deletedAt null, active=false, role/fullName atualizados', async () => {
    // 1ª findFirst (ativo) → null; 2ª findFirst (soft-deleted) → row
    mockUser.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(SOFT_DELETED_ROW);
    mockUser.update.mockResolvedValueOnce({
      ...SOFT_DELETED_ROW,
      deletedAt: null,
      role: 'GESTOR',
      fullName: 'Nome Novo',
      active: false,
    });

    const caller = await makeCaller();
    const res = await caller.invite({
      email: 'volta@x.co',
      fullName: 'Nome Novo',
      role: 'GESTOR',
    });

    expect(res).toEqual({ id: 'soft-1', email: 'volta@x.co', reactivated: true });

    // Query de soft-deleted usa tenantId EXPLÍCITO
    expect(mockUser.findFirst).toHaveBeenNthCalledWith(2, {
      where: { tenantId: 'tenant-A', email: 'volta@x.co', deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });

    // UPDATE de reativação
    const updateCall = mockUser.update.mock.calls[0]![0]!;
    expect(updateCall.where).toEqual({ id: 'soft-1' });
    expect(updateCall.data).toMatchObject({
      deletedAt: null,
      role: 'GESTOR',
      fullName: 'Nome Novo',
      active: false,
    });

    // NÃO cria linha nova
    expect(mockUser.create).not.toHaveBeenCalled();
  });

  it('reenvia o convite Clerk com publicMetadata.localUserId = id da linha reativada', async () => {
    mockUser.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(SOFT_DELETED_ROW);
    mockUser.update.mockResolvedValueOnce({
      ...SOFT_DELETED_ROW,
      deletedAt: null,
      role: 'GESTOR',
      fullName: 'Nome Novo',
      active: false,
    });

    const caller = await makeCaller();
    await caller.invite({ email: 'volta@x.co', fullName: 'Nome Novo', role: 'GESTOR' });

    expect(createInvitationSpy).toHaveBeenCalledTimes(1);
    const [arg] = createInvitationSpy.mock.calls[0] as unknown as [
      { emailAddress: string; publicMetadata: Record<string, unknown>; redirectUrl: string },
    ];
    expect(arg.emailAddress).toBe('volta@x.co');
    expect(arg.publicMetadata).toMatchObject({
      tenantId: 'tenant-A',
      role: 'GESTOR',
      localUserId: 'soft-1',
    });
    expect(arg.redirectUrl).toBe('https://crm.example.com/sign-up');
  });

  it('grava audit com before (soft-deleted), after (reativado) e tenantIdOverride', async () => {
    mockUser.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(SOFT_DELETED_ROW);
    const after = {
      ...SOFT_DELETED_ROW,
      deletedAt: null,
      role: 'GESTOR',
      fullName: 'Nome Novo',
      active: false,
    };
    mockUser.update.mockResolvedValueOnce(after);

    const caller = await makeCaller();
    await caller.invite({ email: 'volta@x.co', fullName: 'Nome Novo', role: 'GESTOR' });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'user.invite',
      tableName: 'users',
      recordId: 'soft-1',
      before: SOFT_DELETED_ROW,
      after,
      tenantIdOverride: 'tenant-A',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('e-mail com linha ATIVA ainda dá CONFLICT (não reativa nem cria)', async () => {
    mockUser.findFirst.mockResolvedValueOnce({
      id: 'active-1',
      tenantId: 'tenant-A',
      email: 'ativo@x.co',
      deletedAt: null,
    });

    const caller = await makeCaller();
    await expect(
      caller.invite({ email: 'ativo@x.co', fullName: 'Fulano', role: 'ANALISTA' }),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'CONFLICT' });

    // Só a checagem de ativo rodou; não consulta soft-deleted, não cria, não atualiza
    expect(mockUser.findFirst).toHaveBeenCalledTimes(1);
    expect(mockUser.create).not.toHaveBeenCalled();
    expect(mockUser.update).not.toHaveBeenCalled();
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });

  it('cross-tenant: soft-deleted em OUTRO tenant NÃO é reativado → cai no fluxo normal de create', async () => {
    // Ambas as queries filtram por tenantId=tenant-A; a linha soft-deleted vive
    // em tenant-B, então o DB retorna null nas duas → cria linha nova.
    mockUser.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockUser.create.mockResolvedValueOnce({
      id: 'new-1',
      tenantId: 'tenant-A',
      email: 'volta@x.co',
      fullName: 'Nome Novo',
      role: 'GESTOR',
      active: false,
    });

    const caller = await makeCaller();
    const res = await caller.invite({ email: 'volta@x.co', fullName: 'Nome Novo', role: 'GESTOR' });

    expect(res).toEqual({ id: 'new-1', email: 'volta@x.co', reactivated: false });

    // As duas queries carregam tenantId explícito
    expect(mockUser.findFirst).toHaveBeenNthCalledWith(1, {
      where: { tenantId: 'tenant-A', email: 'volta@x.co', deletedAt: null },
    });
    expect(mockUser.findFirst).toHaveBeenNthCalledWith(2, {
      where: { tenantId: 'tenant-A', email: 'volta@x.co', deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });

    // Fluxo normal: cria, não reativa
    expect(mockUser.create).toHaveBeenCalledTimes(1);
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it('rollback consistente quando createInvitation lança: restaura o estado soft-deleted e propaga erro', async () => {
    mockUser.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(SOFT_DELETED_ROW);
    mockUser.update
      .mockResolvedValueOnce({ ...SOFT_DELETED_ROW, deletedAt: null, active: false }) // reativação
      .mockResolvedValueOnce({ ...SOFT_DELETED_ROW }); // rollback
    createInvitationSpy.mockRejectedValueOnce(new Error('Clerk down'));

    const caller = await makeCaller();
    await expect(
      caller.invite({ email: 'volta@x.co', fullName: 'Nome Novo', role: 'GESTOR' }),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'INTERNAL_SERVER_ERROR' });

    // update chamado 2×: reativa e depois reverte
    expect(mockUser.update).toHaveBeenCalledTimes(2);
    const rollbackCall = mockUser.update.mock.calls[1]![0]!;
    expect(rollbackCall.where).toEqual({ id: 'soft-1' });
    expect(rollbackCall.data).toMatchObject({
      deletedAt: SOFT_DELETED_ROW.deletedAt,
      role: SOFT_DELETED_ROW.role,
      fullName: SOFT_DELETED_ROW.fullName,
      active: SOFT_DELETED_ROW.active,
    });

    // audit NÃO grava reativação que falhou
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe('usersRouter.invite — fluxo normal permanece intacto (P-84)', () => {
  it('sem linha prévia: cria usuário e retorna reactivated=false', async () => {
    mockUser.findFirst.mockResolvedValue(null);
    mockUser.create.mockResolvedValueOnce({
      id: 'local-1',
      tenantId: 'tenant-A',
      email: 'novo@x.co',
      fullName: 'Novo',
      role: 'ANALISTA',
      active: false,
    });

    const caller = await makeCaller();
    const res = await caller.invite({ email: 'novo@x.co', fullName: 'Novo', role: 'ANALISTA' });

    expect(res).toEqual({ id: 'local-1', email: 'novo@x.co', reactivated: false });
    expect(mockUser.create).toHaveBeenCalledTimes(1);
    expect(createInvitationSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]![0]!).toMatchObject({
      action: 'user.invite',
      recordId: 'local-1',
      tenantIdOverride: 'tenant-A',
    });
  });

  it('rollback do create (delete) quando createInvitation lança no fluxo normal', async () => {
    mockUser.findFirst.mockResolvedValue(null);
    mockUser.create.mockResolvedValueOnce({ id: 'local-1', email: 'novo@x.co' });
    createInvitationSpy.mockRejectedValueOnce(new Error('Clerk down'));

    const caller = await makeCaller();
    await expect(
      caller.invite({ email: 'novo@x.co', fullName: 'Novo', role: 'ANALISTA' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

    expect(mockUser.delete).toHaveBeenCalledWith({ where: { id: 'local-1' } });
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
