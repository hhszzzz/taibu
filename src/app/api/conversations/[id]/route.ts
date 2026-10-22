import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { extractAnalysisFromConversation } from '@/lib/ai/ai-analysis-query';
import { isValidChatMessagePayload, loadAllConversationMessages, loadConversationAnalysisMessage, loadConversationMessagePage } from '@/lib/server/conversation-messages';
import { deleteConversationGraph } from '@/lib/chat/conversation-delete';
import { isValidUUID } from '@/lib/validation';
import type { ChatMessage } from '@/types';

type ConversationPatchBody = {
    title?: string | null;
    messages?: unknown[];
    personality?: string | null;
};

function hasOwn(body: object, key: string) {
    return Object.prototype.hasOwnProperty.call(body, key);
}

function isObjectBody(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
    return value === undefined || value === null || typeof value === 'string';
}

function normalizeConversationTitle(title: string | null | undefined): string | null | undefined {
    if (typeof title !== 'string') {
        return title;
    }
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : '';
}

type ConversationDetailRow = {
    id: string;
    user_id: string;
    personality?: string | null;
    title?: string | null;
    created_at?: string;
    updated_at?: string;
    source_type?: string | null;
    source_data?: unknown;
    is_archived?: boolean | null;
    archived_kb_ids?: unknown;
};

type ConversationAnalysisSnapshotRow = {
    id: string;
    user_id: string;
    source_data?: unknown;
};

function isNonErrorRow<T>(value: unknown): value is T {
    return !!value && typeof value === 'object' && !Array.isArray(value) && !('error' in value);
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { id } = await params;
    if (!isValidUUID(id)) {
        return jsonError('对话ID格式不合法', 400);
    }
    const db = auth.db;
    const { searchParams } = new URL(request.url);
    const includeContext = searchParams.get('includeContext') === '1';
    const snapshotMode = searchParams.get('snapshot');
    const messageLimit = Number(searchParams.get('messageLimit') || 0);
    const messageOffset = Math.max(Number(searchParams.get('messageOffset') || 0), 0);
    const data = await db.tx((trx) => trx
        .selectFrom('conversations_with_archive_status')
        .select(snapshotMode === 'analysis'
            ? ['id', 'user_id', 'source_data']
            : [
                'id',
                'user_id',
                'personality',
                'title',
                'created_at',
                'updated_at',
                'source_type',
                'source_data',
                'is_archived',
                'archived_kb_ids',
            ])
        .where('id', '=', id)
        .where('user_id', '=', auth.user.id)
        .executeTakeFirst()).catch((error) => {
        console.error('[conversations] failed to load conversation:', error);
        return null;
    });

    if (!data) {
        return jsonError('对话不存在', 404);
    }

    if (snapshotMode === 'analysis') {
        if (!isNonErrorRow<ConversationAnalysisSnapshotRow>(data)) {
            return jsonError('对话不存在', 404);
        }

        const sourceData = data.source_data as Record<string, unknown> | undefined;
        const analysisMessageResult = await loadConversationAnalysisMessage(db, id);
        if (analysisMessageResult.error) {
            console.error('[conversations] failed to load analysis snapshot:', analysisMessageResult.error);
            return jsonError('加载对话失败', 500);
        }

        const { analysis, reasoning, modelId } = extractAnalysisFromConversation(
            analysisMessageResult.message ? [analysisMessageResult.message] : [],
            sourceData,
        );

        return jsonOk({
            snapshot: {
                analysis,
                reasoning,
                modelId,
                reasoningEnabled: typeof sourceData?.reasoning === 'boolean' ? sourceData.reasoning : false,
            },
        });
    }

    if (!isNonErrorRow<ConversationDetailRow>(data)) {
        return jsonError('对话不存在', 404);
    }

    const conversationRow: ConversationDetailRow = data;

    const isPaginationRequested = Number.isFinite(messageLimit) && messageLimit > 0;
    const messageResult = isPaginationRequested
        ? await loadConversationMessagePage(db, id, {
            limit: messageLimit,
            offset: messageOffset,
        })
        : await loadAllConversationMessages(db, id);

    if (messageResult.error) {
        console.error('[conversations] failed to load conversation messages:', messageResult.error);
        return jsonError('加载对话失败', 500);
    }

    const conversation = {
        ...conversationRow,
        messages: messageResult.messages,
    };

    if (!includeContext) {
        return jsonOk({
            conversation,
            ...(isPaginationRequested ? {
                pagination: {
                    total: 'total' in messageResult ? messageResult.total : messageResult.messages.length,
                    hasMore: 'hasMore' in messageResult ? messageResult.hasMore : false,
                    offset: messageOffset,
                    limit: messageLimit,
                },
            } : {}),
        });
    }

    return jsonOk({
        conversation,
        context: {},
        ...(isPaginationRequested ? {
            pagination: {
                total: 'total' in messageResult ? messageResult.total : messageResult.messages.length,
                hasMore: 'hasMore' in messageResult ? messageResult.hasMore : false,
                offset: messageOffset,
                limit: messageLimit,
            },
        } : {}),
    });
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { id } = await params;
    if (!isValidUUID(id)) {
        return jsonError('对话ID格式不合法', 400);
    }
    const db = auth.db;
    let body: ConversationPatchBody;

    try {
        const parsed = await request.json();
        if (!isObjectBody(parsed)) {
            return jsonError('请求体必须是对象', 400);
        }
        body = parsed as ConversationPatchBody;
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    if (!isNullableString(body.title)) {
        return jsonError('title 必须是字符串或 null', 400);
    }
    if (!isNullableString(body.personality)) {
        return jsonError('personality 必须是字符串或 null', 400);
    }

    const normalizedTitle = normalizeConversationTitle(body.title);
    if (body.title !== undefined && normalizedTitle === '') {
        return jsonError('title 不能为空', 400);
    }

    const hasMessagesField = hasOwn(body as object, 'messages');
    let nextMessages: ChatMessage[] | null = null;
    if (hasMessagesField) {
        if (body.messages === null) {
            nextMessages = [];
        } else if (Array.isArray(body.messages)) {
            if (!body.messages.every(isValidChatMessagePayload)) {
                return jsonError('messages 包含非法消息项', 400);
            }
            nextMessages = body.messages as ChatMessage[];
        } else {
            return jsonError('messages 必须是数组或 null', 400);
        }
    }

    const data = await db.rpc('update_conversation_with_messages', {
        p_conversation_id: id,
        p_title: normalizedTitle ?? null,
        p_title_present: body.title !== undefined,
        p_personality: body.personality ?? null,
        p_personality_present: body.personality !== undefined,
        p_messages: nextMessages,
        p_messages_present: hasMessagesField,
    }).catch((error) => {
        console.error('[conversations] failed to update conversation transactionally:', error);
        return null;
    });

    const result = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
    if (result?.status === 'not_found') {
        return jsonError('对话不存在', 404);
    }
    if (result?.status !== 'ok') {
        console.error('[conversations] unexpected update rpc result:', result);
        return jsonError('更新对话失败', 500);
    }

    return jsonOk({ success: true, id });
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireUserContext(_request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { id } = await params;
    if (!isValidUUID(id)) {
        return jsonError('对话ID格式不合法', 400);
    }
    const result = await deleteConversationGraph(auth.db, id);
    if (result.error) {
        if (result.error.message.includes('AGENT_CONVERSATION_BUSY')) {
            return jsonError('请先停止当前 Agent 任务，再删除对话', 409, { code: 'CONVERSATION_BUSY' });
        }
        console.error('[conversations] failed to delete conversation:', result.error);
        return jsonError('删除对话失败', 500);
    }
    if (result.notFound) {
        return jsonError('对话不存在', 404);
    }

    return jsonOk({ success: true });
}
