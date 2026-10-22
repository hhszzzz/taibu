import type { NextConfig } from "next";

// Local avatars are same-origin (`/api/files/avatars/...`), so only external
// avatar providers need remote patterns.
const nextConfig: NextConfig = {
  output: 'standalone',
  // Forces a new client build id per deploy so stale chunks 404 instead of
  // mixing builds behind a rolling restart.
  deploymentId: process.env.GIT_SHA,
  // Sharp loads platform binaries and libvips at runtime; pnpm keeps these
  // optional packages outside the sharp package's directory.
  outputFileTracingIncludes: {
    '/api/agent/attachments': [
      './node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*',
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'connect.linux.do',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'linux.do',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Public share links carry their capability token in the path: never leak it, never index it.
        source: '/share/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
