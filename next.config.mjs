import withSerwistInit from '@serwist/next';
import { withSentryConfig } from '@sentry/nextjs';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Em dev, registra o SW também (false desativa caching agressivo no dev)
  disable: process.env.NODE_ENV !== 'production',
  scope: '/',
  reloadOnOnline: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bullmq'],
  },
  eslint: {
    dirs: ['src', 'tests', 'prisma'],
  },
};

// P-35 — Wrap Sentry por último para gerar sourcemaps + injetar tracing.
// Sem SENTRY_AUTH_TOKEN, o upload de sourcemap é pulado (o SDK ainda
// funciona em runtime, só perde symbolication). Sem SENTRY_DSN,
// os arquivos sentry.*.config.ts pulam init e nada acontece.
const sentryOptions = {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
  // Só tenta upload quando temos as 3 vars — evita warning no build local
  disableSourceMapUpload:
    !process.env.SENTRY_AUTH_TOKEN ||
    !process.env.SENTRY_ORG ||
    !process.env.SENTRY_PROJECT,
};

export default withSentryConfig(withSerwist(nextConfig), sentryOptions);
