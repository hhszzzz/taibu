/**
 * Deployment logs API
 *
 * GET: fetch deployment history with pagination
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const auth = await requireAdminUser(request);
  if ('error' in auth) {
    return jsonError(auth.error.message, auth.error.status);
  }

  try {
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10));
    const offset = (page - 1) * PAGE_SIZE;

    const db = systemDb();

    // Fetch logs with user details
    const logs = await db.tx((trx) =>
      trx
        .selectFrom('deployment_logs')
        .leftJoin('users', 'deployment_logs.triggered_by', 'users.id')
        .select([
          'deployment_logs.id',
          'deployment_logs.version_from',
          'deployment_logs.version_to',
          'users.nickname',
          'deployment_logs.status',
          'deployment_logs.started_at',
          'deployment_logs.completed_at',
          'deployment_logs.log_output',
          'deployment_logs.created_at',
        ])
        .orderBy('deployment_logs.created_at', 'desc')
        .limit(PAGE_SIZE + 1)
        .offset(offset)
        .execute(),
    );

    const hasMore = logs.length > PAGE_SIZE;
    const items = logs.slice(0, PAGE_SIZE);

    return jsonOk({
      items,
      page,
      pageSize: PAGE_SIZE,
      hasMore,
    });
  } catch (error) {
    console.error('[admin][system][deployment-logs][GET] query failed:', error);
    return jsonError('获取部署日志失败', 500);
  }
}
