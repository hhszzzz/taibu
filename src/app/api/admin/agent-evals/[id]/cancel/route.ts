/** 取消一次 Agent 测评：排队中的立即结束，运行中的由 worker 在下一题前停止。 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { isValidUUID } from '@/lib/validation';
import { cancelAgentEvalRun } from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError('测评 ID 无效', 400);
    try {
        const run = await cancelAgentEvalRun(systemDb(), id);
        return run ? jsonOk({ run }) : jsonError('测评不存在', 404);
    } catch (error) {
        console.error('[admin][agent-evals][cancel]', { code: toDbError(error).code });
        return jsonError('取消测评失败', 500);
    }
}
