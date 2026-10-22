import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { isValidUUID } from '@/lib/validation';
import { validMemory } from '@/lib/agent/memory';

const MEMORY_COLUMNS = ['id', 'title', 'content', 'kind', 'updated_at'] as const;

async function context(request: NextRequest): Promise<{ error: Response } | { db: ScopedDb; userId: string }> {
    const auth = await requireUserContext(request);
    if ('error' in auth) return { error: jsonError(auth.error.message, auth.error.status) };
    const expected = request.headers.get('X-Expected-User-Id');
    if (expected !== null && expected !== auth.user.id) return { error: jsonError('账号已切换', 409) };
    return { db: auth.db, userId: auth.user.id };
}
export async function GET(request: NextRequest) {
    const auth = await context(request);
    if ('error' in auth) return auth.error;
    let memories;
    try {
        memories = await auth.db.tx((trx) => trx
            .selectFrom('user_agent_memory')
            .select(MEMORY_COLUMNS)
            .where('user_id', '=', auth.userId)
            .orderBy('updated_at', 'desc')
            .limit(128)
            .execute());
    } catch (error) {
        console.error('读取记忆失败:', error);
        return jsonError('读取记忆失败', 500);
    }
    return jsonOk({ memories: memories ?? [] });
}
export async function POST(request: NextRequest) {
    const auth = await context(request);
    if ('error' in auth) return auth.error;
    const body = await request.json().catch(() => null);
    if (!validMemory(body)) return jsonError('记忆标题或正文无效', 400);
    let memory;
    try {
        memory = await auth.db.tx((trx) => trx
            .insertInto('user_agent_memory')
            .values({
                user_id: auth.userId,
                title: body.title.trim(),
                content: body.content.trim(),
                kind: body.kind,
                source_run_id: null,
                source_text: '用户手动保存',
            })
            .onConflict((oc) => oc.columns(['user_id', 'fingerprint']).doUpdateSet({
                title: body.title.trim(),
                content: body.content.trim(),
                kind: body.kind,
            }))
            .returning(MEMORY_COLUMNS)
            .executeTakeFirstOrThrow());
    } catch (error) {
        console.error('保存记忆失败:', error);
        return jsonError('保存记忆失败或已达到 128 条上限', 409);
    }
    return jsonOk({ memory });
}
export async function DELETE(request: NextRequest) {
    const auth = await context(request);
    if ('error' in auth) return auth.error;
    const body = await request.json().catch(() => null);
    if (!isValidUUID(body?.id)) return jsonError('记忆标识无效', 400);
    let deleted;
    try {
        deleted = await auth.db.tx((trx) => trx
            .deleteFrom('user_agent_memory')
            .where('user_id', '=', auth.userId)
            .where('id', '=', body.id)
            .returning('id')
            .execute());
    } catch (error) {
        console.error('删除记忆失败:', error);
        return jsonError('删除记忆失败', 500);
    }
    return !deleted?.length ? jsonError('记忆不存在', 404) : jsonOk({ deleted: true });
}
