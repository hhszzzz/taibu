import { type NextRequest } from 'next/server';
import { createPlatformMcpServer, listPlatformMcpServers } from '@/lib/agent/mcp/api.server';

/** Platform MCP servers: listed and added by administrators. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listPlatformMcpServers(request); }
export function POST(request: NextRequest) { return createPlatformMcpServer(request); }
