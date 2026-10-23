import type { ScopedDb } from '@/lib/db/context.server';
import type { ChatMessage } from '@/types';

export type StoredConversationMessageRow = {
    sequence: number;
    message_id: string;
    role: ChatMessage['role'];
    content: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
};

type MessagePageOptions = {
    limit: number;
    offset: number;
};

type ConversationMessageSyncError = { message?: string; code?: string };

const CHAT_MESSAGE_ROLES: ReadonlySet<ChatMessage['role']> = new Set(['user', 'assistant', 'system']);
const MESSAGE_COLUMNS = ['sequence', 'message_id', 'role', 'content', 'metadata', 'created_at'] as const;

function toSyncError(error: unknown): ConversationMessageSyncError | null {
    if (!error) return null;
    const e = error as Record<string, unknown>;
    return {
        message: typeof e.message === 'string' ? e.message : undefined,
        code: typeof e.code === 'string' ? e.code : undefined,
    };
}

export function isConversationMessageInfraMissing(error: ConversationMessageSyncError | null | undefined) {
    const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    return text.includes('replace_conversation_messages')
        || text.includes('conversation_messages')
        || text.includes('does not exist')
        || text.includes('not found');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestampString(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && !Number.isNaN(Date.parse(value));
}

export function isValidChatMessagePayload(value: unknown): value is ChatMessage {
    if (!isPlainObject(value)) return false;
    if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
    if (!CHAT_MESSAGE_ROLES.has(value.role as ChatMessage['role'])) return false;
    if (typeof value.content !== 'string') return false;
    if (!isValidTimestampString(value.createdAt)) return false;
    return true;
}

function fromStoredConversationMessage(row: StoredConversationMessageRow): ChatMessage {
    return {
        id: row.message_id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        ...((row.metadata || {}) as Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>),
    };
}

export async function replaceConversationMessages(
    db: ScopedDb,
    conversationId: string,
    messages: ChatMessage[]
) : Promise<{ error: ConversationMessageSyncError | null }> {
    try {
        await db.rpc('replace_conversation_messages', {
            p_conversation_id: conversationId,
            p_messages: messages,
        });
        return { error: null };
    } catch (error) {
        return { error: toSyncError(error) };
    }
}

export async function loadAllConversationMessages(
    db: ScopedDb,
    conversationId: string,
) {
    try {
        const rows = await db.tx((trx) => trx
            .selectFrom('conversation_messages')
            .select([...MESSAGE_COLUMNS])
            .where('conversation_id', '=', conversationId)
            .orderBy('sequence', 'asc')
            .execute());

        return {
            messages: (rows as StoredConversationMessageRow[]).map(fromStoredConversationMessage),
            error: null,
        };
    } catch (error) {
        return {
            messages: [],
            error,
        };
    }
}

export async function loadConversationMessagePage(
    db: ScopedDb,
    conversationId: string,
    options: MessagePageOptions,
) {
    const { limit, offset } = options;
    try {
        const [rows, countRow] = await db.tx(async (trx) => Promise.all([
            trx
                .selectFrom('conversation_messages')
                .select([...MESSAGE_COLUMNS])
                .where('conversation_id', '=', conversationId)
                .orderBy('sequence', 'desc')
                .offset(offset)
                .limit(limit)
                .execute(),
            trx
                .selectFrom('conversation_messages')
                .select((eb) => eb.fn.countAll<number>().as('count'))
                .where('conversation_id', '=', conversationId)
                .executeTakeFirstOrThrow(),
        ]));

        const orderedMessages = (rows as StoredConversationMessageRow[])
            .map(fromStoredConversationMessage)
            .reverse();
        const total = countRow.count;

        return {
            messages: orderedMessages,
            total,
            hasMore: total > offset + orderedMessages.length,
            error: null,
        };
    } catch (error) {
        return {
            messages: [],
            total: 0,
            hasMore: false,
            error,
        };
    }
}

export async function loadConversationAnalysisMessage(
    db: ScopedDb,
    conversationId: string,
) {
    try {
        const row = await db.tx((trx) => trx
            .selectFrom('conversation_messages')
            .select([...MESSAGE_COLUMNS])
            .where('conversation_id', '=', conversationId)
            .where('role', '=', 'assistant')
            .orderBy('sequence', 'asc')
            .limit(1)
            .executeTakeFirst());

        return {
            message: row ? fromStoredConversationMessage(row as StoredConversationMessageRow) : null,
            error: null,
        };
    } catch (error) {
        return {
            message: null,
            error,
        };
    }
}
