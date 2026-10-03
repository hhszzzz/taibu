import type { ChatMessage } from '@/types';
import {
    MING_RECORD_SOURCE_TYPE,
    canonicalizeDataSourceType,
    type DataSourceType,
    type DataSourceTypeInput,
} from '@/lib/data-sources/types';
import { getProvider } from '@/lib/data-sources';
import { getSystemAdminClient } from '@/lib/api-utils';
import { generateEmbeddings } from '@/lib/knowledge-base/embedding-config';
import type {
    IngestResult, KnowledgeBaseWeight, KnowledgeSourcePersistence,
    KnowledgeSourceChunk as ChunkData,
    KnowledgeSourceWriteOptions as UpsertEntriesOptions,
} from '@/lib/knowledge-base/types';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { replaceKnowledgeSourceEntries } from '@/lib/knowledge-base/source-replacement';
import { createKbClient } from '@/lib/knowledge-base/client';
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

async function loadConversationMessagesFallback(
    supabase: ReturnType<typeof getSystemAdminClient>,
    conversationId: string,
    userId: string,
) {
    const { data: conversation } = await supabase
        .from('conversations')
        .select('id, user_id, messages')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!conversation) {
        throw new Error('Conversation not found');
    }

    return (conversation.messages as ChatMessage[]) || [];
}

export async function ingestConversation(
    kbId: string,
    conversationId: string,
    options?: IngestOptions
): Promise<IngestResult> {
    const supabase = await createKbClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: conversation } = await supabase
        .from('conversations')
        .select('id, user_id, messages')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!conversation) throw new Error('Conversation not found');

    const messagePairs = extractMessagePairs((conversation.messages as ChatMessage[]) || []);
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

    return await upsertEntries(kbId, chunks, {
        userId: user.id,
        source: {
            sourceType: 'conversation',
            sourceId: conversationId,
        },
    });
}

export async function ingestRecord(
    kbId: string,
    recordId: string,
    options?: IngestOptions
): Promise<IngestResult> {
    const supabase = await createKbClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: record } = await supabase
        .from('ming_records')
        .select('id, user_id, title, content, tags, category')
        .eq('id', recordId)
        .eq('user_id', user.id)
        .maybeSingle();

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

    return await upsertEntries(kbId, chunks, {
        userId: user.id,
        source: {
            sourceType: MING_RECORD_SOURCE_TYPE,
            sourceId: recordId,
        },
    });
}

export async function ingestFile(_kbId: string, _file: File, _options?: IngestOptions): Promise<IngestResult> {
    const supabase = await createKbClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const content = await _file.text();
    if (!content.trim()) {
        return { entriesCreated: 0, chunks: 0 };
    }

    const textChunks = chunkText(content, {
        ...DEFAULT_CHUNK_CONFIG,
        ...(_options?.chunkConfig || {})
    });

    const chunks: ChunkData[] = textChunks.map((c, i) => ({
        content: c,
        sourceType: 'file',
        sourceId: _file.name,
        chunkIndex: i,
        metadata: {
            file_name: _file.name,
            file_type: _file.type || null
        }
    }));

    return await upsertEntries(_kbId, chunks, {
        userId: user.id,
        source: {
            sourceType: 'file',
            sourceId: _file.name,
        },
    });
}

export async function ingestConversationAsService(
    kbId: string,
    conversationId: string,
    userId: string,
    options?: IngestOptions
): Promise<IngestResult> {
    const supabase = getSystemAdminClient();
    const { data: conversation } = await supabase
        .from('conversations')
        .select('id, user_id, messages')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!conversation) throw new Error('Conversation not found');

    const messagePairs = extractMessagePairs((conversation.messages as ChatMessage[]) || []);
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

    return await upsertEntriesAsService(kbId, chunks, {
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
    options?: IngestOptions
): Promise<IngestResult> {
    const supabase = getSystemAdminClient();
    const { data: conversation } = await supabase
        .from('conversations')
        .select('id, user_id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!conversation) throw new Error('Conversation not found');
    let target: ChatMessage | null = null;
    let previousUser: ChatMessage | null = null;

    const targetMessageResult = await supabase
        .from('conversation_messages')
        .select('sequence, message_id, role, content, metadata, created_at')
        .eq('conversation_id', conversationId)
        .eq('message_id', messageId)
        .maybeSingle();

    if (!targetMessageResult.error && targetMessageResult.data) {
        const targetRow = targetMessageResult.data as StoredConversationMessageRow;
        target = {
            id: targetRow.message_id,
            role: targetRow.role,
            content: targetRow.content,
            createdAt: targetRow.created_at,
            ...((targetRow.metadata || {}) as Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>),
        };

        const previousUserResult = await supabase
            .from('conversation_messages')
            .select('sequence, message_id, role, content, metadata, created_at')
            .eq('conversation_id', conversationId)
            .eq('role', 'user')
            .lt('sequence', targetRow.sequence)
            .order('sequence', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (previousUserResult.error && !isConversationMessageInfraMissing(previousUserResult.error)) {
            throw previousUserResult.error;
        }

        if (previousUserResult.data) {
            const previousUserRow = previousUserResult.data as StoredConversationMessageRow;
            previousUser = {
                id: previousUserRow.message_id,
                role: previousUserRow.role,
                content: previousUserRow.content,
                createdAt: previousUserRow.created_at,
                ...((previousUserRow.metadata || {}) as Omit<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>),
            };
        }
    } else if (targetMessageResult.error && !isConversationMessageInfraMissing(targetMessageResult.error)) {
        throw targetMessageResult.error;
    }

    if (!target) {
        const messages = await loadConversationMessagesFallback(supabase, conversationId, userId);
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

    return await upsertEntriesAsService(kbId, chunks, {
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
    options?: IngestOptions
): Promise<IngestResult> {
    const supabase = getSystemAdminClient();
    const { data: record } = await supabase
        .from('ming_records')
        .select('id, user_id, title, content, tags, category')
        .eq('id', recordId)
        .eq('user_id', userId)
        .maybeSingle();

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

    return await upsertEntriesAsService(kbId, chunks, {
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

    return await upsertEntriesAsService(kbId, chunks, {
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
    options?: IngestOptions
): Promise<IngestResult> {
    const provider = await getProvider(ref.type);
    const data = await provider.get(ref.id, userId);
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

    return await upsertEntriesAsService(kbId, chunks, {
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
    options?: Omit<UpsertEntriesOptions, 'userId'> & { userId?: string },
): Promise<IngestResult> {
    const supabase = await createKbClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return replaceKnowledgeSourceEntries(createKnowledgeBasePersistence(supabase), kbId, chunks, {
        ...options,
        userId: user.id,
    });
}

export async function upsertEntriesAsService(
    kbId: string,
    chunks: ChunkData[],
    options?: UpsertEntriesOptions & Pick<IngestOptions, 'persistence'>,
): Promise<IngestResult> {
    const persistence = options?.persistence ?? createKnowledgeBasePersistence(getSystemAdminClient());
    return replaceKnowledgeSourceEntries(persistence, kbId, chunks, options);
}

export async function backfillVectors(
    kbId: string,
    batchSize: number = 100
): Promise<VectorBackfillResult> {
    const supabase = await createKbClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: entries } = await supabase
        .from('knowledge_entries')
        .select('id, content')
        .eq('kb_id', kbId)
        .is('content_vector', null)
        .limit(batchSize);

    if (!entries?.length) {
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

    const { data, error } = await supabase.rpc('batch_update_vectors', {
        p_updates: updates,
        p_expected_dim: dimension,
        p_force_overwrite: false
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

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
    batchSize: number = 100
): Promise<VectorBackfillResult> {
    const supabase = getSystemAdminClient();

    const { data: kb } = await supabase
        .from('knowledge_bases')
        .select('id, user_id')
        .eq('id', kbId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!kb) throw new Error('Knowledge base not found');

    const { data: entries } = await supabase
        .from('knowledge_entries')
        .select('id, content')
        .eq('kb_id', kbId)
        .is('content_vector', null)
        .limit(batchSize);

    if (!entries?.length) {
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

    const { data, error } = await supabase.rpc('batch_update_vectors_as_service', {
        p_updates: updates,
        p_expected_dim: dimension,
        p_force_overwrite: false,
        p_user_id: userId
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    return {
        entriesCreated: 0,
        chunks: 0,
        processed: row?.updated_count ?? 0,
        skipped: row?.skipped_count ?? 0,
        alreadyExists: row?.already_exists_count ?? 0
    };
}
