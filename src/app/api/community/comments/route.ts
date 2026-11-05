/**
 * 评论 API 路由
 * POST: 创建评论
 */

import { NextRequest } from 'next/server';
import { COMMUNITY_LIMITS } from '@/lib/community';
import { loadSingleCommunityAuthorProfile } from '@/lib/community-server';
import { jsonError, jsonOk, readJsonBody, requireUserContext } from '@/lib/api-utils';
import { withRetry } from '@/lib/retry';
import { hasNonEmptyStrings, isValidUUID } from '@/lib/validation';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

export async function POST(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const parsed = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
        if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
        const body = parsed.body;

        if (!hasNonEmptyStrings(body, ['post_id', 'content'])) {
            return jsonError('帖子ID和内容不能为空', 400);
        }
        const postId = body.post_id as string;
        const content = (body.content as string).trim();
        const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null;
        if (!isValidUUID(postId) || (parentId && !isValidUUID(parentId))) {
            return jsonError('帖子ID无效', 400);
        }
        if (!content || content.length > COMMUNITY_LIMITS.comment) {
            return jsonError(`评论不能超过 ${COMMUNITY_LIMITS.comment} 个字符`, 400);
        }

        // 作者资料与帖子/父评论校验互不依赖，可并行。
        const outcomePromise = withRetry(() => auth.db.tx(async (trx) => {
            const post = await trx.selectFrom('community_posts').select('id')
                .where('id', '=', postId).where('is_deleted', '=', false).executeTakeFirst();
            if (!post) return { ok: false as const, error: '帖子不存在或已删除', status: 404 };
            if (parentId) {
                const parent = await trx.selectFrom('community_comments').select('post_id')
                    .where('id', '=', parentId).where('is_deleted', '=', false).executeTakeFirst();
                if (!parent || parent.post_id !== postId) return { ok: false as const, error: '父评论不存在或不属于该帖子', status: 400 };
            }
            const data = await trx
                .insertInto('community_comments')
                .values({ post_id: postId, user_id: user.id, parent_id: parentId, content })
                .returningAll()
                .executeTakeFirstOrThrow();
            return { ok: true as const, data };
        }));
        const [authorProfile, outcome] = await Promise.all([
            loadSingleCommunityAuthorProfile(auth.db, user.id),
            outcomePromise,
        ]);
        if (!outcome.ok) return jsonError(outcome.error, outcome.status);
        const data = outcome.data;

        return jsonOk({
            id: data.id,
            post_id: data.post_id,
            parent_id: data.parent_id,
            content: data.content,
            upvote_count: data.upvote_count,
            downvote_count: data.downvote_count,
            is_deleted: data.is_deleted,
            created_at: data.created_at,
            updated_at: data.updated_at,
            author_name: authorProfile.name,
            author_avatar_url: authorProfile.avatarUrl,
        });
    } catch (error) {
        console.error('创建评论失败:', error);
        return jsonError('创建评论失败', 500);
    }
}
