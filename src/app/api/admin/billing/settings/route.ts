import { type NextRequest } from 'next/server';
import { adminReadSettings, adminSaveSettings } from '@/lib/billing/api.server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return adminReadSettings(request); }
export function PUT(request: NextRequest) { return adminSaveSettings(request); }
