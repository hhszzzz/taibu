import { type NextRequest } from 'next/server';
import { readBillingOrders } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readBillingOrders(request); }
