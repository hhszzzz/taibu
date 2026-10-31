import { type NextRequest } from 'next/server';
import { adminDeletePlan, adminUpdatePlan } from '@/lib/billing/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function PUT(request: NextRequest, context: RouteContext) { return adminUpdatePlan(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return adminDeletePlan(request, (await context.params).id); }
