/**
 * 对话历史访问层
 *
 * 浏览器侧只调用 Conversations HTTP API，不再直接查库。
 */

import { hydrateConversationMessages } from '@/lib/ai/ai-analysis-query';
import {
    fetchBrowserJson,
    requestBrowserData,
    requestBrowserPayloadOrThrow,
} from '@/lib/browser-api';
import { normalizeConversationSourceType } from '@/lib/source-contracts';
import type { AIPersonality, ChatMessage, Conversation, ConversationListItem } from '@/types';

interface PaginatedConversations {
    conversations: ConversationListItem[];
    pagination: {
        hasMore: boolean;
        nextOffset: number | null;
    };
}

type ConversationDetailApiRow = {
    id: string;
    user_id: string;
    personality?: string | null;
    title?: string | null;
    messages?: ChatMessage[] | null;
    created_at: string;
    updated_at: string;
    source_type?: string | null;
    source_data?: Record<string, unknown> | null;
    is_archived?: boolean | null;
    archived_kb_ids?: string[] | null;
};

type ConversationListApiRow = {
    id: string;
    user_id: string;
    personality?: string | null;
    title?: string | null;
    created_at: string;
    updated_at: string;
    source_type?: string | null;
    question_preview?: string | null;
    is_archived?: boolean | null;
    archived_kb_ids?: string[] | null;
    has_agent_run?: boolean | null;
};

type ConversationLoadResult =
    | { ok: true; conversation: Conversation }
    | { ok: false; notFound: true }
    | { ok: false; notFound: false; error: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const CONVERSATION_PAGE_SIZE = 7;
const CONVERSATION_MAX_PAGES = 50;
export const DEFAULT_CONVERSATION_TITLE = '新对话';

const AI_PERSONALITY_VALUES: ReadonlySet<string> = new Set<AIPersonality>([
    'bazi', 'ziwei', 'dream', 'mangpai', 'tarot', 'liuyao',
    'mbti', 'hepan', 'qimen', 'daliuren', 'general',
    'meihua', 'xiaoliuren',
]);

const normalizePersonality = (value?: string | null): AIPersonality => {
    if (value && AI_PERSONALITY_VALUES.has(value)) {
        return value as AIPersonality;
    }
    return 'general';
};

function getErrorMessage(error: unknown, fallbackMessage: string): string {
    return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function toConversation(row: ConversationDetailApiRow): Conversation {
    return {
        id: row.id,
        userId: row.user_id,
        personality: normalizePersonality(row.personality),
        title: row.title || DEFAULT_CONVERSATION_TITLE,
        messages: hydrateConversationMessages(row.messages || [], row.source_data || undefined),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sourceType: normalizeConversationSourceType(row.source_type),
        sourceData: row.source_data || undefined,
        isArchived: row.is_archived ?? false,
        archivedKbIds: row.archived_kb_ids ?? [],
    };
}

function toConversationListItem(row: ConversationListApiRow): ConversationListItem {
    return {
        id: row.id,
        userId: row.user_id,
        personality: normalizePersonality(row.personality),
        title: row.title || DEFAULT_CONVERSATION_TITLE,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sourceType: normalizeConversationSourceType(row.source_type),
        questionPreview: typeof row.question_preview === 'string' ? row.question_preview : null,
        isArchived: row.is_archived ?? false,
        archivedKbIds: row.archived_kb_ids ?? [],
        hasAgentRun: row.has_agent_run === true,
    };
}

export async function createConversation(params: {
    personality?: AIPersonality;
    title?: string;
}): Promise<string | null> {
    try {
        const result = await requestBrowserPayloadOrThrow<{ id?: string | null }>(
            '/api/conversations',
            {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    personality: params.personality || 'general',
                    title: params.title || DEFAULT_CONVERSATION_TITLE,
                    messages: [],
                }),
            },
            '创建对话失败',
        );

        return result.data?.id || null;
    } catch (error) {
        console.error('[conversation] 创建对话失败:', getErrorMessage(error, '创建对话失败'));
        return null;
    }
}

export async function loadConversations(
    options: {
        limit?: number;
        offset?: number;
        signal?: AbortSignal;
    } = {},
): Promise<PaginatedConversations> {
    const { limit = CONVERSATION_PAGE_SIZE, offset = 0, signal } = options;
    const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
    });

    const payload = await requestBrowserData<{
        conversations?: ConversationListApiRow[];
        pagination?: { hasMore?: boolean; nextOffset?: number | null };
    }>(`/api/conversations?${params.toString()}`, {
        signal,
    }, {
        fallbackMessage: '加载对话列表失败',
    });

    return {
        conversations: (payload?.conversations || []).map(toConversationListItem),
        pagination: {
            hasMore: payload?.pagination?.hasMore === true,
            nextOffset: payload?.pagination?.nextOffset ?? null,
        },
    };
}

export async function loadConversationWindow(
    options: {
        targetCount: number;
        preserveIds?: string[];
        pageSize?: number;
        signal?: AbortSignal;
    }
): Promise<PaginatedConversations> {
    const { targetCount, preserveIds = [], pageSize = CONVERSATION_PAGE_SIZE, signal } = options;
    const minimumCount = Math.max(targetCount, 1);
    const remainingIds = new Set(preserveIds);
    const rows: ConversationListItem[] = [];
    let offset = 0;
    let hasMore = false;
    let nextOffset: number | null = null;

    for (let page = 0; page < CONVERSATION_MAX_PAGES; page += 1) {
        const remainingTargetCount = Math.max(minimumCount - rows.length, 0);
        const payload = await loadConversations({
            limit: remainingIds.size > 0
                ? pageSize
                : Math.min(pageSize, Math.max(remainingTargetCount, 1)),
            offset,
            signal,
        });

        rows.push(...payload.conversations);
        payload.conversations.forEach((conversation) => {
            remainingIds.delete(conversation.id);
        });
        hasMore = payload.pagination.hasMore;
        nextOffset = payload.pagination.nextOffset;

        if (
            payload.conversations.length === 0
            || (rows.length >= minimumCount && remainingIds.size === 0)
            || !hasMore
            || nextOffset == null
        ) {
            break;
        }

        offset = nextOffset;
    }

    return {
        conversations: rows,
        pagination: {
            hasMore,
            nextOffset,
        },
    };
}

export async function loadConversation(conversationId: string): Promise<ConversationLoadResult> {
    const { ok, status, result } = await fetchBrowserJson<{
        conversation?: ConversationDetailApiRow | null;
    }>(`/api/conversations/${conversationId}`);

    if (status === 404) {
        return { ok: false, notFound: true };
    }

    if (!ok || result.error) {
        const errorMessage = result.error?.message || '加载对话失败';
        console.error('[conversation] 加载对话失败:', errorMessage);
        return {
            ok: false,
            notFound: false,
            error: errorMessage,
        };
    }

    if (!result.data?.conversation) {
        return { ok: false, notFound: true };
    }

    return {
        ok: true,
        conversation: toConversation(result.data.conversation),
    };
}

/** 每个对话最近一次排队的保存；PATCH 是整份消息覆盖写。 */
const pendingConversationSaves = new Map<string, Promise<boolean>>();

/**
 * 同一对话的保存按发起顺序串行：并发的整份覆盖写可能后发先至，
 * 例如快速连点「上一版本」后刷新，会回到较早点击的那个分支。
 */
export function saveConversation(
    conversationId: string,
    messages: ChatMessage[],
    title?: string
): Promise<boolean> {
    const previous = pendingConversationSaves.get(conversationId) ?? Promise.resolve(true);
    const current = previous.then(() => writeConversation(conversationId, messages, title));
    pendingConversationSaves.set(conversationId, current);
    void current.then(() => {
        if (pendingConversationSaves.get(conversationId) === current) pendingConversationSaves.delete(conversationId);
    });
    return current;
}

async function writeConversation(
    conversationId: string,
    messages: ChatMessage[],
    title?: string
): Promise<boolean> {
    try {
        await requestBrowserPayloadOrThrow(
            `/api/conversations/${conversationId}`,
            {
                method: 'PATCH',
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    messages,
                    ...(title ? { title } : {}),
                }),
            },
            '保存对话失败',
        );
        return true;
    } catch (error) {
        console.error('[conversation] 保存对话失败:', getErrorMessage(error, '保存对话失败'));
        return false;
    }
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
    try {
        await requestBrowserPayloadOrThrow(
            `/api/conversations/${conversationId}`,
            {
                method: 'DELETE',
            },
            '删除对话失败',
        );
        return true;
    } catch (error) {
        console.error('[conversation] 删除对话失败:', getErrorMessage(error, '删除对话失败'));
        return false;
    }
}

export async function renameConversation(
    conversationId: string,
    title: string
): Promise<boolean> {
    try {
        await requestBrowserPayloadOrThrow(
            `/api/conversations/${conversationId}`,
            {
                method: 'PATCH',
                headers: JSON_HEADERS,
                body: JSON.stringify({ title }),
            },
            '重命名对话失败',
        );
        return true;
    } catch (error) {
        console.error('[conversation] 重命名对话失败:', getErrorMessage(error, '重命名对话失败'));
        return false;
    }
}
