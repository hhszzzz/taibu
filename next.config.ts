import type { NextConfig } from "next";
import { isSelfHosted, parseConfiguredOrigin } from './src/lib/runtime-env';

// Next serializes image configuration at build time: rebuild when this origin changes.
// Do not enable dangerouslyAllowLocalIP; local avatars use the controlled storage URL.
const publicStorageOrigin = isSelfHosted()
  ? parseConfiguredOrigin(process.env.SUPABASE_PUBLIC_URL, 'SUPABASE_PUBLIC_URL')
  : new URL('https://gdaaipkdmwxkvgesknsp.supabase.co');

// pdf.js reads the predefined CJK CMaps and standard fonts from disk while extracting PDF text.
// Their licenses travel with them; pdfjs-dist stays pinned to the pdf.js version unpdf bundles.
const pdfjsDataFiles = [
  './node_modules/pdfjs-dist/LICENSE',
  './node_modules/pdfjs-dist/cmaps/**/*',
  './node_modules/pdfjs-dist/standard_fonts/**/*',
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // unpdf ships a prebuilt pdf.js that resolves its own parts at runtime; Node loads it as published.
  serverExternalPackages: ['unpdf'],
  // Sharp loads platform binaries and libvips at runtime; pnpm keeps these
  // optional packages outside the sharp package's directory.
  outputFileTracingIncludes: {
    '/api/agent/attachments': [
      './node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*',
      ...pdfjsDataFiles,
    ],
    '/api/chat/extract': pdfjsDataFiles,
  },
  images: {
    remotePatterns: [
      {
        protocol: publicStorageOrigin.protocol.slice(0, -1) as 'http' | 'https',
        hostname: publicStorageOrigin.hostname,
        port: publicStorageOrigin.port,
        pathname: '/storage/v1/object/public/**',
      },
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
