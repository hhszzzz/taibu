/**
 * 评论 API 路由
 * POST: 创建评论
 */

import { NextRequest } from 'next/server';
import { loadSingleCommunityAuthorProfile } from '@/lib/community-server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { withRetry } from '@/lib/retry';
import { hasNonEmptyStrings } from '@/lib/validation';

export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const body = await request.json() as Record<string, unknown>;

        if (!hasNonEmptyStrings(body, ['post_id', 'content'])) {
            return jsonError('帖子ID和内容不能为空', 400);
        }

        const authorProfile = await loadSingleCommunityAuthorProfile(auth.db, user.id);

        // 创建评论
        let data;
        try {
            data = await withRetry(() => auth.db.tx((trx) => trx
                .insertInto('community_comments')
                .values({
                    post_id: body.post_id as string,
                    user_id: user.id,
                    parent_id: typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null,
                    content: body.content as string,
                })
                .returningAll()
                .executeTakeFirstOrThrow()));
        } catch (commentError) {
            console.error('创建评论失败:', commentError);
            return jsonError('创建评论失败', 500);
        }

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
