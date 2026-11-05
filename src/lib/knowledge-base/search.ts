import 'server-only';

import type { ScopedDb } from '@/lib/db/context.server';
import { callReranker } from '@/lib/knowledge-base/reranker';
import { checkVectorIndexExists, generateEmbedding, getEmbeddingDimensionAsync } from '@/lib/knowledge-base/embedding-config';
import type { KnowledgeSearchPersistence, KnowledgeSearchRow, RankedResult, SearchCandidate, SearchOptions } from '@/lib/knowledge-base/types';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';
import { KNOWLEDGE_QUERY_MAX_LENGTH } from './types';

export class KnowledgeSearchContextError extends Error {
    readonly code = 'KNOWLEDGE_READ_CONTEXT_REQUIRED';

    constructor() {
        super('知识库检索缺少用户身份上下文');
        this.name = 'KnowledgeSearchContextError';
    }
}

function requireSearchDb(db?: ScopedDb | SearchOptions['db']): ScopedDb {
    if (!db) throw new KnowledgeSearchContextError();
    return db as ScopedDb;
}

function scopedUserId(db: ScopedDb): string {
    if (db.scope.kind !== 'user') throw new KnowledgeSearchContextError();
    return db.scope.userId;
}

interface SearchConfigInternal {
    ftsConfig: 'simple' | 'english';
    enableTrigram: boolean;
    trigramThreshold: number;
}

const DEFAULT_SEARCH_CONFIG: SearchConfigInternal = {
    ftsConfig: 'simple',
    enableTrigram: true,
    trigramThreshold: 0.3
};

function normalizeScore(method: 'fts' | 'trigram' | 'vector', rawScore: number): number {
    switch (method) {
        case 'fts':
            return Math.min(rawScore * 3.33, 1);
        case 'trigram':
            return rawScore;
        case 'vector':
            return 1 - rawScore / 2;
    }
}

/** A stage's rows as candidates, scored by the stage's own normalization. */
function toCandidates(rows: KnowledgeSearchRow[], method: SearchCandidate['method']): SearchCandidate[] {
    return rows.map(({ rawScore, ...row }) => ({ ...row, method, score: normalizeScore(method, rawScore) }));
}

function deduplicateResults(results: SearchCandidate[]): SearchCandidate[] {
    const seen = new Map<string, SearchCandidate>();

    for (const r of results) {
        const existing = seen.get(r.id);
        if (!existing || r.score > existing.score) {
            seen.set(r.id, r);
        }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

function getWeightMultiplier(weight?: string | null): number {
    if (weight === 'high') return 1.15;
    if (weight === 'low') return 0.85;
    return 1;
}

// 缓存知识库权重信息，避免重复查询
const kbWeightCache = new Map<string, { weights: Map<string, string>; timestamp: number }>();
const KB_WEIGHT_CACHE_TTL = 60000; // 1 分钟缓存
const KB_WEIGHT_CACHE_MAX = 128;

function pruneKbWeightCache(now = Date.now()) {
    for (const [cacheKey, entry] of kbWeightCache.entries()) {
        if (now - entry.timestamp >= KB_WEIGHT_CACHE_TTL) {
            kbWeightCache.delete(cacheKey);
        }
    }

    if (kbWeightCache.size <= KB_WEIGHT_CACHE_MAX) {
        return;
    }

    const overflow = kbWeightCache.size - KB_WEIGHT_CACHE_MAX;
    const oldestEntries = [...kbWeightCache.entries()]
        .sort((left, right) => left[1].timestamp - right[1].timestamp)
        .slice(0, overflow);

    for (const [cacheKey] of oldestEntries) {
        kbWeightCache.delete(cacheKey);
    }
}

async function applyKnowledgeBaseWeights(
    candidates: SearchCandidate[],
    db: ScopedDb | undefined,
    userId?: string,
    boundPersistence?: KnowledgeSearchPersistence,
): Promise<{ candidates: SearchCandidate[]; highKbIds: string[] }> {
    if (candidates.length === 0) return { candidates, highKbIds: [] };
    pruneKbWeightCache();

    const persistence = boundPersistence ?? createKnowledgeBasePersistence(requireSearchDb(db));
    const effectiveUserId = userId ?? (db ? scopedUserId(db) : null);
    if (!effectiveUserId) throw new KnowledgeSearchContextError();

    const kbIds = Array.from(new Set(candidates.map(c => c.kbId).filter(Boolean)));
    if (kbIds.length === 0) return { candidates, highKbIds: [] };

    const cacheKey = effectiveUserId;
    const now = Date.now();
    const cached = kbWeightCache.get(cacheKey);
    const fresh = cached !== undefined && now - cached.timestamp < KB_WEIGHT_CACHE_TTL;
    const weightMap = new Map<string, string>(fresh && cached ? cached.weights : []);
    const missingKbIds = kbIds.filter(id => !weightMap.has(id));
    if (missingKbIds.length > 0) {
        const kbRows = await persistence.loadWeights(effectiveUserId, missingKbIds);
        for (const kb of kbRows || []) {
            weightMap.set(kb.id, kb.weight);
        }
        // A partial hit keeps the entry's original expiry; a full miss starts a new one.
        kbWeightCache.set(cacheKey, { weights: weightMap, timestamp: fresh && cached ? cached.timestamp : now });
        pruneKbWeightCache();
    }

    const highKbIdSet = new Set<string>();
    const boosted = candidates.map(candidate => {
        const weight = weightMap.get(candidate.kbId);
        if (weight === 'high') highKbIdSet.add(candidate.kbId);
        const multiplier = getWeightMultiplier(weight);
        return {
            ...candidate,
            score: Math.min(candidate.score * multiplier, 1),
        };
    });

    boosted.sort((a, b) => b.score - a.score);
    return { candidates: boosted, highKbIds: Array.from(highKbIdSet) };
}

// 知识库检索主入口：FTS -> Trigram -> Vector（可选），并做去重合并
export async function searchCandidates(query: string, options: SearchOptions, boundPersistence?: KnowledgeSearchPersistence): Promise<SearchCandidate[]> {
    const { kbIds, limit = 20, useVector = false, db } = options;
    const persistence = boundPersistence ?? createKnowledgeBasePersistence(requireSearchDb(db));
    const config: SearchConfigInternal = { ...DEFAULT_SEARCH_CONFIG, ...options.searchConfig };

    let successfulStages = 0;
    const stage = async (name: 'fts' | 'trigram' | 'vector', run: () => Promise<SearchCandidate[]>) => {
        try {
            const rows = await run();
            successfulStages++;
            return rows;
        } catch (error) {
            if (error instanceof KnowledgeSearchContextError) throw error;
            console.warn('[knowledge-base] retrieval stage failed', { stage: name });
            return [];
        }
    };
    const ftsResults = await stage('fts', () => searchByFTS(persistence, query, kbIds, limit, config));
    let results = ftsResults;
    if (config.enableTrigram && ftsResults.length < limit) {
        const trigram = await stage('trigram', () => searchByTrigram(persistence, query, kbIds, limit - ftsResults.length, config));
        results = deduplicateResults([...results, ...trigram]);
    }
    if (useVector) {
        const vector = await stage('vector', () => searchByVector(persistence, query, kbIds, limit, db as ScopedDb | undefined, !!boundPersistence));
        results = deduplicateResults([...results, ...vector]);
    }
    if (successfulStages === 0) throw new Error('Knowledge retrieval failed');
    return results;
}

// FTS 精确检索：适合关键字匹配，速度快
async function searchByFTS(
    persistence: KnowledgeSearchPersistence,
    query: string,
    kbIds: string[] | undefined,
    limit: number,
    config: SearchConfigInternal
): Promise<SearchCandidate[]> {
    const rows = await persistence.searchFts(query, kbIds, limit, config.ftsConfig);
    return toCandidates(rows, 'fts');
}

// Trigram 近似检索：在 FTS 结果不足时补充模糊匹配
async function searchByTrigram(
    persistence: KnowledgeSearchPersistence,
    query: string,
    kbIds: string[] | undefined,
    limit: number,
    config: SearchConfigInternal
): Promise<SearchCandidate[]> {
    const rows = await persistence.searchTrigram(query, kbIds, limit, config.trigramThreshold);
    return toCandidates(rows, 'trigram');
}

async function searchByVector(
    persistence: KnowledgeSearchPersistence,
    query: string,
    kbIds: string[] | undefined,
    limit: number,
    db: ScopedDb | undefined,
    indexValidatedByPersistence = false,
): Promise<SearchCandidate[]> {
    const dim = await getEmbeddingDimensionAsync();
    const indexExists = indexValidatedByPersistence || await checkVectorIndexExists(dim, requireSearchDb(db));
    if (!indexExists) throw new Error('Vector index unavailable');

    const queryVector = await generateEmbedding(query);
    if (!queryVector) throw new Error('Query embedding unavailable');

    const rows = await persistence.searchVector(queryVector, kbIds, limit, dim);
    return toCandidates(rows, 'vector');
}

export async function searchKnowledge(query: string, options: SearchOptions = {}): Promise<SearchCandidate[] | RankedResult[]> {
    const db = requireSearchDb(options.db);
    const userId = options.userId ?? scopedUserId(db);
    return searchKnowledgeWithPersistence(query, userId, createKnowledgeBasePersistence(db), options);
}

/**
 * A server adapter must bind an owner-scoped persistence implementation before using this entry point. Vector search,
 * the second pass over high-weight bases and reranking serve everyone.
 */
export async function searchKnowledgeWithPersistence(query: string, userId: string, persistence: KnowledgeSearchPersistence, options: SearchOptions = {}): Promise<SearchCandidate[] | RankedResult[]> {
    if (query.length > KNOWLEDGE_QUERY_MAX_LENGTH) throw new Error(`检索内容不能超过 ${KNOWLEDGE_QUERY_MAX_LENGTH} 字`);
    const candidates = await searchCandidates(query, {
        ...options,
        useVector: options.useVector !== false
    }, persistence);
    let weighted: { candidates: SearchCandidate[]; highKbIds: string[] };
    try {
        weighted = await applyKnowledgeBaseWeights(candidates, options.db as ScopedDb | undefined, userId, persistence);
    } catch (error) {
        if (error instanceof KnowledgeSearchContextError) throw error;
        console.warn('[knowledge-base] enrichment failed', { stage: 'weights' });
        weighted = { candidates, highKbIds: [] };
    }
    let weightedCandidates = weighted.candidates;
    const highKbIds = weighted.highKbIds;

    const topK = options.topK ?? 5;
    if (highKbIds.length > 0) {
        try {
            const baseLimit = options.limit ?? 20;
            const extraCandidates = await searchCandidates(query, {
                ...options,
                kbIds: highKbIds,
                limit: baseLimit + 10,
                useVector: options.useVector !== false
            }, persistence);
            const weightedExtra = await applyKnowledgeBaseWeights(extraCandidates, options.db as ScopedDb | undefined, userId, persistence);
            weightedCandidates = deduplicateResults([...weightedCandidates, ...weightedExtra.candidates]);
        } catch (error) {
            if (error instanceof KnowledgeSearchContextError) throw error;
            console.warn('[knowledge-base] enrichment failed', { stage: 'high-weight' });
        }
    }

    if (weightedCandidates.length > Math.max(5, topK)) {
        try {
            return await callReranker(query, weightedCandidates, topK);
        } catch {
            console.warn('[knowledge-base] enrichment failed', { stage: 'rerank' });
            return weightedCandidates;
        }
    }

    return weightedCandidates;
}
