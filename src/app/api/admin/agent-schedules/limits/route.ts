import { type NextRequest } from 'next/server';
import { readScheduleLimits, saveScheduleLimits } from '@/lib/agent/schedules/api.server';

/** How many schedules each membership tier may keep; administrator-only. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readScheduleLimits(request); }
export function PUT(request: NextRequest) { return saveScheduleLimits(request); }
