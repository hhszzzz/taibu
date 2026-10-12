import { type NextRequest } from 'next/server';
import { agentEndpoint, getAgentActivity } from '@/lib/agent/api.server';
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return agentEndpoint(() => getAgentActivity(request)); }
