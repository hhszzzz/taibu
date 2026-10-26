import { type NextRequest } from 'next/server';
import { deletePlatformSkill, readPlatformSkill, updatePlatformSkill } from '@/lib/agent/skills/api.server';

type RouteContext = { params: Promise<{ id: string }> };

/** One platform skill with its SKILL.md, for the editor. */
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: RouteContext) { return readPlatformSkill(request, (await context.params).id); }
export async function PATCH(request: NextRequest, context: RouteContext) { return updatePlatformSkill(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return deletePlatformSkill(request, (await context.params).id); }
