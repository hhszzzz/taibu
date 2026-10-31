
import { NextRequest } from 'next/server';
import type { DataSourceType } from '@/lib/data-sources/types';
import { MING_RECORD_SOURCE_TYPE } from '@/lib/data-sources/types';
import {
    ingestConversationAsService,
    ingestChatMessageAsService,
    ingestRecordAsService,
    ingestDataSourceAsService,
    backfillVectorsAsService,
    normalizeKnowledgeBaseSourceType,
} from '@/lib/knowledge-base/ingest';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user, db } = auth;

    const body = await request.json() as {
        kbId?: string;
        sourceType?: 'conversation' | 'record' | 'chat_message' | DataSourceType;
        sourceId?: string;
        sourceMeta?: { conversationId?: string };
    };

    if (!body.kbId || !body.sourceType || !body.sourceId) {
        return jsonError('参数不完整', 400);
    }
    if (body.sourceType === 'chat_message' && !body.sourceMeta?.conversationId) {
        return jsonError('缺少对话信息', 400);
    }

    const kbId = body.kbId;
    const normalizedSourceType = body.sourceType === 'conversation' || body.sourceType === 'chat_message'
        ? body.sourceType
        : normalizeKnowledgeBaseSourceType(body.sourceType);

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

    const options = { persistence: createKnowledgeBasePersistence(db) };
    const ingestResult = normalizedSourceType === 'conversation'
        ? await ingestConversationAsService(kbId, body.sourceId, user.id, db, options)
        : normalizedSourceType === MING_RECORD_SOURCE_TYPE
            ? await ingestRecordAsService(kbId, body.sourceId, user.id, db, options)
            : normalizedSourceType === 'chat_message'
                ? await ingestChatMessageAsService(kbId, body.sourceMeta?.conversationId || '', body.sourceId, user.id, db, options)
                : await ingestDataSourceAsService(kbId, { type: normalizedSourceType, id: body.sourceId }, user.id, db, options);

    try {
        await backfillVectorsAsService(kbId, user.id, db, 100);
    } catch {
    }

    return jsonOk({ success: true, ...ingestResult });
}
