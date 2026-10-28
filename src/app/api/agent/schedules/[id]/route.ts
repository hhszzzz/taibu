import { type NextRequest } from 'next/server';
import { removeSchedule, updateSchedule } from '@/lib/agent/schedules/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: RouteContext) { return updateSchedule(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return removeSchedule(request, (await context.params).id); }
