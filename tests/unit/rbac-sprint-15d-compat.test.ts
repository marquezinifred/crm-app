// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-24 — Sprint 15D compat: users antes com GESTOR_INBOUND (agora ADMIN +
//          4 overrides inbound) continuam acessando /inbox/prospects.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TENANT_A,
  USER_IDS,
  makeCtx,
  makeOverride,
  makeUser,
} from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();
const mockUser = { findFirst: vi.fn(), findMany: vi.fn() };
const mockOpp = { findMany: vi.fn(), count: vi.fn(), update: vi.fn() };

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: { user: mockUser, opportunity: mockOpp },
}));

vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe.skip('AC-24 — Sprint 15D users continuam funcionando pós-15E', () => {
  it('user backfilled (ex-GESTOR_INBOUND → ADMIN + 4 grants) acessa inbound.queueList', async () => {
    // Simula user que teve role trocado + tem os 4 overrides granted
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.findMany.mockResolvedValueOnce([]);

    const { inboundRouter } = await import('@/server/trpc/routers/inbound');
    const caller = inboundRouter.createCaller(
      makeCtx({ role: 'ADMIN', userId: USER_IDS.admin }),
    );
    await expect(caller.queueList({})).resolves.toBeDefined();

    expect(hasPermissionSpy).toHaveBeenCalledWith(
      USER_IDS.admin,
      'inbound:view_queue',
    );
  });

  it('assignInbound permanece funcionando (mesma permission mapping)', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockOpp.update.mockResolvedValueOnce({
      id: 'opp-1',
      ownerId: USER_IDS.analista,
    });

    const { inboundRouter } = await import('@/server/trpc/routers/inbound');
    const caller = inboundRouter.createCaller(
      makeCtx({ role: 'ADMIN', userId: USER_IDS.admin }),
    );

    // Só valida middleware — não a lógica de negócio
    try {
      await caller.assignInbound({
        opportunityId: '11111111-1111-1111-1111-111111111111',
        ownerId: USER_IDS.analista,
      });
    } catch {
      // OK se cair depois do middleware (mock incompleto)
    }

    expect(hasPermissionSpy).toHaveBeenCalledWith(
      USER_IDS.admin,
      'inbound:assign_prospects',
    );
  });

  it('sellersWithLoad continua acessível', async () => {
    hasPermissionSpy.mockResolvedValue(true);
    mockUser.findMany.mockResolvedValueOnce([]);
    mockOpp.count.mockResolvedValue(0);

    const { inboundRouter } = await import('@/server/trpc/routers/inbound');
    const caller = inboundRouter.createCaller(
      makeCtx({ role: 'ADMIN', userId: USER_IDS.admin }),
    );

    await expect(caller.sellersWithLoad({})).resolves.toBeDefined();
  });

  it('enum UserRole NÃO tem mais GESTOR_INBOUND (rejeitado em Zod)', async () => {
    // users.invite deve rejeitar tentativa de setar GESTOR_INBOUND
    hasPermissionSpy.mockResolvedValue(true);

    const { usersRouter } = await import('@/server/trpc/routers/users');
    const caller = usersRouter.createCaller(
      makeCtx({ role: 'ADMIN', userId: USER_IDS.admin }),
    );

    await expect(
      caller.invite({
        email: 'novo@empresa.com',
        fullName: 'Novo User',
        // @ts-expect-error — GESTOR_INBOUND removido do enum
        role: 'GESTOR_INBOUND',
      }),
    ).rejects.toBeTruthy(); // qualquer erro serve — TRPCError ou Zod
  });

  it('user do backfill tem cachedPermissions com os 4 inbound', async () => {
    // Simula query pós-backfill: user ex-GESTOR_INBOUND agora tem cache populado
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({ id: 'ex-gi-1', role: 'ADMIN' }),
      cachedPermissions: [
        'inbound:view_queue',
        'inbound:assign_prospects',
        'inbound:configure',
        'inbound:view_reports',
        // ... + 55 defaults do ADMIN
      ],
      permissionOverrides: [
        makeOverride({
          userId: 'ex-gi-1',
          permission: 'inbound:view_queue',
          action: 'granted',
          reason: 'Backfill Sprint 15E — migrated from GESTOR_INBOUND role',
        }),
        makeOverride({
          userId: 'ex-gi-1',
          permission: 'inbound:assign_prospects',
          action: 'granted',
          reason: 'Backfill Sprint 15E — migrated from GESTOR_INBOUND role',
        }),
      ],
    });

    hasPermissionSpy.mockResolvedValue(true);
    const { permissionsRouter } = await import(
      '@/server/trpc/routers/permissions'
    );
    const caller = permissionsRouter.createCaller(
      makeCtx({ role: 'ADMIN', userId: USER_IDS.admin }),
    );
    const result = await caller.forUser({ userId: 'ex-gi-1' });

    expect(result.effective).toContain('inbound:view_queue');
    expect(result.effective).toContain('inbound:assign_prospects');
    // Override marca a rastreabilidade
    const inboundOverrides = result.overrides.filter((o: { permission: string }) =>
      o.permission.startsWith('inbound:'),
    );
    expect(inboundOverrides.length).toBeGreaterThan(0);
  });

  it('inbound-lead-creator worker continua criando opps sem quebrar', async () => {
    // Worker roda como system — não passa por RBAC. Mas checa que não regride.
    hasPermissionSpy.mockResolvedValue(true);

    // Só valida imports sem erro (compile-time via ts-nocheck)
    const workerModule = await import(
      '@/server/services/inbound-lead-creator.service'
    );
    expect(workerModule.createInboundLead).toBeDefined();
  });
});
