import { type NextRequest } from 'next/server';
import { listSkillCommands } from '@/lib/agent/skills/api.server';

/** The skills the signed-in member can call with `/skill:` in an Agent conversation. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listSkillCommands(request); }
