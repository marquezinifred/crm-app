/**
 * Sentry client-side init (browser).
 *
 * P-35 — Roda apenas se `NEXT_PUBLIC_SENTRY_DSN` estiver definido.
 * Sem DSN, `Sentry.init` não é chamado e `Sentry.getClient()` retorna
 * undefined — nossos helpers em `src/lib/monitoring/sentry.ts` viram
 * no-op automaticamente.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // 10% de tracing pra não estourar cota — subir depois de ver
    // volume real. Em dev sample=0 pra não poluir dashboard.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    // Não amostra sessão inteira, só quando há erro.
    replaysOnErrorSampleRate: 0.5,
    replaysSessionSampleRate: 0,
    // Não capturar console.log — muito ruído.
    integrations: [],
    // Não enviar PII por default. Nossos helpers explicitamente setam
    // user quando fizer sentido.
    sendDefaultPii: false,
  });
}
