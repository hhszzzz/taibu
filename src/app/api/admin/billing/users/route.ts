import { type NextRequest } from 'next/server';
import { adminSearchUsers } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminSearchUsers(request); }
