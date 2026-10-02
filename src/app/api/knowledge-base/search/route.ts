import { NextRequest } from 'next/server';
import { KnowledgeSearchContextError, searchKnowledge } from '@/lib/knowledge-base/search';
import type { RankedResult, SearchCandidate } from '@/lib/knowledge-base/types';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { ensureFeatureRouteEnabled } from '@/lib/feature-gate-utils';
import { MembershipResolutionError } from '@/lib/user/membership-server';

export async function POST(request: NextRequest) {
    const featureError = await ensureFeatureRouteEnabled('knowledge-base');
    if (featureError) return featureError;
    const auth = await requireUserContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }
    const user = auth.user;
    const accessToken = auth.accessToken ?? null;

    const body = await request.json() as { query?: unknown; kbIds?: string[]; topK?: number };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return jsonError('query 不能为空', 400);

    let results;
    try {
        results = await searchKnowledge(query, {
            kbIds: body.kbIds,
            topK: body.topK,
            accessToken: accessToken || undefined,
            userId: user.id,
        });
    } catch (error) {
        if (error instanceof KnowledgeSearchContextError) {
            return jsonError(error.message, 401);
        }
        if (error instanceof MembershipResolutionError) {
            return jsonError(error.message, 500);
        }
        throw error;
    }
    const first = (results as Array<SearchCandidate | RankedResult>)[0];

    if (first && 'rank' in first) {
        return jsonOk({ candidates: [], ranked: results });
    }

    return jsonOk({ candidates: results, ranked: null });
}
