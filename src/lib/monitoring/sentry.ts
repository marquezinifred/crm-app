/**
 * Wrappers para o SDK Sentry.
 *
 * P-35 — Todos os helpers são no-op quando `SENTRY_DSN`
 * (server) ou `NEXT_PUBLIC_SENTRY_DSN` (client) não estão configurados,
 * o que permite rodar `npm run dev` sem crashar em ambiente local.
 *
 * Uso:
 *   import { captureException, addBreadcrumb } from '@/lib/monitoring/sentry';
 *
 *   try { ... }
 *   catch (err) { captureException(err, { tags: { tenantId } }); throw err; }
 *
 * Não importar `@sentry/nextjs` direto em código de aplicação — passe
 * sempre por este módulo pra manter o no-op honesto.
 */

import * as Sentry from '@sentry/nextjs';

export type SeverityLevel =
  | 'fatal'
  | 'error'
  | 'warning'
  | 'log'
  | 'info'
  | 'debug';

export interface CaptureContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string; tenantId?: string };
  level?: SeverityLevel;
  fingerprint?: string[];
}

function isEnabled(): boolean {
  // Sentry.getClient() só retorna instância quando initSentry() rodou.
  // Em dev sem DSN, initSentry() faz early-return e getClient() é
  // undefined — helpers viram no-op.
  try {
    return typeof Sentry.getClient === 'function' && !!Sentry.getClient();
  } catch {
    return false;
  }
}

function applyContext(scope: Sentry.Scope, ctx: CaptureContext | undefined) {
  if (!ctx) return;
  if (ctx.level) scope.setLevel(ctx.level);
  if (ctx.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) {
      if (v === null || v === undefined) continue;
      scope.setTag(k, String(v));
    }
  }
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      scope.setExtra(k, v);
    }
  }
  if (ctx.user) {
    scope.setUser({
      id: ctx.user.id,
      email: ctx.user.email,
      ...(ctx.user.tenantId ? { tenantId: ctx.user.tenantId } : {}),
    });
  }
  if (ctx.fingerprint) scope.setFingerprint(ctx.fingerprint);
}

export function captureException(err: unknown, ctx?: CaptureContext): void {
  if (!isEnabled()) return;
  Sentry.withScope((scope) => {
    applyContext(scope, ctx);
    Sentry.captureException(err);
  });
}

export function captureMessage(
  message: string,
  ctx?: CaptureContext,
): void {
  if (!isEnabled()) return;
  Sentry.withScope((scope) => {
    applyContext(scope, ctx);
    Sentry.captureMessage(message);
  });
}

export interface BreadcrumbInput {
  category: string;
  message?: string;
  level?: SeverityLevel;
  data?: Record<string, unknown>;
}

export function addBreadcrumb(input: BreadcrumbInput): void {
  if (!isEnabled()) return;
  Sentry.addBreadcrumb({
    category: input.category,
    message: input.message,
    level: input.level,
    data: input.data,
  });
}

/**
 * Executa um callback com scope isolado. Útil pra anexar tenant/user
 * ao redor de um bloco (workers BullMQ, jobs cron).
 */
export function withScope<T>(
  ctx: CaptureContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (!isEnabled()) return fn();
  return Sentry.withScope((scope) => {
    applyContext(scope, ctx);
    return fn();
  });
}

/**
 * Wrap para tRPC error formatter — captura só INTERNAL_SERVER_ERROR
 * (5xx) e não FORBIDDEN/UNAUTHORIZED/PRECONDITION_FAILED, que são
 * respostas esperadas do produto.
 */
export function shouldReportTrpcError(code: string | undefined): boolean {
  if (!code) return true;
  return code === 'INTERNAL_SERVER_ERROR';
}
