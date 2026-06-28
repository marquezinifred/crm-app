import withSerwistInit from '@serwist/next';

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

export default withSerwist(nextConfig);
