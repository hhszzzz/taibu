import { type NextRequest } from 'next/server';
import { runScheduleNow } from '@/lib/agent/schedules/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: RouteContext) { return runScheduleNow(request, (await context.params).id); }
