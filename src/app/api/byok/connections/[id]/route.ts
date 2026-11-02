import { type NextRequest } from 'next/server';
import { deleteConnection, updateConnection } from '@/lib/byok/api.server';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) { return updateConnection(request, (await params).id); }
export async function DELETE(request: NextRequest, { params }: Context) { return deleteConnection(request, (await params).id); }
