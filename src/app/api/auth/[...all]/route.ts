import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/identity/auth.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolve the auth instance lazily so `next build` does not need runtime secrets.
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
