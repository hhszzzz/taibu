import { type NextRequest } from 'next/server';
import { redeemBillingCode } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function POST(request: NextRequest) { return redeemBillingCode(request); }
