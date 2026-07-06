import { initTRPC, TRPCError } from '@trpc/server';
import type { DefaultErrorShape } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import type { Context } from './context';
import { ForbiddenError } from '@/lib/auth/rbac';
import { logTrpc } from '@/lib/monitoring/axiom';
import { captureException, shouldReportTrpcError } from '@/lib/monitoring/sentry';
import { env } from '@/lib/env';
import {
  isTenantIsolationMessage,
  parseTenantIsolationMessage,
  TENANT_ISOLATION_PUBLIC_MESSAGE,
  type TenantIsolationInfo,
} from '@/lib/trpc/tenant-isolation-error';

// P-61 — Handlers exportados pra permitir cobertura direta por
// `tests/unit/trpc-middlewares.test.ts` sem instanciar servidor tRPC.
// Os wrappers `t.middleware(...)` abaixo delegam pra estas funções.

/**
 * P-46 — Formatter de erro do tRPC.
 *
 * Detecta Error crua do backstop de tenant-isolation via
 * `parseTenantIsolationMessage`. `mapErrors` já wrappa com cause
 * preservado; checamos também `error.message` como fallback caso
 * algum ponto tenha bypassado o middleware.
 */
export function formatTrpcError(input: {
  shape: DefaultErrorShape;
  error: { message: string; cause?: unknown };
}) {
  const { shape, error } = input;
  let tenantIsolation: TenantIsolationInfo | null = null;
  if (error.cause instanceof Error) {
    tenantIsolation = parseTenantIsolationMessage(error.cause.message);
  }
  if (!tenantIsolation) {
    tenantIsolation = parseTenantIsolationMessage(error.message);
  }

  return {
    ...shape,
    message: tenantIsolation ? TENANT_ISOLATION_PUBLIC_MESSAGE : shape.message,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError ? error.cause.flatten() : null,
      tenantIsolation,
    },
  };
}

/**
 * Handler puro do middleware `enforceAuth`. Lança `UNAUTHORIZED`
 * quando o contexto não tem user + tenantId.
 */
export function assertAuthContext(ctx: {
  user: Context['user'];
  tenantId: Context['tenantId'];
}): void {
  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
}

/**
 * Handler puro do middleware `enforcePlatform`. Lança `FORBIDDEN`
 * quando o contexto não é de um PLATFORM_OWNER autenticado.
 */
export function assertPlatformContext(ctx: {
  platformUser: Context['platformUser'];
  platformRole: Context['platformRole'];
}): void {
  if (!ctx.platformUser || ctx.platformRole !== 'PLATFORM_OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a Platform Owners.' });
  }
}

/**
 * Handler puro do middleware `mapErrors`. Executa `runNext` e
 * converte:
 *  • `ForbiddenError` (RBAC) → `TRPCError FORBIDDEN`
 *  • `Error("[tenant-isolation] ...")` (P-46) → `TRPCError
 *    INTERNAL_SERVER_ERROR` com cause preservado
 *  • Outros erros são re-throwed intactos.
 */
export async function runMapErrors<R>(runNext: () => Promise<R>): Promise<R> {
  try {
    return await runNext();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    // P-46 — Backstop de tenant-isolation (src/server/db/client.ts) dispara
    // Error crua com prefixo `[tenant-isolation]`. Sem esse wrap, a UI mostra
    // "Unable to transform response from server" (o mapper de fetchRequestHandler
    // não sabe serializar Error puro). Convertemos em TRPCError legível com
    // `cause` preservado — Sentry e monitor middleware continuam recebendo o
    // erro original. errorFormatter injeta `data.tenantIsolation`.
    if (err instanceof Error && isTenantIsolationMessage(err.message)) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: TENANT_ISOLATION_PUBLIC_MESSAGE,
        cause: err,
      });
    }
    throw err;
  }
}

export interface MonitorHookInput {
  ctx: Pick<Context, 'tenantId' | 'user'>;
  path: string;
  type: 'query' | 'mutation' | 'subscription';
}

/**
 * P-35 — Handler puro do middleware `monitor`. Emite:
 *   • Axiom `trpc` (success) ou `trpc_error` (failure) com
 *     `{procedure, kind, tenantId, userId, durationMs, ok, errorCode?}`
 *   • Sentry `captureException` apenas quando o erro é
 *     INTERNAL_SERVER_ERROR (evita ruído com FORBIDDEN/UNAUTHORIZED/
 *     PRECONDITION_FAILED que são respostas esperadas).
 *
 * Queries só são logadas quando falham (a menos que
 * `AXIOM_LOG_QUERIES=true`) — evita inflar dataset com listagens.
 */
export async function runMonitor<R>(
  input: MonitorHookInput,
  runNext: () => Promise<R>,
): Promise<R> {
  const { ctx, path, type } = input;
  const start = Date.now();
  try {
    const result = await runNext();
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
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: formatTrpcError,
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  assertAuthContext(ctx);
  return next({
    ctx: {
      ...ctx,
      user: ctx.user!,
      tenantId: ctx.tenantId!,
    },
  });
});

const mapErrors = t.middleware(({ next }) => runMapErrors(() => next()));

const monitor = t.middleware(({ ctx, path, type, next }) =>
  runMonitor({ ctx, path, type }, () => next()),
);

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
  assertPlatformContext(ctx);
  return next({
    ctx: {
      ...ctx,
      platformUser: ctx.platformUser!,
      platformRole: ctx.platformRole!,
    },
  });
});

export const platformProcedure = t.procedure.use(monitor).use(mapErrors).use(enforcePlatform);
