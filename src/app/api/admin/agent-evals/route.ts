/**
 * Agent 测评 API
 *
 * GET: 最近的测评运行与可选的聊天模型；POST: 按题目、参赛模型、评审模型与重复次数发起一次测评。
 * 单次测评的题目 × 模型 × 重复次数不超过 200，由后台队列串行执行。
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminUser } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { toDbError } from '@/lib/db/errors';
import {
    AgentEvalInputError, launchAgentEval, listAgentEvalRuns, parseAgentEvalLaunch,
} from '@/lib/agent/eval/service.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        return jsonOk(await listAgentEvalRuns(systemDb()));
    } catch (error) {
        console.error('[admin][agent-evals][GET]', { code: toDbError(error).code });
        return jsonError('读取测评记录失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const auth = await requireAdminUser(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        const input = parseAgentEvalLaunch(await request.json().catch(() => null));
        return jsonOk({ run: await launchAgentEval(systemDb(), auth.user.id, input) }, 201);
    } catch (error) {
        if (error instanceof AgentEvalInputError) return jsonError(error.message, 400);
        console.error('[admin][agent-evals][POST]', { code: toDbError(error).code });
        return jsonError('发起测评失败', 500);
    }
}
