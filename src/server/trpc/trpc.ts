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
import { USER_NOT_PROVISIONED_MARKER } from '@/lib/trpc/auth-markers';

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
 *
 * P-82 — quando o caller está autenticado no Clerk mas sem row local
 * (`authState === 'NOT_PROVISIONED'`), o `message` carrega o marcador
 * estável `USER_NOT_PROVISIONED`. O HTTP continua 401 (code UNAUTHORIZED,
 * não reportado ao Sentry — é esperado); o diferenciador vive no corpo,
 * que o `sessionAwareFetch` inspeciona para redirecionar em vez de
 * recarregar em loop. Sem PII no marcador.
 */
export function assertAuthContext(ctx: {
  user: Context['user'];
  tenantId: Context['tenantId'];
  authState?: Context['authState'];
}): void {
  if (ctx.user && ctx.tenantId) return;
  if (ctx.authState === 'NOT_PROVISIONED') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: USER_NOT_PROVISIONED_MARKER });
  }
  throw new TRPCError({ code: 'UNAUTHORIZED' });
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
 * P-105 — Reconhece um `ForbiddenError` mesmo quando ele não bate no
 * `instanceof` cru do `mapErrors`. Caminha `err` e a cadeia de `.cause`
 * (guarda de ciclo + limite de profundidade) e casa por:
 *
 *  1. **Identidade de classe** (`instanceof ForbiddenError`) — caminho feliz.
 *  2. **Marcador estrutural** (`err.name === 'ForbiddenError'`) — cobre o caso
 *     em que a instância vem de uma cópia DIFERENTE do módulo `@/lib/auth/rbac`.
 *     O guard de transferência (15G.5 chip 2c) lança de dentro do closure do
 *     client Prisma, que vive no singleton `globalThis.prisma` e sobrevive a
 *     HMR/rebuilds; a classe capturada nesse closure pode não ser a mesma
 *     importada aqui, então `instanceof` retorna `false` mesmo sendo o mesmo
 *     tipo lógico — e o erro caía no `throw err` genérico, virando 500 (P-105).
 *  3. **Embrulhado em `cause`** — defesa contra qualquer camada que reembrulhe
 *     o erro. Confirmado em runtime que o Prisma 5.22 NÃO embrulha hoje, mas o
 *     walk é barato e à prova de regressão.
 *
 * Retorna a instância encontrada (ou null). O caller usa só a `.message`
 * genérica (P-98) — o `cause` técnico do guard NUNCA vaza pro cliente (R5).
 */
export function findForbiddenError(err: unknown): Error | null {
  const seen = new Set<unknown>();
  let node: unknown = err;
  let depth = 0;
  while (node != null && depth < 10 && !seen.has(node)) {
    seen.add(node);
    if (node instanceof ForbiddenError) return node;
    if (node instanceof Error && node.name === 'ForbiddenError') return node;
    node = (node as { cause?: unknown }).cause;
    depth += 1;
  }
  return null;
}

/**
 * Handler puro do middleware `mapErrors`. Executa `runNext` e
 * converte:
 *  • `ForbiddenError` (RBAC / guard de transferência) → `TRPCError FORBIDDEN`,
 *    mesmo embrulhado ou de identidade de classe divergente (P-105).
 *  • `Error("[tenant-isolation] ...")` (P-46) → `TRPCError
 *    INTERNAL_SERVER_ERROR` com cause preservado
 *  • Outros erros são re-throwed intactos.
 */
export async function runMapErrors<R>(runNext: () => Promise<R>): Promise<R> {
  try {
    return await runNext();
  } catch (err) {
    const forbidden = findForbiddenError(err);
    if (forbidden) {
      throw new TRPCError({ code: 'FORBIDDEN', message: forbidden.message });
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
