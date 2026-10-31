import 'server-only';

import type { ScopedDb } from '@/lib/db/context.server';
import { searchKnowledge } from '@/lib/knowledge-base/search';
import { stripMentionTokens } from '@/lib/mentions';
import type { KnowledgeHit, RankedResult, SearchCandidate } from '@/lib/knowledge-base/types';

export interface BuildKnowledgeHitsOptions {
    query: string;
    userId: string;
    db: ScopedDb;
    promptKbIds: string[];
    knownNames?: { userId: string; names: ReadonlyMap<string, string> };
}

/**
 * Shared knowledge base search and hit builder.
 *
 * Replaces duplicate implementations in:
 * - src/lib/server/chat/prompt-context.ts
 * - src/lib/chat/preview-context.ts
 */
export async function buildKnowledgeHits({
    query,
    userId,
    db,
    promptKbIds,
    knownNames,
}: BuildKnowledgeHitsOptions): Promise<KnowledgeHit[]> {
    const cleanedQuery = stripMentionTokens(query);
    if (!cleanedQuery || promptKbIds.length === 0) return [];

    const results = await searchKnowledge(cleanedQuery, {
        limit: 12,
        topK: 5,
        db,
        userId,
        kbIds: promptKbIds,
    });

    const candidates = results as Array<SearchCandidate | RankedResult>;
    const kbIds = Array.from(
        new Set(candidates.map((result) => result.kbId).filter(Boolean))
    ) as string[];

    if (kbIds.length === 0) return [];

    // Only this request's owner-matched names may suppress a lookup.
    const kbMap = new Map(knownNames?.userId === userId ? knownNames.names : []);
    const missingIds = kbIds.filter(id => !kbMap.has(id));
    if (missingIds.length > 0) {
        try {
            const kbRows = await db.tx((trx) => trx
                .selectFrom('knowledge_bases')
                .select(['id', 'name'])
                .where('user_id', '=', userId)
                .where('id', 'in', missingIds)
                .execute());
            for (const kb of kbRows) {
                if (typeof kb.id === 'string' && typeof kb.name === 'string') kbMap.set(kb.id, kb.name);
            }
        } catch {
            console.warn('[knowledge-base] enrichment failed', { stage: 'hit-names' });
        }
    }

    return candidates.slice(0, 8).map((result): KnowledgeHit => ({
        kbId: result.kbId,
        kbName: kbMap.get(result.kbId) || '知识库',
        content: result.content,
        score: result.score || 0,
    }));
}
