import { type NextRequest } from 'next/server';
import { readScheduleRuns } from '@/lib/agent/schedules/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: RouteContext) { return readScheduleRuns(request, (await context.params).id); }
