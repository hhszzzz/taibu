import { type NextRequest } from 'next/server';
import { createUserConnector, listUserConnectors } from '@/lib/agent/mcp/api.server';

/** The signed-in user's own MCP connectors and how many the policy allows. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listUserConnectors(request); }
export function POST(request: NextRequest) { return createUserConnector(request); }
