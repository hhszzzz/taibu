/**
 * 定时任务运行记录（管理员）
 *
 * GET: 全站定时任务的每次运行，新的在前；按状态、用户邮箱（前缀）与时间筛选，附各状态计数
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { parseAgentScheduleRunAdminFilters } from '@/lib/agent/admin-schedule-runs';
import { listAgentScheduleRunsForAdmin } from '@/lib/agent/admin-schedule-runs.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }
    const params = request.nextUrl.searchParams;
    const filters = parseAgentScheduleRunAdminFilters(params);
    if ('error' in filters) {
        return jsonError(filters.error, 400);
    }
    try {
        return jsonOk(await listAgentScheduleRunsForAdmin(filters, { offset: Number(params.get('offset')) || 0, limit: Number(params.get('limit')) || 50 }));
    } catch (error) {
        console.error('[admin][agent-schedules][runs] query failed:', error);
        return jsonError('读取定时任务记录失败', 500);
    }
}
