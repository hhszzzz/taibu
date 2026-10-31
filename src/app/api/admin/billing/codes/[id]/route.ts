import { type NextRequest } from 'next/server';
import { adminDisableCode } from '@/lib/billing/api.server';

type RouteContext = { params: Promise<{ id: string }> };

/** Disables an unused code. */
export const runtime = 'nodejs';
export async function DELETE(request: NextRequest, context: RouteContext) { return adminDisableCode(request, (await context.params).id); }
