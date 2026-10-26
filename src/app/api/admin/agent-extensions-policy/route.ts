import { type NextRequest } from 'next/server';
import { readExtensionsPolicy, saveExtensionsPolicy } from '@/lib/agent/mcp/api.server';

/** Whether users may add their own connectors and skills; administrator-only. */
export const runtime = 'nodejs';
export function GET(request: NextRequest) { return readExtensionsPolicy(request); }
export function PUT(request: NextRequest) { return saveExtensionsPolicy(request); }
