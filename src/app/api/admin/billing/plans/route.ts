import { type NextRequest } from 'next/server';
import { adminCreatePlan, adminListPlans } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminListPlans(request); }
export function POST(request: NextRequest) { return adminCreatePlan(request); }
