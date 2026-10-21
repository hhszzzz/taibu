import { NextRequest } from 'next/server';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { parseArchiveId } from '@/lib/knowledge-base/archive-ids';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUserContext(_request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped } = auth;
    const serviceDb = systemDb();

    const target = parseArchiveId((await params).id);
    if (target.kind === 'malformed') return jsonError('取消归档失败', 400);

    if (target.kind === 'virtual') {
        const { kbId, sourceType, sourceId } = target;
        const kb = await scoped.tx((trx) => trx
            .selectFrom('knowledge_bases')
            .select('id')
            .where('id', '=', kbId)
            .where('user_id', '=', user.id)
            .executeTakeFirst());
        if (!kb) return jsonError('取消归档失败', 403);

        let data: unknown;
        try {
            data = await serviceDb.rpc('kb_unarchive_source_as_service', {
                p_user_id: user.id,
                p_kb_id: kbId,
                p_source_type: sourceType,
                p_source_id: sourceId,
            });
        } catch {
            return jsonError('取消归档失败', 500);
        }

        if (data !== true) return jsonError('取消归档失败', 500);
        return jsonOk({ success: true, kbId, sourceType, sourceId });
    }

    let archived;
    try {
        archived = await scoped.tx((trx) => trx
            .selectFrom('archived_sources')
            .select(['id', 'kb_id', 'source_type', 'source_id'])
            .where('id', '=', target.id)
            .where('user_id', '=', user.id)
            .executeTakeFirst());
    } catch {
        return jsonError('取消归档失败', 500);
    }

    if (!archived) return jsonError('归档记录不存在', 404);

    let data: unknown;
    try {
        data = await serviceDb.rpc('kb_unarchive_source_as_service', {
            p_user_id: user.id,
            p_kb_id: archived.kb_id,
            p_source_type: archived.source_type,
            p_source_id: archived.source_id,
        });
    } catch {
        return jsonError('取消归档失败', 500);
    }

    if (data !== true) return jsonError('取消归档失败', 500);
    return jsonOk({
        success: true,
        kbId: archived.kb_id,
        sourceType: archived.source_type,
        sourceId: archived.source_id,
    });
}
