/**
 * P-44 — Fixture pra integration tests que exercitam `appRouter.createCaller`.
 *
 * Cria users reais no DB + wrappa o caller em `runWithTenant` pra que Prisma
 * extension injete o tenantId da AsyncLocalStorage. Testes cobrem o path
 * completo Zod → RBAC (withPermission → hasPermission cache) → audit → Prisma.
 *
 * Uso típico:
 *   const { caller, run, userId } = await buildAuthedCaller({ tenantId, role: 'ADMIN' });
 *   const opp = await run(() => caller.opportunities.create({...}));
 *
 * Ao criar user, chamamos `computeAndCacheUserPermissions` explicitamente
 * — senão a primeira `withPermission` faria cache miss + populate, o que
 * funciona mas atrasa o setup. Cache populado torna os testes determinísticos.
 */

import type { UserRole } from '@prisma/client';
import type { Context } from '@/server/trpc/context';

export interface AuthedCallerHandle {
  userId: string;
  tenantId: string;
  role: UserRole;
  partnerCompanyId: string | null;
  ctx: Context;
  /**
   * Cria um caller novo do appRouter usando o ctx compartilhado. Cada
   * chamada tRPC deve ser feita dentro de `run(() => caller.foo.bar(...))`
   * pra que a AsyncLocalStorage do tenant esteja ativa.
   */
  caller: ReturnType<
    typeof import('@/server/trpc/routers/_app').appRouter.createCaller
  >;
  /**
   * Executa `fn` dentro de `runWithTenant({tenantId, userId, role})`.
   * Toda call tRPC do teste passa por aqui pra que Prisma extension
   * injete o tenantId automaticamente.
   */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CreateAuthedUserOptions {
  tenantId: string;
  role: UserRole;
  emailPrefix?: string;
  fullName?: string;
  partnerCompanyId?: string | null;
}

/**
 * Cria user no DB, popula cache de permissions e devolve handle pronto.
 * O caller retornado pode ser reutilizado entre múltiplas chamadas do teste,
 * desde que cada uma seja envolvida em `run()`.
 */
export async function buildAuthedCaller(
  opts: CreateAuthedUserOptions,
): Promise<AuthedCallerHandle> {
  const { prisma } = await import('@/server/db/client');
  const { runAsSystem, runWithTenant } = await import('@/server/db/tenant-context');
  const { appRouter } = await import('@/server/trpc/routers/_app');
  const { computeAndCacheUserPermissions } = await import(
    '@/server/services/permissions.service'
  );

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailPrefix = opts.emailPrefix ?? 'authed';
  const email = `${emailPrefix}+${suffix}@p44.test`;

  const user = await runAsSystem(() =>
    prisma.user.create({
      data: {
        tenantId: opts.tenantId,
        email,
        fullName: opts.fullName ?? `Test ${opts.role}`,
        role: opts.role,
        partnerCompanyId: opts.partnerCompanyId ?? null,
        active: true,
      } as never,
    }),
  );

  // Popula cachedPermissions antes de qualquer chamada tRPC pra evitar
  // cache-miss no primeiro `withPermission` (que popularia lazy).
  await computeAndCacheUserPermissions(user.id);

  const ctx: Context = {
    req: new Request('http://localhost/test/p44'),
    tenantId: opts.tenantId,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: opts.tenantId,
      partnerCompanyId: opts.partnerCompanyId ?? null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'p44-integration',
  };

  const caller = appRouter.createCaller(ctx);

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithTenant(
      { tenantId: opts.tenantId, userId: user.id, role: opts.role },
      fn,
    );

  return {
    userId: user.id,
    tenantId: opts.tenantId,
    role: opts.role,
    partnerCompanyId: opts.partnerCompanyId ?? null,
    ctx,
    caller,
    run,
  };
}

/**
 * Cleanup helper — apaga users criados pelo teste. FKs (opportunities,
 * activities, audit_logs) devem ser removidos ANTES pelo próprio teste,
 * senão CASCADE do schema resolve.
 */
export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const { prisma } = await import('@/server/db/client');
  const { runAsSystem } = await import('@/server/db/tenant-context');
  await runAsSystem(() =>
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  );
}
