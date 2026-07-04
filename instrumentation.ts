/**
 * Next.js 14 instrumentation hook.
 *
 * P-35 — Registra o SDK Sentry no runtime correto (Node ou Edge).
 * A convenção Next.js chama `register()` no boot do processo server.
 *
 * Sem DSN, os arquivos `sentry.*.config.ts` fazem early-return e o
 * SDK fica desativado — nada quebra em dev sem SENTRY_DSN.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
