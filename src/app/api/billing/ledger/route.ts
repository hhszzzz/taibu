import { type NextRequest } from 'next/server';
import { readBillingLedger } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readBillingLedger(request); }
