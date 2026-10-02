import 'server-only';

import { resolveTokenMembership } from '@/lib/user/membership-server';
import { callReranker } from '@/lib/knowledge-base/reranker';
import { checkVectorIndexExists, generateEmbedding, getEmbeddingDimensionAsync } from '@/lib/knowledge-base/embedding-config';
import type { KnowledgeSearchPersistence, RankedResult, SearchCandidate, SearchOptions } from '@/lib/knowledge-base/types';
import { createAuthedClient } from '@/lib/api-utils';
import { createKnowledgeBasePersistence } from '@/lib/knowledge-base/persistence.server';

export class KnowledgeSearchContextError extends Error {
    readonly code = 'KNOWLEDGE_READ_CONTEXT_REQUIRED';

    constructor() {
        super('知识库检索缺少用户身份上下文');
        this.name = 'KnowledgeSearchContextError';
    }
}

function requireSearchAccessToken(accessToken?: string): string {
    if (!accessToken?.trim()) throw new KnowledgeSearchContextError();
    return accessToken;
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
    accessToken?: string,
    userId?: string
): Promise<{ candidates: SearchCandidate[]; highKbIds: string[] }> {
    if (candidates.length === 0) return { candidates, highKbIds: [] };
    pruneKbWeightCache();

    const persistence = createKnowledgeBasePersistence(createAuthedClient(requireSearchAccessToken(accessToken)));
    let effectiveUserId = userId;
    if (!effectiveUserId && accessToken) {
        const authed = createAuthedClient(accessToken);
        const { data: { user } } = await authed.auth.getUser();
        if (!user) return { candidates, highKbIds: [] };
        effectiveUserId = user.id;
    }
    if (!effectiveUserId) return { candidates, highKbIds: [] };

    const kbIds = Array.from(new Set(candidates.map(c => c.kbId).filter(Boolean)));
    if (kbIds.length === 0) return { candidates, highKbIds: [] };

    // 检查缓存
    const cacheKey = effectiveUserId;
    const cached = kbWeightCache.get(cacheKey);
    let weightMap: Map<string, string>;

    // 检查缓存是否有效且包含所有需要的 kbIds
    const cacheValid = cached && Date.now() - cached.timestamp < KB_WEIGHT_CACHE_TTL;
    const missingKbIds = cacheValid
        ? kbIds.filter(id => !cached.weights.has(id))
        : kbIds;

    if (cacheValid && missingKbIds.length === 0) {
        // 缓存完全命中
        weightMap = cached.weights;
    } else if (cacheValid && missingKbIds.length > 0) {
        // 缓存部分命中，补充查询缺失的 kbIds
        const kbRows = await persistence.loadWeights(effectiveUserId, missingKbIds);

        // 合并到现有缓存
        weightMap = new Map(cached.weights);
        (kbRows || []).forEach((kb: { id: string; weight: string }) => {
            weightMap.set(kb.id, kb.weight);
        });
        kbWeightCache.set(cacheKey, { weights: weightMap, timestamp: cached.timestamp });
        pruneKbWeightCache();
    } else {
        // 缓存未命中，完整查询
        const kbRows = await persistence.loadWeights(effectiveUserId, kbIds);

        weightMap = new Map<string, string>();
        (kbRows || []).forEach((kb: { id: string; weight: string }) => {
            weightMap.set(kb.id, kb.weight);
        });
        kbWeightCache.set(cacheKey, { weights: weightMap, timestamp: Date.now() });
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
export async function searchCandidates(query: string, options: SearchOptions): Promise<SearchCandidate[]> {
    const { kbIds, limit = 20, useVector = false, accessToken } = options;
    const persistence = createKnowledgeBasePersistence(createAuthedClient(requireSearchAccessToken(accessToken)));
    const config: SearchConfigInternal = { ...DEFAULT_SEARCH_CONFIG, ...options.searchConfig };

    const ftsResults = await searchByFTS(persistence, query, kbIds, limit, config);

    if (config.enableTrigram && ftsResults.length < limit) {
        const trigramResults = await searchByTrigram(
            persistence,
            query,
            kbIds,
            limit - ftsResults.length,
            config
        );
        const merged = deduplicateResults([...ftsResults, ...trigramResults]);
        if (useVector) {
            const vectorResults = await searchByVector(persistence, query, kbIds, limit, accessToken);
            return deduplicateResults([...merged, ...vectorResults]);
        }
        return merged;
    }

    if (useVector) {
        const vectorResults = await searchByVector(persistence, query, kbIds, limit, accessToken);
        return deduplicateResults([...ftsResults, ...vectorResults]);
    }

    return ftsResults;
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
    return rows.map(({ rawScore, ...row }) => ({
        ...row,
        method: 'fts',
        score: normalizeScore('fts', rawScore),
    }));
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
    return rows.map(({ rawScore, ...row }) => ({
        ...row,
        method: 'trigram',
        score: normalizeScore('trigram', rawScore),
    }));
}

async function searchByVector(
    persistence: KnowledgeSearchPersistence,
    query: string,
    kbIds: string[] | undefined,
    limit: number,
    accessToken?: string
): Promise<SearchCandidate[]> {
    const dim = await getEmbeddingDimensionAsync();
    const indexExists = await checkVectorIndexExists(dim, accessToken);
    if (!indexExists) return [];

    const queryVector = await generateEmbedding(query);
    if (!queryVector) return [];

    const rows = await persistence.searchVector(queryVector, kbIds, limit, dim);
    return rows.map(({ rawScore, ...row }) => ({
        ...row,
        method: 'vector',
        score: normalizeScore('vector', rawScore),
    }));
}

export async function rerankCandidates(
    query: string,
    candidates: SearchCandidate[],
    topK: number = 5
): Promise<RankedResult[]> {
    return await callReranker(query, candidates, topK);
}

export async function searchKnowledge(query: string, options: SearchOptions = {}): Promise<SearchCandidate[] | RankedResult[]> {
    if (options.membershipType === 'free') return [];
    requireSearchAccessToken(options.accessToken);
    const membership = options.membershipType ?? await resolveTokenMembership(options.accessToken);
    if (membership === 'free') return [];
    const candidates = await searchCandidates(query, {
        ...options,
        useVector: membership === 'pro' && options.useVector !== false
    });
    const weighted = await applyKnowledgeBaseWeights(candidates, options.accessToken, options.userId);
    let weightedCandidates = weighted.candidates;
    const highKbIds = weighted.highKbIds;

    const topK = options.topK ?? 5;
    if (membership === 'pro' && highKbIds.length > 0) {
        try {
            const baseLimit = options.limit ?? 20;
            const extraCandidates = await searchCandidates(query, {
                ...options,
                kbIds: highKbIds,
                limit: baseLimit + 10,
                useVector: options.useVector !== false
            });
            const weightedExtra = await applyKnowledgeBaseWeights(extraCandidates, options.accessToken, options.userId);
            weightedCandidates = deduplicateResults([...weightedCandidates, ...weightedExtra.candidates]);
        } catch (error) {
            console.warn('[knowledge-base] extra high-weight candidate search failed:', error);
        }
    }

    if (membership === 'pro' && weightedCandidates.length > Math.max(5, topK)) {
        try {
            return await rerankCandidates(query, weightedCandidates, topK);
        } catch (error) {
            console.warn('[knowledge-base] rerank failed, falling back to weighted candidates:', error);
            return weightedCandidates;
        }
    }

    return weightedCandidates;
}
