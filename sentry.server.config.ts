/**
 * Sentry server-side init (Node runtime).
 *
 * P-35 — Roda apenas se `SENTRY_DSN` estiver definido. Sem DSN, o
 * init é pulado e nossos wrappers viram no-op.
 *
 * Prisma tem integração nativa via auto-instrumentation em Node.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    // Nossa política é setar user/tenant explicitamente via
    // withScope() nos hooks (audit, workers, tRPC).
    sendDefaultPii: false,
    // Não spamar Sentry com erros conhecidos-benignos.
    ignoreErrors: [
      // Fetch cancelados no encerramento de request
      'AbortError',
      // Sessão Clerk expirada — não é bug, é UX
      'UNAUTHORIZED',
    ],
  });
}
