import { type NextRequest } from 'next/server';
import { createAdminProfile, listAdminProfiles } from '@/lib/agent/profiles/api.server';

/** Agent roles: listed by administrators, who add their own beside the built-in ones. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listAdminProfiles(request); }
export function POST(request: NextRequest) { return createAdminProfile(request); }
