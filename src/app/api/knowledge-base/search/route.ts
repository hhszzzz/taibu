import { NextRequest } from 'next/server';
import { KnowledgeSearchContextError, searchKnowledge } from '@/lib/knowledge-base/search';
import type { RankedResult, SearchCandidate } from '@/lib/knowledge-base/types';
import { KNOWLEDGE_QUERY_MAX_LENGTH } from '@/lib/knowledge-base/types';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }
    const user = auth.user;

    let body: { query?: unknown; kbIds?: string[]; topK?: number };
    try {
        const value = await request.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return jsonError('请求体无效', 400);
        body = value;
    } catch { return jsonError('请求体不是合法 JSON', 400); }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return jsonError('query 不能为空', 400);
    if (query.length > KNOWLEDGE_QUERY_MAX_LENGTH) return jsonError(`检索内容不能超过 ${KNOWLEDGE_QUERY_MAX_LENGTH} 字`, 400);

    let results;
    try {
        results = await searchKnowledge(query, {
            kbIds: body.kbIds,
            topK: body.topK,
            db: auth.db,
            userId: user.id,
        });
    } catch (error) {
        if (error instanceof KnowledgeSearchContextError) {
            return jsonError(error.message, 401);
        }
        throw error;
    }
    const first = (results as Array<SearchCandidate | RankedResult>)[0];

    if (first && 'rank' in first) {
        return jsonOk({ candidates: [], ranked: results });
    }

    return jsonOk({ candidates: results, ranked: null });
}
