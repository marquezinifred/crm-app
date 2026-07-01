/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-23 — Kill-switch RBAC_GRANULAR_ENABLED=false restaura path legado
//          (withRoles/withCapability) sem redeploy.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { USER_IDS, makeCtx } from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();
const legacyGuardSpy = vi.fn();

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
    // Path legado
    hasCapability: (...args: unknown[]) => legacyGuardSpy(...args),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: new Proxy({}, {
    get: () => new Proxy({}, { get: () => vi.fn().mockResolvedValue(null) }),
  }),
}));

vi.mock('@/server/services/audit.service', () => ({ audit: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env.RBAC_GRANULAR_ENABLED;
});

describe.skip('AC-23 — kill-switch RBAC_GRANULAR_ENABLED', () => {
  it('flag=true (default): withPermission usa hasPermission async', async () => {
    process.env.RBAC_GRANULAR_ENABLED = 'true';
    hasPermissionSpy.mockResolvedValue(true);

    const { withPermission } = await import('@/server/trpc/middlewares');
    const middleware = withPermission('opportunity:read');
    // Middleware é factory que retorna async fn
    // Executa o middleware manualmente
    const ctx = makeCtx({ role: 'ANALISTA' });
    await middleware({
      ctx: { user: ctx.user, tenantId: ctx.tenantId },
      next: async () => ({ ok: true }),
    } as never);

    expect(hasPermissionSpy).toHaveBeenCalledWith(
      ctx.user.id,
      'opportunity:read',
    );
    expect(legacyGuardSpy).not.toHaveBeenCalled();
  });

  it('flag=false: withPermission cai no path legado hasCapability', async () => {
    process.env.RBAC_GRANULAR_ENABLED = 'false';
    legacyGuardSpy.mockReturnValue(true);

    const { withPermission } = await import('@/server/trpc/middlewares');
    const middleware = withPermission('opportunity:read');
    const ctx = makeCtx({ role: 'ANALISTA' });
    await middleware({
      ctx: { user: ctx.user, tenantId: ctx.tenantId },
      next: async () => ({ ok: true }),
    } as never);

    // Path legado — traduz permission em resource:action pra hasCapability
    expect(legacyGuardSpy).toHaveBeenCalled();
    expect(hasPermissionSpy).not.toHaveBeenCalled();
  });

  it('flag=false: middleware ainda respeita 403 (path legado retorna false)', async () => {
    process.env.RBAC_GRANULAR_ENABLED = 'false';
    legacyGuardSpy.mockReturnValue(false);

    const { withPermission } = await import('@/server/trpc/middlewares');
    const middleware = withPermission('user:delete');
    const ctx = makeCtx({ role: 'PARCEIRO' });

    await expect(
      middleware({
        ctx: { user: ctx.user, tenantId: ctx.tenantId },
        next: async () => ({ ok: true }),
      } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rollback: setar flag mid-request funciona sem redeploy', async () => {
    // Round 1: flag ON
    process.env.RBAC_GRANULAR_ENABLED = 'true';
    hasPermissionSpy.mockResolvedValue(true);

    const { withPermission } = await import('@/server/trpc/middlewares');
    const middleware = withPermission('opportunity:read');
    const ctx = makeCtx({ role: 'ADMIN' });

    await middleware({
      ctx: { user: ctx.user, tenantId: ctx.tenantId },
      next: async () => ({ ok: true }),
    } as never);
    expect(hasPermissionSpy).toHaveBeenCalledTimes(1);

    // Round 2: flag flip pra OFF
    process.env.RBAC_GRANULAR_ENABLED = 'false';
    legacyGuardSpy.mockReturnValue(true);
    hasPermissionSpy.mockClear();

    await middleware({
      ctx: { user: ctx.user, tenantId: ctx.tenantId },
      next: async () => ({ ok: true }),
    } as never);
    expect(hasPermissionSpy).not.toHaveBeenCalled();
    expect(legacyGuardSpy).toHaveBeenCalled();
  });

  it('sem env var (undefined) trata como default=true (Sprint 15E ativo)', async () => {
    delete process.env.RBAC_GRANULAR_ENABLED;
    hasPermissionSpy.mockResolvedValue(true);

    const { withPermission } = await import('@/server/trpc/middlewares');
    const middleware = withPermission('opportunity:read');
    const ctx = makeCtx({ role: 'ANALISTA' });

    await middleware({
      ctx: { user: ctx.user, tenantId: ctx.tenantId },
      next: async () => ({ ok: true }),
    } as never);

    expect(hasPermissionSpy).toHaveBeenCalled();
  });
});
