import type { ChatMessage } from '@/types';
import {
    MING_RECORD_SOURCE_TYPE,
    canonicalizeDataSourceType,
    type DataSourceType,
    type DataSourceTypeInput,
} from '@/lib/data-sources/types';
import { getProvider } from '@/lib/data-sources';
import type { ScopedDb } from '@/lib/db/context.server';
import { generateEmbeddings } from '@/lib/knowledge-base/embedding-config';
import type {
    IngestResult, KnowledgeBaseWeight, KnowledgeSourcePersistence,
    KnowledgeSourceChunk as ChunkData,
    KnowledgeSourceWriteOptions as UpsertEntriesOptions,
} from '@/lib/knowledge-base/types';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { replaceKnowledgeSourceEntries } from '@/lib/knowledge-base/source-replacement';
import { isConversationMessageInfraMissing, type StoredConversationMessageRow } from '@/lib/server/conversation-messages';

interface ChunkConfig {
    maxChunkSize: number;
    overlapSize: number;
    separators: string[];
}

const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
    maxChunkSize: 500,
    overlapSize: 50,
    separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ']
};

export interface IngestOptions {
    chunkConfig?: Partial<ChunkConfig>;
    /** User-driven service facades receive the authenticated caller's atomic write port. */
    persistence?: KnowledgeSourcePersistence;
}

type KnowledgeBaseWriteMode = 'create' | 'update';

interface VectorBackfillResult extends IngestResult {
    processed?: number;
    skipped?: number;
    alreadyExists?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

export function normalizeKnowledgeBaseInput(
    input: unknown,
    mode: KnowledgeBaseWriteMode,
): { data: { name?: string; description?: string | null; weight?: KnowledgeBaseWeight } } | { error: string } {
    if (!isPlainObject(input)) {
        return { error: '请求体不是合法对象' };
    }

    const data: { name?: string; description?: string | null; weight?: KnowledgeBaseWeight } = {};

    if (mode === 'create' || hasOwn(input, 'name')) {
        if (typeof input.name !== 'string' || !input.name.trim()) {
            return { error: 'name 不能为空' };
        }
        data.name = input.name.trim();
    }

    if (mode === 'create' || hasOwn(input, 'description')) {
        if (input.description == null || input.description === '') {
            data.description = null;
        } else if (typeof input.description === 'string') {
            data.description = input.description.trim();
        } else {
            return { error: 'description 无效' };
        }
    }

    if (mode === 'create' || hasOwn(input, 'weight')) {
        if (input.weight == null || input.weight === '') {
            data.weight = 'normal';
        } else if (input.weight === 'low' || input.weight === 'normal' || input.weight === 'high') {
            data.weight = input.weight;
        } else {
            return { error: 'weight 无效' };
        }
    }

    if (mode === 'update' && Object.keys(data).length === 0) {
        return { error: '没有可更新的知识库字段' };
    }

    return { data };
}

export function normalizeKnowledgeBaseSourceType(sourceType: DataSourceTypeInput): DataSourceType {
    return canonicalizeDataSourceType(sourceType);
}

function requireScopedUserId(db: ScopedDb): string {
    if (db.scope.kind !== 'user') throw new Error('Not authenticated');
    return db.scope.userId;
}

function isInfraMissing(error: unknown): boolean {
    return isConversationMessageInfraMissing(error as Parameters<typeof isConversationMessageInfraMissing>[0]);
}

async function loadConversationMessagesFallback(
    db: ScopedDb,
    conversationId: string,
    userId: string,
) {
    const conversation = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['id', 'user_id', 'messages'])
        .where('id', '=', conversationId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!conversation) {
        throw new Error('Conversation not found');
    }

    return (conversation.messages as unknown as ChatMessage[]) || [];
}
export async function ingestConversation(
    kbId: string,
    conversationId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const userId = requireScopedUserId(db);

    const conversation = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['id', 'user_id', 'messages'])
        .where('id', '=', conversationId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!conversation) throw new Error('Conversation not found');

    const messagePairs = extractMessagePairs((conversation.messages as unknown as ChatMessage[]) || []);
    const chunks: ChunkData[] = [];

    for (const pair of messagePairs) {
        const content = formatMessagePair(pair);
        const pairChunks = chunkText(content, {
            ...DEFAULT_CHUNK_CONFIG,
            ...(options?.chunkConfig || {})
        });
        const baseIndex = chunks.length;
        chunks.push(...pairChunks.map((c, i) => ({
            content: c,
            sourceType: 'conversation' as const,
            sourceId: conversationId,
            chunkIndex: baseIndex + i,
            metadata: {
                message_ids: [pair.user.id, pair.assistant.id]
            }
        })));
    }

    return await upsertEntries(kbId, chunks, db, {
        source: {
            sourceType: 'conversation',
            sourceId: conversationId,
        },
    });
}
export async function ingestRecord(
    kbId: string,
    recordId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const userId = requireScopedUserId(db);

    const record = await db.tx((trx) => trx
        .selectFrom('ming_records')
        .select(['id', 'user_id', 'title', 'content', 'tags', 'category'])
        .where('id', '=', recordId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!record) throw new Error('Record not found');

    const content = [
        `## ${record.title}`,
        record.content,
        Array.isArray(record.tags) && record.tags.length ? `标签：${record.tags.join(', ')}` : ''
    ].filter(Boolean).join('\n\n');

    const textChunks = chunkText(content, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: MING_RECORD_SOURCE_TYPE,
        sourceId: recordId,
        chunkIndex: i,
        metadata: {
            category: record.category,
            tags: record.tags
        }
    }));

    return await upsertEntries(kbId, chunks, db, {
        source: {
            sourceType: MING_RECORD_SOURCE_TYPE,
            sourceId: recordId,
        },
    });
}
export async function ingestFile(kbId: string, file: File, db: ScopedDb, options?: IngestOptions): Promise<IngestResult> {
    requireScopedUserId(db);

    const content = await file.text();
    if (!content.trim()) {
        return { entriesCreated: 0, chunks: 0 };
    }

    const textChunks = chunkText(content, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: 'file',
        sourceId: file.name,
        chunkIndex: i,
        metadata: {
            file_name: file.name,
            file_type: file.type || null
        }
    }));

    return await upsertEntries(kbId, chunks, db, {
        source: {
            sourceType: 'file',
            sourceId: file.name,
        },
    });
}
export async function ingestConversationAsService(
    kbId: string,
    conversationId: string,
    userId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const conversation = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['id', 'user_id', 'messages'])
        .where('id', '=', conversationId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!conversation) throw new Error('Conversation not found');

    const messagePairs = extractMessagePairs((conversation.messages as unknown as ChatMessage[]) || []);
    const chunks: ChunkData[] = [];

    for (const pair of messagePairs) {
        const content = formatMessagePair(pair);
        const pairChunks = chunkText(content, {
            ...DEFAULT_CHUNK_CONFIG,
            ...(options?.chunkConfig || {})
        });
        const baseIndex = chunks.length;
        chunks.push(...pairChunks.map((c, i) => ({
            content: c,
            sourceType: 'conversation' as const,
            sourceId: conversationId,
            chunkIndex: baseIndex + i,
            metadata: {
                message_ids: [pair.user.id, pair.assistant.id]
            }
        })));
    }

    return await upsertEntriesAsService(kbId, chunks, db, {
        persistence: options?.persistence,
        userId,
        source: {
            sourceType: 'conversation',
            sourceId: conversationId,
            archive: true,
        },
    });
}
export async function ingestChatMessageAsService(
    kbId: string,
    conversationId: string,
    messageId: string,
    userId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const conversation = await db.tx((trx) => trx
        .selectFrom('conversations')
        .select(['id', 'user_id'])
        .where('id', '=', conversationId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!conversation) throw new Error('Conversation not found');
    let target: ChatMessage | null = null;
    let previousUser: ChatMessage | null = null;

    let targetRow: StoredConversationMessageRow | null = null;
    try {
        targetRow = await db.tx((trx) => trx
            .selectFrom('conversation_messages')
            .select(['sequence', 'message_id', 'role', 'content', 'metadata', 'created_at'])
            .where('conversation_id', '=', conversationId)
            .where('message_id', '=', messageId)
            .executeTakeFirst()) as unknown as StoredConversationMessageRow | null;
    } catch (error) {
        if (!isInfraMissing(error)) throw error;
    }

    if (targetRow) {
        target = {
            id: targetRow.message_id,
            role: targetRow.role,
            content: targetRow.content,
            createdAt: targetRow.created_at,
            ...((targetRow.metadata || {}) as Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>),
        };

        let previousUserRow: StoredConversationMessageRow | null = null;
        try {
            previousUserRow = await db.tx((trx) => trx
                .selectFrom('conversation_messages')
                .select(['sequence', 'message_id', 'role', 'content', 'metadata', 'created_at'])
                .where('conversation_id', '=', conversationId)
                .where('role', '=', 'user')
                .where('sequence', '<', targetRow.sequence)
                .orderBy('sequence', 'desc')
                .limit(1)
                .executeTakeFirst()) as unknown as StoredConversationMessageRow | null;
        } catch (error) {
            if (!isInfraMissing(error)) throw error;
        }

        if (previousUserRow) {
            previousUser = {
                id: previousUserRow.message_id,
                role: previousUserRow.role,
                content: previousUserRow.content,
                createdAt: previousUserRow.created_at,
                ...((previousUserRow.metadata || {}) as Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>),
            };
        }
    }

    if (!target) {
        const messages = await loadConversationMessagesFallback(db, conversationId, userId);
        const index = messages.findIndex(m => m.id === messageId);
        if (index < 0) throw new Error('Message not found');

        target = messages[index];
        for (let i = index - 1; i >= 0; i--) {
            if (messages[i]?.role === 'user' && messages[i]?.content?.trim()) {
                previousUser = messages[i];
                break;
            }
        }
    }

    const chunks: ChunkData[] = !target.content?.trim()
        ? []
        : chunkText([
            previousUser ? `用户：${previousUser.content}` : '',
            `${target.role === 'assistant' ? 'AI' : '用户'}：${target.content}`
        ].filter(Boolean).join('\n\n'), {
            ...DEFAULT_CHUNK_CONFIG,
            ...(options?.chunkConfig || {})
        }).map((c, i) => ({
            content: c,
            sourceType: 'chat_message',
            sourceId: messageId,
            chunkIndex: i,
            metadata: {
                conversation_id: conversationId,
                message_id: messageId,
                user_message_id: previousUser?.id || null,
                role: target.role
            }
        }));

    return await upsertEntriesAsService(kbId, chunks, db, {
        persistence: options?.persistence,
        userId,
        source: {
            sourceType: 'chat_message',
            sourceId: messageId,
            archive: true,
        },
    });
}
export async function ingestRecordAsService(
    kbId: string,
    recordId: string,
    userId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const record = await db.tx((trx) => trx
        .selectFrom('ming_records')
        .select(['id', 'user_id', 'title', 'content', 'tags', 'category'])
        .where('id', '=', recordId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!record) throw new Error('Record not found');

    const content = [
        `## ${record.title}`,
        record.content,
        Array.isArray(record.tags) && record.tags.length ? `标签：${record.tags.join(', ')}` : ''
    ].filter(Boolean).join('\n\n');

    const textChunks = chunkText(content, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: MING_RECORD_SOURCE_TYPE,
        sourceId: recordId,
        chunkIndex: i,
        metadata: {
            category: record.category,
            tags: record.tags
        }
    }));

    return await upsertEntriesAsService(kbId, chunks, db, {
        persistence: options?.persistence,
        userId,
        source: {
            sourceType: MING_RECORD_SOURCE_TYPE,
            sourceId: recordId,
            archive: true,
        },
    });
}
export async function ingestFileAsService(
    kbId: string,
    file: { name: string; type: string | null; content: string },
    userId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const text = file.content || '';
    if (!text.trim()) {
        return { entriesCreated: 0, chunks: 0 };
    }

    const textChunks = chunkText(text, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: 'file',
        sourceId: file.name,
        chunkIndex: i,
        metadata: {
            file_name: file.name,
            file_type: file.type || null
        }
    }));

    return await upsertEntriesAsService(kbId, chunks, db, {
        persistence: options?.persistence,
        userId,
        source: {
            sourceType: 'file',
            sourceId: file.name,
        },
    });
}
export async function ingestDataSourceAsService(
    kbId: string,
    ref: { type: DataSourceType; id: string },
    userId: string,
    db: ScopedDb,
    options?: IngestOptions
): Promise<IngestResult> {
    const provider = await getProvider(ref.type);
    const data = await provider.get(ref.id, userId, { db });
    if (!data) throw new Error('Data source not found');

    const content = await provider.formatForAI(data);
    const textChunks = chunkText(content, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: ref.type,
        sourceId: ref.id,
        chunkIndex: i,
        metadata: {}
    }));

    return await upsertEntriesAsService(kbId, chunks, db, {
        persistence: options?.persistence,
        userId,
        source: {
            sourceType: ref.type,
            sourceId: ref.id,
            archive: true,
        },
    });
}
export function chunkText(text: string, config: ChunkConfig = DEFAULT_CHUNK_CONFIG): string[] {
    const { maxChunkSize, overlapSize, separators } = config;

    if (text.length <= maxChunkSize) {
        return [text];
    }

    for (const sep of separators) {
        const parts = text.split(sep);
        if (parts.length > 1) {
            const chunks: string[] = [];
            let current = '';

            for (const part of parts) {
                const candidate = current ? `${current}${sep}${part}` : part;
                if (candidate.length <= maxChunkSize) {
                    current = candidate;
                } else {
                    if (current) chunks.push(current);
                    current = part;
                }
            }

            if (current) chunks.push(current);
            return addOverlap(chunks, overlapSize);
        }
    }

    return forceChunk(text, maxChunkSize, overlapSize);
}

function addOverlap(chunks: string[], overlapSize: number): string[] {
    if (overlapSize <= 0) return chunks;
    const result: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const current = chunks[i] || '';
        if (i === 0) {
            result.push(current);
            continue;
        }

        const prev = chunks[i - 1] || '';
        const overlap = prev.slice(Math.max(0, prev.length - overlapSize));
        result.push(`${overlap}${current}`);
    }

    return result;
}

function forceChunk(text: string, maxChunkSize: number, overlapSize: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + maxChunkSize, text.length);
        chunks.push(text.slice(start, end));
        if (end >= text.length) break;
        start = Math.max(0, end - overlapSize);
    }

    return chunks;
}

function extractMessagePairs(messages: ChatMessage[]): Array<{ user: ChatMessage; assistant: ChatMessage }> {
    const pairs: Array<{ user: ChatMessage; assistant: ChatMessage }> = [];
    for (let i = 0; i < messages.length - 1; i++) {
        const current = messages[i];
        const next = messages[i + 1];
        if (current.role === 'user' && next.role === 'assistant') {
            if (current.content?.trim() && next.content?.trim()) {
                pairs.push({ user: current, assistant: next });
            }
        }
    }
    return pairs;
}

function formatMessagePair(pair: { user: ChatMessage; assistant: ChatMessage }): string {
    return [`用户：${pair.user.content}`, `AI：${pair.assistant.content}`].join('\n\n');
}

export async function upsertEntries(
    kbId: string,
    chunks: ChunkData[],
    db: ScopedDb,
    options?: Omit<UpsertEntriesOptions, 'userId'> & { userId?: string },
): Promise<IngestResult> {
    const userId = requireScopedUserId(db);
    return replaceKnowledgeSourceEntries(createKnowledgeBasePersistence(db), kbId, chunks, {
        ...options,
        userId,
    });
}
export async function upsertEntriesAsService(
    kbId: string,
    chunks: ChunkData[],
    db: ScopedDb,
    options?: UpsertEntriesOptions & Pick<IngestOptions, 'persistence'>,
): Promise<IngestResult> {
    return replaceKnowledgeSourceEntries(createKnowledgeBasePersistence(db), kbId, chunks, options);
}
export async function backfillVectors(
    kbId: string,
    db: ScopedDb,
    batchSize: number = 100
): Promise<VectorBackfillResult> {
    requireScopedUserId(db);

    const entries = await db.tx((trx) => trx
        .selectFrom('knowledge_entries')
        .select(['id', 'content'])
        .where('kb_id', '=', kbId)
        .where('content_vector', 'is', null)
        .limit(batchSize)
        .execute());

    if (!entries.length) {
        return { entriesCreated: 0, chunks: 0, processed: 0, skipped: 0, alreadyExists: 0 };
    }

    const embeddingResult = await generateEmbeddings(entries.map(e => e.content as string));
    const { vectors, model, dimension } = embeddingResult;

    const updates = entries
        .map((entry, i) => ({
            id: entry.id as string,
            content_vector: vectors[i],
            metadata: {
                embedding_model: model,
                embedding_dim: dimension
            }
        }))
        .filter(u => Array.isArray(u.content_vector) && u.content_vector.length === dimension);

    if (updates.length === 0) {
        return { entriesCreated: 0, chunks: 0, processed: 0, skipped: entries.length, alreadyExists: 0 };
    }

    const data = await db.rpc('batch_update_vectors', {
        p_updates: updates,
        p_expected_dim: dimension,
        p_force_overwrite: false
    });

    const row = (Array.isArray(data) ? data[0] : data) as {
        updated_count?: number; skipped_count?: number; already_exists_count?: number;
    } | null;

    return {
        entriesCreated: 0,
        chunks: 0,
        processed: row?.updated_count ?? 0,
        skipped: row?.skipped_count ?? 0,
        alreadyExists: row?.already_exists_count ?? 0
    };
}
export async function backfillVectorsAsService(
    kbId: string,
    userId: string,
    db: ScopedDb,
    batchSize: number = 100
): Promise<VectorBackfillResult> {
    const kb = await db.tx((trx) => trx
        .selectFrom('knowledge_bases')
        .select(['id', 'user_id'])
        .where('id', '=', kbId)
        .where('user_id', '=', userId)
        .executeTakeFirst());

    if (!kb) throw new Error('Knowledge base not found');

    const entries = await db.tx((trx) => trx
        .selectFrom('knowledge_entries')
        .select(['id', 'content'])
        .where('kb_id', '=', kbId)
        .where('content_vector', 'is', null)
        .limit(batchSize)
        .execute());

    if (!entries.length) {
        return { entriesCreated: 0, chunks: 0, processed: 0, skipped: 0, alreadyExists: 0 };
    }

    const embeddingResult = await generateEmbeddings(entries.map(e => e.content as string));
    const { vectors, model, dimension } = embeddingResult;

    const updates = entries
        .map((entry, i) => ({
            id: entry.id as string,
            content_vector: vectors[i],
            metadata: {
                embedding_model: model,
                embedding_dim: dimension
            }
        }))
        .filter(u => Array.isArray(u.content_vector) && u.content_vector.length === dimension);

    if (updates.length === 0) {
        return { entriesCreated: 0, chunks: 0, processed: 0, skipped: entries.length, alreadyExists: 0 };
    }

    const data = await db.rpc('batch_update_vectors_as_service', {
        p_updates: updates,
        p_expected_dim: dimension,
        p_force_overwrite: false,
        p_user_id: userId
    });

    const row = (Array.isArray(data) ? data[0] : data) as {
        updated_count?: number; skipped_count?: number; already_exists_count?: number;
    } | null;

    return {
        entriesCreated: 0,
        chunks: 0,
        processed: row?.updated_count ?? 0,
        skipped: row?.skipped_count ?? 0,
        alreadyExists: row?.already_exists_count ?? 0
    };
}
