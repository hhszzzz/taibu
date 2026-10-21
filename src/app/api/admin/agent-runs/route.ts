/**
 * Agent 任务排障 API
 *
 * GET: 进行中（scope=active，默认）或最近（scope=recent）的 Agent 任务，新的在前；
 *      q 为任务、对话或用户 ID 时查找它们的任务，不限状态
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { isValidUUID } from '@/lib/validation';
import { listAgentRunsForAdmin } from '@/lib/agent/admin-tasks.server';

export async function GET(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const search = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (search && !isValidUUID(search)) {
        return jsonError('请输入完整的任务、对话或用户 ID', 400);
    }
    const scope = request.nextUrl.searchParams.get('scope') === 'recent' ? 'recent' : 'active';

    try {
        const runs = await listAgentRunsForAdmin(systemDb(), { scope, ...(search ? { search } : {}) });
        return jsonOk({ runs });
    } catch (error) {
        console.error('[admin][agent-runs][GET] query failed:', error);
        return jsonError('获取 Agent 任务失败', 500);
    }
}
