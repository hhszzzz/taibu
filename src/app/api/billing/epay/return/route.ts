import { type NextRequest } from 'next/server';
import { handleEpayReturn } from '@/lib/billing/api.server';

/** Where the gateway sends the member's browser back after paying. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) { return handleEpayReturn(request); }
export function POST(request: NextRequest) { return handleEpayReturn(request); }
