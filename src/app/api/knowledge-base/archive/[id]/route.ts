import { NextRequest } from 'next/server';
import { getSystemAdminClient, requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { parseArchiveId } from '@/lib/knowledge-base/archive-ids';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUserContext(_request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user } = auth;
    const supabase = auth.db;
    const serviceClient = getSystemAdminClient();

    const target = parseArchiveId((await params).id);
    if (target.kind === 'malformed') return jsonError('取消归档失败', 400);

    if (target.kind === 'virtual') {
        const { kbId, sourceType, sourceId } = target;
        const { data: kb } = await supabase
            .from('knowledge_bases')
            .select('id')
            .eq('id', kbId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (!kb) return jsonError('取消归档失败', 403);

        const { data, error } = await serviceClient.rpc('kb_unarchive_source_as_service', {
            p_user_id: user.id,
            p_kb_id: kbId,
            p_source_type: sourceType,
            p_source_id: sourceId,
        });

        if (error || data !== true) return jsonError('取消归档失败', 500);
        return jsonOk({ success: true, kbId, sourceType, sourceId });
    }

    const { data: archived, error: fetchError } = await supabase
        .from('archived_sources')
        .select('id, kb_id, source_type, source_id')
        .eq('id', target.id)
        .eq('user_id', user.id)
        .maybeSingle();

    if (fetchError) return jsonError('取消归档失败', 500);
    if (!archived) return jsonError('归档记录不存在', 404);

    const { data, error } = await serviceClient.rpc('kb_unarchive_source_as_service', {
        p_user_id: user.id,
        p_kb_id: archived.kb_id,
        p_source_type: archived.source_type,
        p_source_id: archived.source_id,
    });

    if (error || data !== true) return jsonError('取消归档失败', 500);
    return jsonOk({
        success: true,
        kbId: archived.kb_id,
        sourceType: archived.source_type,
        sourceId: archived.source_id,
    });
}
