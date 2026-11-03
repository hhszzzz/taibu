import type { NextConfig } from "next";
import packageJson from "./package.json";

// The document routes parse PDF and Office files in worker threads running a bundle that
// `pnpm build:agent` writes before `next build` (scripts/build-document-worker.mjs). pdf.js
// reads the predefined CJK CMaps and standard fonts from disk while extracting PDF text; their
// license travels with them, and pdfjs-dist stays pinned to the pdf.js version unpdf bundles.
const documentWorkerFiles = [
  './.agent/document-text-worker.mjs',
  './node_modules/pdfjs-dist/LICENSE',
  './node_modules/pdfjs-dist/cmaps/**/*',
  './node_modules/pdfjs-dist/standard_fonts/**/*',
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Host dev is reached through 127.0.0.1/localhost on the fixed 3090 port.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Forces a new client build id per deploy so stale chunks 404 instead of
  // mixing builds behind a rolling restart.
  deploymentId: process.env.GIT_SHA,
  // The release version shown in settings; `pnpm release prepare` keeps package.json current.
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
  // Sharp loads platform binaries and libvips at runtime; pnpm keeps these
  // optional packages outside the sharp package's directory.
  outputFileTracingIncludes: {
    '/api/agent/attachments': [
      './node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*',
      ...documentWorkerFiles,
    ],
    '/api/chat/extract': documentWorkerFiles,
  },
  images: {
    // Local avatars are same-origin (`/api/files/avatars/...`); only external
    // avatar providers need remote patterns.
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
