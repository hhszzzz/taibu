import { type NextRequest } from 'next/server';
import { agentEndpoint, getAgentArchiveEntry, saveAgentArchiveEntry } from '@/lib/agent/api.server';
export const runtime='nodejs';
export function GET(request:NextRequest,context:{params:Promise<{id:string}>}){return agentEndpoint(async()=>getAgentArchiveEntry(request,(await context.params).id));}
export function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return agentEndpoint(async()=>saveAgentArchiveEntry(request,(await context.params).id));}
