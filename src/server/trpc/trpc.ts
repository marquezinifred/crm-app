import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';
import { ForbiddenError } from '@/lib/auth/rbac';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
    },
  });
});

const mapErrors = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
});

export const protectedProcedure = t.procedure.use(mapErrors).use(enforceAuth);

/**
 * Sprint 15A — procedure exclusiva Platform Owner.
 *
 * Não exige tenant ativo; em vez disso enforça que o caller é um
 * PLATFORM_OWNER (claim Clerk via middleware). Toda mutação de dados
 * cross-tenant disparada por essas procedures deve rodar dentro de
 * `runAsPlatform(ctx.platformUser.id, () => ...)`.
 */
const enforcePlatform = t.middleware(({ ctx, next }) => {
  if (!ctx.platformUser || ctx.platformRole !== 'PLATFORM_OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a Platform Owners.' });
  }
  return next({
    ctx: {
      ...ctx,
      platformUser: ctx.platformUser,
      platformRole: ctx.platformRole,
    },
  });
});

export const platformProcedure = t.procedure.use(mapErrors).use(enforcePlatform);
