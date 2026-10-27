/**
 * Agent 运行性能 API
 *
 * GET: 按模型统计近 days 天（1、7 或 30，默认 7）的运行指标：总耗时与首字延迟的 P50/P95、工具耗时占比、
 *      失败率与挂起率，以及同一窗口内最近的运行列表
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { agentMetricsDays, readAgentMetricsForAdmin } from '@/lib/agent/admin-metrics.server';

export async function GET(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const days = agentMetricsDays(request.nextUrl.searchParams.get('days'));
    try {
        return jsonOk(await readAgentMetricsForAdmin(systemDb(), days));
    } catch (error) {
        console.error('[admin][agent-metrics][GET] query failed:', error);
        return jsonError('获取 Agent 运行指标失败', 500);
    }
}
