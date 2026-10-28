import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { jsonFieldText } from '@/lib/db/sql-helpers';
import { isValidChatMessagePayload } from '@/lib/server/conversation-messages';
import type { ChatMessage } from '@/types';

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

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 100);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const sourceType = searchParams.get('sourceType');
    const chartId = searchParams.get('chartId');
    // 会话类别：agent = 跑过 Agent 任务的会话，plain = 普通对话；缺省不过滤。
    const mode = searchParams.get('mode');
    if (mode !== null && mode !== 'agent' && mode !== 'plain') {
        return jsonError('mode 必须是 agent 或 plain', 400);
    }

    const rows = await auth.db.tx(async (trx) => {
        let query = trx
            .selectFrom('conversations_with_archive_status')
            .select([
                'id',
                'user_id',
                'personality',
                'title',
                'created_at',
                'updated_at',
                'source_type',
                'is_archived',
                'archived_kb_ids',
                'has_agent_run',
                'is_scheduled',
            ])
            .select(jsonFieldText('source_data', 'question').as('question_preview'))
            .where('user_id', '=', auth.user.id)
            .orderBy('updated_at', 'desc');

        if (mode) {
            query = query.where('has_agent_run', '=', mode === 'agent');
        }
        if (!includeArchived) {
            query = query.where('is_archived', '=', false);
        }
        if (sourceType) {
            query = query.where('source_type', '=', sourceType);
        }
        if (chartId) {
            query = query.where(jsonFieldText('source_data', 'chart_id'), '=', chartId);
        }

        return await query.offset(offset).limit(limit + 1).execute();
    }).catch((error) => {
        console.error('[conversations] failed to load list:', error);
        return null;
    });

    if (rows === null) return jsonError('加载对话列表失败', 500);

    const hasMore = rows.length > limit;
    const conversations = hasMore ? rows.slice(0, limit) : rows;

    return jsonOk({
        conversations,
        pagination: {
            hasMore,
            nextOffset: hasMore ? offset + limit : null,
        },
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);

    let body: {
        personality?: string;
        title?: string;
        messages?: unknown[] | null;
    };

    try {
        const parsed = await request.json();
        if (!isObjectBody(parsed)) {
            return jsonError('请求体必须是对象', 400);
        }
        body = parsed as typeof body;
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

    let initialMessages: ChatMessage[] = [];
    if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
        if (body.messages === null) {
            initialMessages = [];
        } else if (Array.isArray(body.messages)) {
            if (!body.messages.every(isValidChatMessagePayload)) {
                return jsonError('messages 包含非法消息项', 400);
            }
            initialMessages = body.messages as ChatMessage[];
        } else {
            return jsonError('messages 必须是数组或 null', 400);
        }
    }

    const data = await auth.db.rpc('create_conversation_with_messages', {
        p_user_id: auth.user.id,
        p_title: normalizedTitle || '新对话',
        p_personality: body.personality || 'general',
        p_source_type: null,
        p_source_data: null,
        p_messages: initialMessages,
    }).catch((error) => {
        console.error('[conversations] failed to create conversation transactionally:', error);
        return null;
    });

    if (typeof data !== 'string') {
        return jsonError('创建对话失败', 500);
    }

    return jsonOk({ id: data }, 201);
}
