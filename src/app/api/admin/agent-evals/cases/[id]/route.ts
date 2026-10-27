/**
 * Agent 测评单题 API
 *
 * PATCH: 修改题面、断言、参数或启用状态；DELETE: 删除自定义题（内置题只能停用）。
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import {
    AgentEvalInputError, deleteAgentEvalCase, parseEvalCaseUpdate, updateAgentEvalCase,
} from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!CASE_ID.test(id)) return jsonError('题目标识无效', 400);
    try {
        const update = parseEvalCaseUpdate(await request.json().catch(() => null));
        const item = await updateAgentEvalCase(systemDb(), id, update);
        return item ? jsonOk({ case: item }) : jsonError('题目不存在', 404);
    } catch (error) {
        if (error instanceof AgentEvalInputError) return jsonError(error.message, 400);
        console.error('[admin][agent-evals][cases][PATCH]', { code: toDbError(error).code });
        return jsonError('保存题目失败', 500);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!CASE_ID.test(id)) return jsonError('题目标识无效', 400);
    try {
        const deleted = await deleteAgentEvalCase(systemDb(), id);
        return deleted ? jsonOk({ deleted: true }) : jsonError('题目不存在', 404);
    } catch (error) {
        if (error instanceof AgentEvalInputError) return jsonError(error.message, 400);
        console.error('[admin][agent-evals][cases][DELETE]', { code: toDbError(error).code });
        return jsonError('删除题目失败', 500);
    }
}
