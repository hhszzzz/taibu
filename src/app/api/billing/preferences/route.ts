import { type NextRequest } from 'next/server';
import { updateBillingDeductOrder } from '@/lib/billing/api.server';

/** The member's own billing preference: which purse a charge spends first. */
export const runtime = 'nodejs';
export function PATCH(request: NextRequest) { return updateBillingDeductOrder(request); }
