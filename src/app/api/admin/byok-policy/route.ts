import { type NextRequest } from 'next/server';
import { readPolicy, savePolicy } from '@/lib/byok/api.server';

/** Whether members may store keys here, and how many connections and models each may keep; administrator-only. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readPolicy(request); }
export function PUT(request: NextRequest) { return savePolicy(request); }
