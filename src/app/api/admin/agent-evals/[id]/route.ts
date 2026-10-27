/** 一次 Agent 测评的状态与进度。 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import { isValidUUID } from '@/lib/validation';
import { readAgentEvalRun } from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError('测评 ID 无效', 400);
    try {
        const run = await readAgentEvalRun(systemDb(), id);
        return run ? jsonOk({ run }) : jsonError('测评不存在', 404);
    } catch (error) {
        console.error('[admin][agent-evals][GET run]', { code: toDbError(error).code });
        return jsonError('读取测评失败', 500);
    }
}
