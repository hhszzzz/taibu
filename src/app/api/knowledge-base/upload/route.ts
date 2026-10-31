import { NextRequest } from 'next/server';
import { ingestFileAsService, backfillVectorsAsService } from '@/lib/knowledge-base/ingest';
import { requireUserContext, jsonError, jsonOk, readMultipartForm } from '@/lib/api-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { KNOWLEDGE_FILE_MAX_BYTES, validateKnowledgeFile } from '@/lib/knowledge-base/upload-policy';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, db } = auth;

    // Bound the stream: a chunked request has no Content-Length to check.
    const parsed = await readMultipartForm(request, KNOWLEDGE_FILE_MAX_BYTES);
    if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
    const kbId = parsed.form.get('kbId');
    const file = parsed.form.get('file');

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
        db,
        { persistence: createKnowledgeBasePersistence(db) },
    );

    try {
        await backfillVectorsAsService(kbId, user.id, db, 100);
    } catch (error) {
        void error;
    }

    return jsonOk({ success: true, ...ingestResult });
}
