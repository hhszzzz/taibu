/**
 * 投票 API 路由
 * GET: 获取用户投票状态
 * POST: 投票（切换）- 添加错误处理
 */

import { NextRequest } from 'next/server';
import { TargetType, VoteType } from '@/lib/community';
import { getAuthContext, jsonError, jsonOk, readJsonBody, requireUserContext } from '@/lib/api-utils';
import { withRetry } from '@/lib/retry';
import { isValidUUID, missingFields, missingSearchParams } from '@/lib/validation';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

export async function GET(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await getAuthContext(request);
        if (auth.authError) {
            return jsonError(auth.authError.message, auth.authError.status);
        }
        const { user } = auth;
        if (!user) {
            return jsonOk({ vote: null });
        }

        const { searchParams } = new URL(request.url);
        const targetType = searchParams.get('targetType') as TargetType;
        const targetId = searchParams.get('targetId');

        if (missingSearchParams(searchParams, ['targetType', 'targetId']).length > 0) {
            return jsonError('缺少参数', 400);
        }
        const voteRow = await withRetry(() => auth.db.tx((trx) => trx
            .selectFrom('community_votes')
            .select('vote_type')
            .where('user_id', '=', user.id)
            .where('target_type', '=', targetType)
            .where('target_id', '=', targetId as string)
            .executeTakeFirst()));

        return jsonOk({ vote: voteRow?.vote_type || null });
    } catch (error) {
        console.error('获取投票状态失败:', error);
        return jsonError('获取投票状态失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const parsed = await readJsonBody<Record<string, unknown>>(request, 4 * 1024);
        if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
        const body = parsed.body;
        const { targetType, targetId, voteType } = body as {
            targetType: TargetType;
            targetId: string;
            voteType: VoteType;
        };

        if (missingFields(body, ['targetType', 'targetId', 'voteType']).length > 0) {
            return jsonError('缺少参数', 400);
        }

        // 验证 targetType 和 voteType 的有效性
        if (!['post', 'comment'].includes(targetType)) {
            return jsonError('无效的目标类型', 400);
        }
        if (!['up', 'down'].includes(voteType)) {
            return jsonError('无效的投票类型', 400);
        }
        if (!isValidUUID(targetId)) {
            return jsonError('目标ID无效', 400);
        }

        let data: unknown;
        try {
            data = await auth.db.rpc('toggle_community_vote', {
                p_target_type: targetType,
                p_target_id: targetId,
                p_vote_type: voteType,
            });
        } catch (error) {
            if ((error as { code?: string }).code === 'P0002') return jsonError('目标不存在或已删除', 404);
            console.error('投票失败:', error);
            return jsonError('投票失败', 500);
        }

        const result = (Array.isArray(data) ? data[0] : data) as { status?: string; vote?: VoteType | null } | null;
        if (result?.status !== 'ok') {
            console.error('投票失败: invalid rpc result', data);
            return jsonError('投票失败', 500);
        }

        return jsonOk({ vote: result.vote ?? null });
    } catch (error) {
        console.error('投票失败:', error);
        return jsonError('投票失败', 500);
    }
}
