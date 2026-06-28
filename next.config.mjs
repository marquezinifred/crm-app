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

export default nextConfig;
