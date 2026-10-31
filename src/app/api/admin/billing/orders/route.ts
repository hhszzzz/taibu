import { type NextRequest } from 'next/server';
import { adminListOrders } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminListOrders(request); }
