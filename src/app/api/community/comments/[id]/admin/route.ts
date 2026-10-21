import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireAdminContext } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAdminContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { id } = await params;

    try {
        await systemDb().tx((trx) => trx
            .updateTable('community_comments')
            .set({ is_deleted: true, updated_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute());
    } catch (error) {
        console.error('管理员删除评论失败:', error);
        return jsonError('操作失败', 500);
    }

    return jsonOk({ success: true });
}
