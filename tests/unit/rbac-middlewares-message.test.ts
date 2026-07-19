// @vitest-environment node
// Env precisa estar setado antes de qualquer import que puxe env.ts
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { UserRole } from '@prisma/client';

/**
 * P-98 — Mensagem FORBIDDEN única e genérica.
 *
 * Fred (2026-07-17) pediu que a UI não exponha role nem requisito técnico.
 * As 3 fábricas de middleware (`withRoles`/`withCapability`/`withPermission`)
 * devem lançar a MESMA mensagem visível — "Seu perfil não tem acesso a esta
 * operação." — com o detalhe técnico preservado apenas no `cause` do
 * TRPCError (server-side; o errorFormatter em `trpc.ts` NÃO serializa `cause`
 * pro cliente).
 *
 * Exercita as fábricas de ponta a ponta via `createCaller` (passa por
 * monitor → mapErrors → enforceAuth → guard). `hasCapability` (rbac) e
 * `hasPermission` (permissions.service) são mockados pra evitar DB e
 * controlar allow/deny.
 */

const hasCapabilityMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@/lib/auth/rbac', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/rbac')>('@/lib/auth/rbac');
  return {
    ...actual,
    hasCapability: (...args: unknown[]) => hasCapabilityMock(...args),
  };
});

vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

// Silencia o sink Axiom (o monitor middleware loga toda procedure).
vi.mock('@/lib/monitoring/axiom', () => ({ logTrpc: vi.fn() }));

import { router, formatTrpcError } from '@/server/trpc/trpc';
import {
  withRoles,
  withCapability,
  withPermission,
  FORBIDDEN_MESSAGE,
} from '@/server/trpc/middlewares';
import type { Context } from '@/server/trpc/context';

const appRouter = router({
  roleGuarded: withRoles('ADMIN').query(() => 'ok'),
  capGuarded: withCapability('company', 'create').query(() => 'ok'),
  permGuarded: withPermission('user:update').query(() => 'ok'),
});

function ctxFor(role: UserRole): Context {
  return {
    req: new Request('http://localhost/trpc'),
    tenantId: 't1',
    user: {
      id: 'u1',
      email: 'a@a.com',
      fullName: 'A',
      role,
      tenantId: 't1',
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: null,
    userAgent: null,
  } as unknown as Context;
}

async function catchErr(p: Promise<unknown>): Promise<TRPCError> {
  try {
    await p;
    throw new Error('esperava rejeição, mas resolveu');
  } catch (e) {
    return e as TRPCError;
  }
}

function causeMessage(err: TRPCError): string {
  return err.cause instanceof Error ? err.cause.message : String(err.cause);
}

beforeEach(() => {
  hasCapabilityMock.mockReturnValue(false);
  hasPermissionMock.mockResolvedValue(false);
});

describe('P-98 — mensagem FORBIDDEN genérica', () => {
  it('withRoles nega com a mensagem genérica única', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).roleGuarded());
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Seu perfil não tem acesso a esta operação.');
    expect(err.message).toBe(FORBIDDEN_MESSAGE);
    // Não vaza role nem allowed roles no texto visível.
    expect(err.message).not.toContain('ANALISTA');
    expect(err.message).not.toContain('ADMIN');
  });

  it('withCapability nega com a MESMA mensagem genérica', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).capGuarded());
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe(FORBIDDEN_MESSAGE);
    expect(err.message).not.toContain('company');
  });

  it('withPermission nega com a MESMA mensagem genérica', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).permGuarded());
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe(FORBIDDEN_MESSAGE);
    expect(err.message).not.toContain('user:update');
  });

  it('as 3 fábricas produzem mensagens idênticas', async () => {
    const [a, b, c] = await Promise.all([
      catchErr(appRouter.createCaller(ctxFor('ANALISTA')).roleGuarded()),
      catchErr(appRouter.createCaller(ctxFor('ANALISTA')).capGuarded()),
      catchErr(appRouter.createCaller(ctxFor('ANALISTA')).permGuarded()),
    ]);
    expect(a.message).toBe(b.message);
    expect(b.message).toBe(c.message);
  });

  it('withRoles preserva o detalhe técnico no cause (rastreabilidade server-side)', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).roleGuarded());
    const cause = causeMessage(err);
    expect(cause).toContain('withRoles');
    expect(cause).toContain('ANALISTA');
    expect(cause).toContain('ADMIN');
  });

  it('withCapability preserva resource:action no cause', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).capGuarded());
    const cause = causeMessage(err);
    expect(cause).toContain('withCapability');
    expect(cause).toContain('company:create');
    expect(cause).toContain('ANALISTA');
  });

  it('withPermission preserva a permission no cause', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).permGuarded());
    const cause = causeMessage(err);
    expect(cause).toContain('withPermission');
    expect(cause).toContain('user:update');
    expect(cause).toContain('ANALISTA');
  });

  it('cause NÃO vaza pro cliente: errorFormatter sanitiza o shape', async () => {
    const err = await catchErr(appRouter.createCaller(ctxFor('ANALISTA')).roleGuarded());
    // tRPC monta o shape default a partir de error.message (= genérico).
    const shape = formatTrpcError({
      shape: {
        message: err.message,
        code: -32603,
        data: { code: 'FORBIDDEN', httpStatus: 403 },
      },
      error: { message: err.message, cause: err.cause },
    });
    expect(shape.message).toBe(FORBIDDEN_MESSAGE);
    const serialized = JSON.stringify(shape);
    expect(serialized).not.toContain('withRoles');
    expect(serialized).not.toContain('ANALISTA');
    expect(serialized).not.toContain('requer');
  });

  it('happy path: withRoles(ADMIN) permite ADMIN', async () => {
    await expect(
      appRouter.createCaller(ctxFor('ADMIN')).roleGuarded(),
    ).resolves.toBe('ok');
  });

  it('happy path: withCapability permite quando hasCapability=true', async () => {
    hasCapabilityMock.mockReturnValue(true);
    await expect(
      appRouter.createCaller(ctxFor('ADMIN')).capGuarded(),
    ).resolves.toBe('ok');
  });

  it('happy path: withPermission permite quando hasPermission=true', async () => {
    hasPermissionMock.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(ctxFor('ADMIN')).permGuarded(),
    ).resolves.toBe('ok');
  });
});
