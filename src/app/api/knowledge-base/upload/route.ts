import { NextRequest } from 'next/server';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
import { ingestFileAsService, backfillVectorsAsService } from '@/lib/knowledge-base/ingest';
import { triggerVectorIndexCreation } from '@/lib/knowledge-base/vector-index';
import { requireUserContext, jsonError, jsonOk, resolveRequestDbClient } from '@/lib/api-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';

function isAllowedFile(file: File) {
    if (file.type.startsWith('text/')) return true;
    const allowed = new Set(['application/json']);
    if (allowed.has(file.type)) return true;
    const lower = file.name.toLowerCase();
    return ['.txt', '.md', '.markdown', '.csv', '.json'].some(ext => lower.endsWith(ext));
}

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user } = auth;
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('知识库不存在或无权限', 500);

    let membership;
    try {
        membership = await getEffectiveMembershipType(user.id, { client: db });
    } catch (error) {
        if (error instanceof MembershipResolutionError) {
            return jsonError(error.message, 500);
        }
        throw error;
    }
    if (membership === 'free') {
        return jsonError('当前会员等级无法使用知识库', 403);
    }

    const formData = await request.formData();
    const kbId = formData.get('kbId');
    const file = formData.get('file');

    if (!kbId || typeof kbId !== 'string') {
        return jsonError('kbId 不能为空', 400);
    }

    if (!file || !(file instanceof File)) {
        return jsonError('文件不能为空', 400);
    }

    if (!isAllowedFile(file)) {
        return jsonError('不支持的文件类型', 400);
    }

    if (file.size > 5 * 1024 * 1024) {
        return jsonError('文件过大', 400);
    }

    const { data: kb } = await db
        .from('knowledge_bases')
        .select('id, user_id')
        .eq('id', kbId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!kb) return jsonError('知识库不存在或无权限', 403);

    const content = await file.text();
    const ingestResult = await ingestFileAsService(
        kbId,
        { name: file.name, type: file.type || null, content },
        user.id,
        { persistence: createKnowledgeBasePersistence(db) },
    );

    if (membership === 'pro') {
        try {
            await backfillVectorsAsService(kbId, user.id, 100);
            await triggerVectorIndexCreation();
        } catch (error) {
            void error;
        }
    }

    return jsonOk({ success: true, ...ingestResult });
}
