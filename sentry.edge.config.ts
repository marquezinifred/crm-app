/**
 * Sentry edge init (middleware.ts + edge-runtime routes).
 *
 * P-35 — no-op sem DSN. Envs edge são um subset das server; usamos o
 * mesmo `SENTRY_DSN`.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
  });
}
