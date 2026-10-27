/**
 * Agent 测评审题 API
 *
 * GET: 题库（内置题在首次读取时从 JSON 导入，后台可继续增改）；POST: 添加一道自定义题。
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import {
    AgentEvalInputError, createAgentEvalCase, listAgentEvalCases, parseEvalCaseInput,
} from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        return jsonOk({ cases: await listAgentEvalCases(systemDb()) });
    } catch (error) {
        console.error('[admin][agent-evals][cases][GET]', { code: toDbError(error).code });
        return jsonError('读取测评题库失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        const fields = parseEvalCaseInput(await request.json().catch(() => null), { requireId: false });
        return jsonOk({ case: await createAgentEvalCase(systemDb(), fields) }, 201);
    } catch (error) {
        if (error instanceof AgentEvalInputError) return jsonError(error.message, 400);
        console.error('[admin][agent-evals][cases][POST]', { code: toDbError(error).code });
        return jsonError('保存题目失败', 500);
    }
}
