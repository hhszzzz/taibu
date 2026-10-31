import { type NextRequest } from 'next/server';
import { adminCreateCodes, adminListCodes } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminListCodes(request); }
export function POST(request: NextRequest) { return adminCreateCodes(request); }
