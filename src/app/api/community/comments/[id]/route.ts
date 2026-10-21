/**
 * 单个评论 API 路由
 * PUT: 更新评论
 * DELETE: 删除评论（软删除）
 */

import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { withRetry } from '@/lib/retry';
import { hasNonEmptyStrings } from '@/lib/validation';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const { id } = await params;
        const data = await auth.scoped.tx((trx) => trx
            .selectFrom('community_comments')
            .select(['id', 'user_id'])
            .where('id', '=', id)
            .where('is_deleted', '=', false)
            .executeTakeFirst());

        if (!data) {
            return jsonError('评论不存在', 404);
        }

        const isAuthor = data.user_id === user.id;
        return jsonOk({
            viewer: {
                isAuthenticated: true,
                isAuthor,
            },
        });
    } catch (error) {
        console.error('获取评论失败:', error);
        return jsonError('获取评论失败', 500);
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const { id } = await params;
        const body = await request.json();

        if (!hasNonEmptyStrings(body, ['content'])) {
            return jsonError('内容不能为空', 400);
        }

        let data;
        try {
            data = await withRetry(() => auth.scoped.tx((trx) => trx
                .updateTable('community_comments')
                .set({
                    content: body.content,
                    updated_at: new Date().toISOString(),
                })
                .where('id', '=', id)
                .where('user_id', '=', user.id)
                .where('is_deleted', '=', false)
                .returningAll()
                .executeTakeFirst()));
        } catch (updateError) {
            console.error('更新评论失败:', updateError);
            return jsonError('更新评论失败', 500);
        }

        if (!data) {
            return jsonError('无权限编辑此评论', 403);
        }
        const safeComment = { ...data } as Record<string, unknown>;
        delete (safeComment as { user_id?: unknown }).user_id;
        return jsonOk(safeComment);
    } catch (error) {
        console.error('更新评论失败:', error);
        return jsonError('更新评论失败', 500);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const { id } = await params;

        let deleted;
        try {
            deleted = await withRetry(() => auth.scoped.tx((trx) => trx
                .updateTable('community_comments')
                .set({ is_deleted: true, updated_at: new Date().toISOString() })
                .where('id', '=', id)
                .where('user_id', '=', user.id)
                .where('is_deleted', '=', false)
                .returning('id')
                .executeTakeFirst()));
        } catch (deleteError) {
            console.error('删除评论失败:', deleteError);
            return jsonError('删除评论失败', 500);
        }

        if (!deleted) {
            return jsonError('无权限删除此评论', 403);
        }

        return jsonOk({ success: true });
    } catch (error) {
        console.error('删除评论失败:', error);
        return jsonError('删除评论失败', 500);
    }
}
