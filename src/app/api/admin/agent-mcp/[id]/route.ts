import { type NextRequest } from 'next/server';
import { deletePlatformMcpServer, updatePlatformMcpServer } from '@/lib/agent/mcp/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: RouteContext) { return updatePlatformMcpServer(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return deletePlatformMcpServer(request, (await context.params).id); }
