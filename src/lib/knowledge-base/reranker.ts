import type { RankedResult, SearchCandidate } from '@/lib/knowledge-base/types';
import { DEFAULT_RERANK_MODEL_ID } from '@/lib/ai/ai-config';
import { getModelConfigAsync, getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { openModelSources } from '@/lib/ai/gateway-secrets.server';
import type { AIModelConfig } from '@/types';

async function resolveRerankerModelConfig(): Promise<AIModelConfig | null> {
    const configuredId = process.env.KNOWLEDGE_BASE_RERANK_MODEL_ID || DEFAULT_RERANK_MODEL_ID;
    const direct = await getModelConfigAsync(configuredId);
    if (direct) {
        return direct;
    }

    const usageModels = await getModelsByUsageTypeAsync('rerank');
    return usageModels[0] || null;
}

function fallbackRanking(candidates: SearchCandidate[], topK: number): RankedResult[] {
    return candidates.slice(0, topK).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export async function callReranker(
    query: string,
    candidates: SearchCandidate[],
    topK: number
): Promise<RankedResult[]> {
    const modelConfig = await resolveRerankerModelConfig();
    if (!modelConfig) {
        return fallbackRanking(candidates, topK);
    }

    for (const { config: runtimeConfig, apiKey } of openModelSources(modelConfig)) {
        const response = await fetch(runtimeConfig.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: runtimeConfig.modelId,
                query,
                documents: candidates.map((candidate) => candidate.content),
                top_n: topK
            })
        });

        if (!response.ok) {
            continue;
        }

        const data = await response.json() as { results?: Array<{ index: number; relevance_score: number }> };
        const results = data.results || [];
        if (results.length === 0) {
            continue;
        }

        return results.map((result, index) => ({
            ...candidates[result.index],
            score: result.relevance_score,
            rank: index + 1
        }));
    }

    return fallbackRanking(candidates, topK);
}
