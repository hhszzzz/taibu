import { type NextRequest } from 'next/server';
import { createSchedule, readSchedules } from '@/lib/agent/schedules/api.server';

/** The signed-in member's scheduled Agent tasks and how many slots their tier allows. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readSchedules(request); }
export function POST(request: NextRequest) { return createSchedule(request); }
