import { type NextRequest } from 'next/server';
import { createPlatformSkill, listPlatformSkills } from '@/lib/agent/skills/api.server';

/** Platform skills: listed and added by administrators. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listPlatformSkills(request); }
export function POST(request: NextRequest) { return createPlatformSkill(request); }
