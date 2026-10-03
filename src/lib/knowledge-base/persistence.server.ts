import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
    KnowledgeSearchPersistence,
    KnowledgeSearchRow,
    KnowledgeSourcePersistence,
} from '@/lib/knowledge-base/types';

type SearchRow = {
    id: string;
    kb_id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    rank?: number;
    similarity?: number;
    distance?: number;
};

function searchRows(data: unknown, score: 'rank' | 'similarity' | 'distance'): KnowledgeSearchRow[] {
    return ((data || []) as SearchRow[]).map(row => ({
        id: row.id,
        kbId: row.kb_id,
        content: row.content,
        metadata: row.metadata || {},
        // Zero distance is an exact match, not a missing score.
        rawScore: row[score] ?? (score === 'distance' ? 2 : 0),
    }));
}

/**
 * The caller owns the client identity; this adapter never upgrades credentials.
 * Service facades currently bind getSystemAdminClient(), not a service-role client.
 */
export function createKnowledgeBasePersistence(
    client: SupabaseClient,
): KnowledgeSourcePersistence & KnowledgeSearchPersistence {
    return {
        async replaceSourceEntries({ kbId, source, chunks, userId }) {
            const { data, error } = await client.rpc('kb_replace_source_entries', {
                p_kb_id: kbId,
                p_source_type: source.sourceType,
                p_source_id: source.sourceId,
                p_entries: chunks.map(chunk => ({
                    content: chunk.content,
                    chunk_index: chunk.chunkIndex,
                    metadata: chunk.metadata,
                })),
                p_archive: source.archive === true,
                p_user_id: userId || null,
            });
            if (error) throw error;
            return typeof data === 'number' ? data : null;
        },
        async searchFts(query, kbIds, limit, config) {
            const { data, error } = await client.rpc('search_knowledge_fts', {
                p_query: query,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_config: config,
            });
            if (error) throw error;
            return searchRows(data, 'rank');
        },
        async searchTrigram(query, kbIds, limit, threshold) {
            const { data, error } = await client.rpc('search_knowledge_trigram', {
                p_query: query,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_threshold: threshold,
            });
            if (error) throw error;
            return searchRows(data, 'similarity');
        },
        async searchVector(vector, kbIds, limit, dimension) {
            const { data, error } = await client.rpc('search_knowledge_vector', {
                p_query_vector: vector,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_dim: dimension,
            });
            if (error) throw error;
            return searchRows(data, 'distance');
        },
        async loadWeights(userId, kbIds) {
            const { data, error } = await client
                .from('knowledge_bases')
                .select('id, weight')
                .eq('user_id', userId)
                .in('id', kbIds);
            if (error) throw error;
            return (data || []) as Array<{ id: string; weight: string }>;
        },
    };
}
