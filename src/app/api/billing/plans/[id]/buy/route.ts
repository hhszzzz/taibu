import { type NextRequest } from 'next/server';
import { buyBillingPlan } from '@/lib/billing/api.server';

type RouteContext = { params: Promise<{ id: string }> };

/** Buys a plan with the wallet. */
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: RouteContext) { return buyBillingPlan(request, (await context.params).id); }
