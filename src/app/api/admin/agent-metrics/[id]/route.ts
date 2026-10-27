/**
 * 单次 Agent 运行的性能明细
 *
 * GET: 该运行的耗时、首字延迟、各阶段次数与耗时、重试、故障、挂起、token 与阶段时间线
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { isValidUUID } from '@/lib/validation';
import { readAgentMetricRunForAdmin } from '@/lib/agent/admin-metrics.server';

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
        return jsonError('运行 ID 无效', 400);
    }

    try {
        const metrics = await readAgentMetricRunForAdmin(systemDb(), id);
        return metrics ? jsonOk({ metrics }) : jsonError('没有这个运行的指标', 404);
    } catch (error) {
        console.error('[admin][agent-metrics][GET] run metrics failed:', error);
        return jsonError('读取运行指标失败', 500);
    }
}
