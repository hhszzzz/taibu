import { type NextRequest } from 'next/server';
import { adminReadUsage } from '@/lib/billing/api.server';

/** The usage log across every member. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminReadUsage(request); }
