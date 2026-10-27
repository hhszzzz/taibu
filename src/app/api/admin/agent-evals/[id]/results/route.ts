/** 一次 Agent 测评的逐题结果与按模型聚合的排行榜。 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { isValidUUID } from '@/lib/validation';
import { readAgentEvalResults } from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError('测评 ID 无效', 400);
    try {
        const data = await readAgentEvalResults(systemDb(), id);
        return data ? jsonOk(data) : jsonError('测评不存在', 404);
    } catch (error) {
        console.error('[admin][agent-evals][results]', { code: toDbError(error).code });
        return jsonError('读取测评结果失败', 500);
    }
}
