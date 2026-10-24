import 'server-only';

import type { ScopedDb } from '@/lib/db/context.server';
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
 * The caller owns the scoped identity; this adapter never upgrades credentials.
 * Every read and write runs inside the ScopedDb RLS context.
 */
export function createKnowledgeBasePersistence(
    db: ScopedDb,
): KnowledgeSourcePersistence & KnowledgeSearchPersistence {
    return {
        async replaceSourceEntries({ kbId, source, chunks }) {
            const data = await db.rpc('kb_replace_source_entries', {
                p_kb_id: kbId,
                p_source_type: source.sourceType,
                p_source_id: source.sourceId,
                p_entries: chunks.map(chunk => ({
                    content: chunk.content,
                    chunk_index: chunk.chunkIndex,
                    metadata: chunk.metadata,
                })),
                p_archive: source.archive === true,
            });
            return typeof data === 'number' ? data : null;
        },
        async searchFts(query, kbIds, limit, config) {
            const data = await db.rpc('search_knowledge_fts', {
                p_query: query,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_config: config,
            });
            return searchRows(data, 'rank');
        },
        async searchTrigram(query, kbIds, limit, threshold) {
            const data = await db.rpc('search_knowledge_trigram', {
                p_query: query,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_threshold: threshold,
            });
            return searchRows(data, 'similarity');
        },
        async searchVector(vector, kbIds, limit, dimension) {
            const data = await db.rpc('search_knowledge_vector', {
                p_query_vector: vector,
                p_kb_ids: kbIds,
                p_limit: limit,
                p_dim: dimension,
            });
            return searchRows(data, 'distance');
        },
        async loadWeights(userId, kbIds) {
            if (kbIds.length === 0) return [];
            const rows = await db.tx((trx) => trx
                .selectFrom('knowledge_bases')
                .select(['id', 'weight'])
                .where('user_id', '=', userId)
                .where('id', 'in', kbIds)
                .execute());
            return rows.map((row) => ({ id: row.id, weight: row.weight ?? 'normal' }));
        },
    };
}
