import { type NextRequest } from 'next/server';
import { capabilities } from '@/lib/byok/api.server';

/** What models.dev knows of the model IDs a member adds: context, output limit, image input, thinking levels. */
export const runtime = 'nodejs';
export function POST(request: NextRequest) { return capabilities(request); }
