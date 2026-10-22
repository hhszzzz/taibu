import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const { id } = await params;
        const body = await request.json() as {
            note_date?: string;
            content?: string;
            mood?: string | null;
        };

        const data = await auth.db.tx((trx) => trx
            .updateTable('ming_notes')
            .set({
                ...(body.note_date !== undefined ? { note_date: body.note_date } : {}),
                ...(body.content !== undefined ? { content: body.content } : {}),
                ...(body.mood !== undefined ? { mood: body.mood } : {}),
                updated_at: new Date().toISOString(),
            } as never)
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .returningAll()
            .executeTakeFirst());

        if (!data) {
            return jsonError('小记不存在', 404);
        }

        return jsonOk(data as Record<string, unknown>);
    } catch (error) {
        console.error('更新小记失败:', error);
        return jsonError('更新小记失败', 500);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const { id } = await params;
        await auth.db.tx((trx) => trx
            .deleteFrom('ming_notes')
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .execute());

        return jsonOk({ success: true });
    } catch (error) {
        console.error('删除小记失败:', error);
        return jsonError('删除小记失败', 500);
    }
}
