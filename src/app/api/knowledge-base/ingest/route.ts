
import { NextRequest } from 'next/server';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
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
import { triggerVectorIndexCreation } from '@/lib/knowledge-base/vector-index';
import { requireUserContext, jsonError, jsonOk, resolveRequestDbClient } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { user } = auth;
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('知识库不存在或无权限', 500);

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

    const normalizedSourceType = body.sourceType === 'conversation' || body.sourceType === 'chat_message'
        ? body.sourceType
        : normalizeKnowledgeBaseSourceType(body.sourceType);

    const { data: kb } = await db
        .from('knowledge_bases')
        .select('id, user_id')
        .eq('id', body.kbId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!kb) return jsonError('知识库不存在或无权限', 403);

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

    const options = { persistence: createKnowledgeBasePersistence(db) };
    const ingestResult = normalizedSourceType === 'conversation'
        ? await ingestConversationAsService(body.kbId, body.sourceId, user.id, options)
        : normalizedSourceType === MING_RECORD_SOURCE_TYPE
            ? await ingestRecordAsService(body.kbId, body.sourceId, user.id, options)
            : normalizedSourceType === 'chat_message'
                ? await ingestChatMessageAsService(body.kbId, body.sourceMeta?.conversationId || '', body.sourceId, user.id, options)
                : await ingestDataSourceAsService(body.kbId, { type: normalizedSourceType, id: body.sourceId }, user.id, options);

    if (membership === 'pro') {
        try {
            await backfillVectorsAsService(body.kbId, user.id, 100);
            await triggerVectorIndexCreation();
        } catch {
        }
    }

    return jsonOk({ success: true, ...ingestResult });
}
