import { type NextRequest } from 'next/server';
import { deleteUserSkill, readUserSkill, updateUserSkill } from '@/lib/agent/skills/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: RouteContext) { return readUserSkill(request, (await context.params).id); }
export async function PATCH(request: NextRequest, context: RouteContext) { return updateUserSkill(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return deleteUserSkill(request, (await context.params).id); }
