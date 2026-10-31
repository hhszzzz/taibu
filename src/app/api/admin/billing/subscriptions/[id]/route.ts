import { type NextRequest } from 'next/server';
import { adminCancelSubscription } from '@/lib/billing/api.server';

type RouteContext = { params: Promise<{ id: string }> };

/** Cancels an active subscription. */
export const runtime = 'nodejs';
export async function DELETE(request: NextRequest, context: RouteContext) { return adminCancelSubscription(request, (await context.params).id); }
