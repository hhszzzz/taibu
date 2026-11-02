import { type NextRequest } from 'next/server';
import { createConnection, listConnections } from '@/lib/byok/api.server';

/** The member's own model connections (settings → 自定义模型). */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return listConnections(request); }
export function POST(request: NextRequest) { return createConnection(request); }
