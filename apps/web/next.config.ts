import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// One .env at the repo root serves every app. Values already in the environment win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No root .env (CI, containers): rely on the real environment.
}

const nextConfig: NextConfig = {
  // The self-host image sets NEXT_STANDALONE=1 and runs the standalone server. Off by default:
  // standalone output creates symlinks, which fail on Windows without Developer Mode.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // Trace files from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  typedRoutes: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    '@queuesprout/auth',
    '@queuesprout/core',
    '@queuesprout/db',
    '@queuesprout/providers',
    '@queuesprout/shared',
    '@queuesprout/storage',
    '@queuesprout/ui',
  ],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
