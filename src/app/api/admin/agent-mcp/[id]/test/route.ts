import { type NextRequest } from 'next/server';
import { testPlatformMcpServer } from '@/lib/agent/mcp/api.server';

/** Connects with the saved settings and records the server's tools for the settings page. */
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return testPlatformMcpServer(request, (await context.params).id);
}
