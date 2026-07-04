import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';
import { ForbiddenError } from '@/lib/auth/rbac';
import { logTrpc } from '@/lib/monitoring/axiom';
import { captureException, shouldReportTrpcError } from '@/lib/monitoring/sentry';
import { env } from '@/lib/env';

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

/**
 * P-35 — Instrumentação observability por procedure. Emite:
 *   • Axiom `trpc` (success) ou `trpc_error` (failure) com
 *     `{procedure, kind, tenantId, userId, durationMs, ok, errorCode?}`
 *   • Sentry `captureException` apenas quando o erro é
 *     INTERNAL_SERVER_ERROR (evita ruído com FORBIDDEN/UNAUTHORIZED/
 *     PRECONDITION_FAILED que são respostas esperadas).
 *
 * Queries só são logadas quando falham (a menos que
 * `AXIOM_LOG_QUERIES=true`) — evita inflar dataset com listagens.
 */
const monitor = t.middleware(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  try {
    const result = await next();
    const durationMs = Date.now() - start;
    if (type !== 'query' || env.AXIOM_LOG_QUERIES) {
      logTrpc({
        procedure: path,
        kind: type,
        tenantId: ctx.tenantId ?? null,
        userId: ctx.user?.id ?? null,
        durationMs,
        ok: true,
      });
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const code = err instanceof TRPCError ? err.code : 'INTERNAL_SERVER_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    logTrpc({
      procedure: path,
      kind: type,
      tenantId: ctx.tenantId ?? null,
      userId: ctx.user?.id ?? null,
      durationMs,
      ok: false,
      errorCode: code,
      errorMessage: message,
    });
    if (shouldReportTrpcError(code)) {
      captureException(err, {
        tags: {
          procedure: path,
          kind: type,
          tenantId: ctx.tenantId ?? undefined,
          userId: ctx.user?.id ?? undefined,
          errorCode: code,
        },
      });
    }
    throw err;
  }
});

export const protectedProcedure = t.procedure.use(monitor).use(mapErrors).use(enforceAuth);

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

export const platformProcedure = t.procedure.use(monitor).use(mapErrors).use(enforcePlatform);
