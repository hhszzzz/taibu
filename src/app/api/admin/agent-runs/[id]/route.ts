/**
 * 单个 Agent 任务的任务树
 *
 * GET: 任务概况与按 Pi Durable 提交日志重建的任务树（含已结束的任务）
 */
import { NextRequest } from 'next/server';
import { getSystemAdminClient, jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { readAgentTaskTreeForAdmin } from '@/lib/agent/admin-tasks.server';

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
        return jsonError('任务 ID 无效', 400);
    }

    try {
        const result = await readAgentTaskTreeForAdmin(getSystemAdminClient(), id);
        return result ? jsonOk(result) : jsonError('任务不存在', 404);
    } catch (error) {
        console.error('[admin][agent-runs][GET] task tree failed:', error);
        return jsonError('读取任务树失败', 500);
    }
}
