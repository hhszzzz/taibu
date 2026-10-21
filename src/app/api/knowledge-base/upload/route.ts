import { NextRequest } from 'next/server';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
import { ingestFileAsService, backfillVectorsAsService } from '@/lib/knowledge-base/ingest';
import { triggerVectorIndexCreation } from '@/lib/knowledge-base/vector-index';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { validateKnowledgeFile } from '@/lib/knowledge-base/upload-policy';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, scoped: db } = auth;

    let membership;
    try {
        membership = await getEffectiveMembershipType(user.id, { db });
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

    const fileError = validateKnowledgeFile(file);
    if (fileError) {
        return jsonError(fileError, 400);
    }

    let kb;
    try {
        kb = await db.tx((trx) => trx
            .selectFrom('knowledge_bases')
            .select(['id', 'user_id'])
            .where('id', '=', kbId)
            .where('user_id', '=', user.id)
            .executeTakeFirst());
    } catch {
        return jsonError('知识库不存在或无权限', 500);
    }

    if (!kb) return jsonError('知识库不存在或无权限', 403);

    const content = await file.text();
    const ingestResult = await ingestFileAsService(
        kbId,
        { name: file.name, type: file.type || null, content },
        user.id,
        db,
        { persistence: createKnowledgeBasePersistence(db) },
    );

    if (membership === 'pro') {
        try {
            await backfillVectorsAsService(kbId, user.id, db, 100);
            await triggerVectorIndexCreation();
        } catch (error) {
            void error;
        }
    }

    return jsonOk({ success: true, ...ingestResult });
}
