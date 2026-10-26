import { type NextRequest } from 'next/server';
import { testUserConnector } from '@/lib/agent/mcp/api.server';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return testUserConnector(request, (await context.params).id);
}
