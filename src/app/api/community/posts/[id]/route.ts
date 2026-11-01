/**
 * 单个帖子 API 路由
 * GET: 获取帖子详情
 * PUT: 更新帖子
 * DELETE: 删除帖子（软删除）
 */

import { NextRequest } from 'next/server';
import { CommunityComment, normalizePostInput } from '@/lib/community';
import { loadCommunityAuthorProfileMap, toPublicPost, type CommunityPostRow } from '@/lib/community-server';
import { getAuthContext, jsonError, jsonOk, readJsonBody, requireUserContext } from '@/lib/api-utils';
import { withRetry } from '@/lib/retry';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

type CommunityCommentRow = Omit<CommunityComment, 'author_name' | 'author_avatar_url' | 'replies'> & {
    user_id: string;
    replies?: CommunityCommentRow[];
};

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await getAuthContext(_request);
        if (auth.authError) {
            return jsonError(auth.authError.message, auth.authError.status);
        }
        const { user } = auth;
        const db = auth.db;
        const { id } = await params;

        let post: Record<string, unknown> | undefined;
        try {
            post = await auth.db.tx((trx) => trx
                .selectFrom('community_posts')
                .selectAll()
                .where('id', '=', id)
                .where('is_deleted', '=', false)
                .executeTakeFirst());
        } catch (postError) {
            console.error('获取帖子失败:', postError);
            return jsonError('获取帖子失败', 500);
        }
        if (!post) {
            return jsonError('帖子不存在', 404);
        }
        const postRow = post;
        const postId = postRow.id as string;

        // The counter is a definer function (readers have no write policy) and
        // must never make the post unreadable when it fails.
        try {
            await withRetry(() => db.rpc('increment_community_post_view_count', { post_id: id }));
        } catch (viewError) {
            console.error('更新浏览量失败:', viewError);
        }

        let commentsData: CommunityCommentRow[];
        try {
            commentsData = await withRetry(() => db.tx((trx) => trx
                .selectFrom('community_comments')
                .selectAll()
                .where('post_id', '=', id)
                .where('is_deleted', '=', false)
                .orderBy('created_at', 'asc')
                .execute())) as unknown as CommunityCommentRow[];
        } catch (commentsError) {
            console.error('获取评论失败:', commentsError);
            commentsData = [];
        }

        const authorMap = await loadCommunityAuthorProfileMap(db, [
            postRow.user_id as string,
            ...commentsData.map((comment) => comment.user_id),
        ]);

        type CommentWithReplies = CommunityCommentRow & { replies: CommentWithReplies[] };
        const comments: CommentWithReplies[] = (commentsData || []).map((comment: CommunityCommentRow) => ({
            ...comment,
            replies: [],
        }));

        const commentMap = new Map<string, CommentWithReplies>();
        const rootComments: CommentWithReplies[] = [];

        comments.forEach(comment => {
            commentMap.set(comment.id, comment);
        });

        comments.forEach(comment => {
            if (comment.parent_id) {
                const parent = commentMap.get(comment.parent_id);
                if (parent) {
                    parent.replies.push(comment);
                }
            } else {
                rootComments.push(comment);
            }
        });

        // 获取当前用户信息（需要在处理评论前获取）
        const currentUserId = user?.id;
        const isPostAuthor = currentUserId ? postRow.user_id === currentUserId : false;
        const viewer = {
            isAuthenticated: !!currentUserId,
            isAuthor: isPostAuthor,
        };
        const commentIds = comments.map((comment) => comment.id);
        const viewerVotes = {
            post: null as 'up' | 'down' | null,
            comments: {} as Record<string, 'up' | 'down'>,
        };

        if (currentUserId) {
            const voteTargetIds: string[] = [postId, ...commentIds];
            if (voteTargetIds.length > 0) {
                try {
                    const voteRows = await withRetry(() => db.tx((trx) => trx
                        .selectFrom('community_votes')
                        .select(['target_type', 'target_id', 'vote_type'])
                        .where('user_id', '=', currentUserId)
                        .where('target_id', 'in', voteTargetIds)
                        .execute()));
                    for (const row of voteRows) {
                        if (row.target_type === 'post' && row.target_id === postId) {
                            viewerVotes.post = row.vote_type as 'up' | 'down';
                            continue;
                        }
                        if (row.target_type === 'comment' && typeof row.target_id === 'string') {
                            viewerVotes.comments[row.target_id] = row.vote_type as 'up' | 'down';
                        }
                    }
                } catch (voteError) {
                    console.error('获取帖子投票状态失败:', voteError);
                }
            }
        }

        // 为评论添加 author/isAuthor 标记，然后移除 user_id
        type SafeComment = Omit<CommentWithReplies, 'user_id' | 'replies'> & {
            author_name: string;
            author_avatar_url: string | null;
            isAuthor: boolean;
            isPostAuthor: boolean;
            replies: SafeComment[];
        };
        function processComment(comment: CommentWithReplies): SafeComment {
            const isCommentAuthor = currentUserId ? comment.user_id === currentUserId : false;
            const isPostAuthor = comment.user_id === postRow.user_id;
            const { replies, ...safeComment } = comment;
            delete (safeComment as { user_id?: unknown }).user_id;
            const authorProfile = authorMap.get(comment.user_id) || { name: '命理爱好者', avatarUrl: null };
            return {
                ...safeComment,
                author_name: authorProfile.name,
                author_avatar_url: authorProfile.avatarUrl,
                isAuthor: isCommentAuthor,
                isPostAuthor,
                replies: (replies || []).map(processComment),
            };
        }

        const safePost = toPublicPost(
            postRow as unknown as CommunityPostRow,
            authorMap.get(postRow.user_id as string) || { name: '命理爱好者', avatarUrl: null },
        );
        const safeComments = rootComments.map(c => processComment(c));

        return jsonOk({
            post: safePost,
            comments: safeComments,
            viewer,
            viewerVotes,
        });
    } catch (error) {
        console.error('获取帖子失败:', error);
        return jsonError('获取帖子失败', 500);
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const { id } = await params;
        const parsed = await readJsonBody(request, 64 * 1024);
        if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
        const body = parsed.body;

        const normalized = normalizePostInput(body, 'update');
        if ('error' in normalized) {
            return jsonError(normalized.error, 400);
        }

        // 只允许用户更新特定字段，防止权限提升
        const updateData: Record<string, unknown> = {
            ...normalized.data,
            updated_at: new Date().toISOString(),
        };

        let data;
        try {
            data = await auth.db.tx((trx) => trx
                .updateTable('community_posts')
                .set(updateData as never)
                .where('id', '=', id)
                .where('user_id', '=', user.id)
                .returningAll()
                .executeTakeFirst());
        } catch (error) {
            console.error('更新帖子失败:', error);
            return jsonError('更新帖子失败', 500);
        }

        if (!data) {
            return jsonError('帖子不存在或无权修改', 404);
        }

        const authorMap = await loadCommunityAuthorProfileMap(auth.db, [user.id]);
        return jsonOk(
            toPublicPost(data as unknown as CommunityPostRow, authorMap.get(user.id) || { name: '命理爱好者', avatarUrl: null }),
        );
    } catch (error) {
        console.error('更新帖子失败:', error);
        return jsonError('更新帖子失败', 500);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const { id } = await params;

        try {
            await auth.db.tx((trx) => trx
                .updateTable('community_posts')
                .set({ is_deleted: true, updated_at: new Date().toISOString() })
                .where('id', '=', id)
                .where('user_id', '=', user.id)
                .execute());
        } catch (error) {
            console.error('删除帖子失败:', error);
            return jsonError('删除帖子失败', 500);
        }

        return jsonOk({ success: true });
    } catch (error) {
        console.error('删除帖子失败:', error);
        return jsonError('删除帖子失败', 500);
    }
}
