import { type NextRequest } from 'next/server';
import { createUserSkill, listUserSkills } from '@/lib/agent/skills/api.server';

/** The signed-in user's own skills and how many the policy allows. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listUserSkills(request); }
export function POST(request: NextRequest) { return createUserSkill(request); }
