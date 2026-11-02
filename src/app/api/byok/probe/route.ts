import { type NextRequest } from 'next/server';
import { probe } from '@/lib/byok/api.server';

/** Tests a connection whose calls this site makes: lists the models, or sends one tiny chat. */
export const runtime = 'nodejs';
export const maxDuration = 120;
export function POST(request: NextRequest) { return probe(request); }
