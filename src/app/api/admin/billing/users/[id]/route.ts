import { type NextRequest } from 'next/server';
import { adminChangeUser, adminReadUser } from '@/lib/billing/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: RouteContext) { return adminReadUser(request, (await context.params).id); }
export async function POST(request: NextRequest, context: RouteContext) { return adminChangeUser(request, (await context.params).id); }
