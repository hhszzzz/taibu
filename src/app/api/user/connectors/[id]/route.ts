import { type NextRequest } from 'next/server';
import { deleteUserConnector, updateUserConnector } from '@/lib/agent/mcp/api.server';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: RouteContext) { return updateUserConnector(request, (await context.params).id); }
export async function DELETE(request: NextRequest, context: RouteContext) { return deleteUserConnector(request, (await context.params).id); }
