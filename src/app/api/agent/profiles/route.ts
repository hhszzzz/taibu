import { type NextRequest } from 'next/server';
import { listProfileOptions } from '@/lib/agent/profiles/api.server';

/** The roles the signed-in member may give a collaboration member. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listProfileOptions(request); }
