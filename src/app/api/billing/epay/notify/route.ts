import { type NextRequest } from 'next/server';
import { handleEpayNotify } from '@/lib/billing/api.server';

/** The gateway's asynchronous payment notification; public, authenticated by its signature. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) { return handleEpayNotify(request); }
export function POST(request: NextRequest) { return handleEpayNotify(request); }
