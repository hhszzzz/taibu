import { jsonError, jsonOk } from '@/lib/api-utils';
import { pingDatabase } from '@/lib/db/context.server';
import { pingRedis } from '@/lib/redis.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Readiness: both dependencies must answer within 2s; failures return 503. */
export async function GET() {
  const [database, redis] = await Promise.all([pingDatabase(2000), pingRedis(2000)]);
  if (!database || !redis) {
    const response = jsonError('依赖未就绪', 503, { database, redis });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  return jsonOk({ ok: true, database, redis }, 200, { 'Cache-Control': 'no-store' });
}
