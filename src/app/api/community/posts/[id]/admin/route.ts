/**
 * 管理员帖子操作 API 路由
 * PUT: 管理员操作（置顶、精华、删除）
 */

import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminContext } from '@/lib/api-utils';
import { missingFields } from '@/lib/validation';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireAdminContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const { id } = await params;
        const body = await request.json();
        const { action, value } = body;

        if (missingFields(body, ['action']).length > 0) {
            return jsonError('缺少参数', 400);
        }

        const patch = action === 'pin'
            ? { is_pinned: value as boolean }
            : action === 'feature'
                ? { is_featured: value as boolean }
                : action === 'delete'
                    ? { is_deleted: true }
                    : null;

        if (!patch) {
            return jsonError('无效操作', 400);
        }

        // The administrator passes the table's admin policy on its own.
        await auth.db.tx((trx) => trx
            .updateTable('community_posts')
            .set({ ...patch, updated_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute());

        return jsonOk({ success: true });
    } catch (error) {
        console.error('管理员操作失败:', error);
        return jsonError('操作失败', 500);
    }
}
