import { type NextRequest } from 'next/server';
import { readBillingOverview } from '@/lib/billing/api.server';

/** The member's balance, subscriptions, the plans on offer and how they can pay. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readBillingOverview(request); }
