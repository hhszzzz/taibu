import { type NextRequest } from 'next/server';
import { deleteAdminProfile, updateAdminProfile } from '@/lib/agent/profiles/api.server';

type RouteContext = { params: Promise<{ name: string }> };

/** One role: a custom one is edited or deleted, a built-in one only switched on or off. */
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: RouteContext) { return updateAdminProfile(request, (await context.params).name); }
export async function DELETE(request: NextRequest, context: RouteContext) { return deleteAdminProfile(request, (await context.params).name); }
