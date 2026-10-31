import { type NextRequest } from 'next/server';
import { startEpayCheckout } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function POST(request: NextRequest) { return startEpayCheckout(request); }
