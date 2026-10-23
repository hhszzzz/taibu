import type { ScopedDb } from '@/lib/db/context.server';
import { DEFAULT_EMBEDDING_MODEL_ID } from '@/lib/ai/ai-config';
import { getModelConfigAsync, getModelsByUsageTypeAsync } from '@/lib/server/ai-config';
import { applySourceToModel, getOrderedModelSources } from '@/lib/ai/source-runtime';
import type { AIModelConfig } from '@/types';

export const EMBEDDING_MODELS = {
    'text-embedding-v4': { dimension: 1024, provider: 'gateway' },
    'text-embedding-v3': { dimension: 1024, provider: 'gateway' },
    'bge-large-zh-v1.5': { dimension: 1024, provider: 'local' },
    'bge-m3': { dimension: 1024, provider: 'local' }
} as const;

export type EmbeddingModel = keyof typeof EMBEDDING_MODELS;

interface EmbeddingConfig {
    model: EmbeddingModel;
    dimension: number;
    provider: 'gateway' | 'local';
    modelConfig: AIModelConfig | null;
}

const DEFAULT_MODEL: EmbeddingModel = DEFAULT_EMBEDDING_MODEL_ID as EmbeddingModel;

function getEmbeddingMetadata(modelId: string): { model: EmbeddingModel; dimension: number; provider: 'gateway' | 'local' } {
    const normalized = ((modelId in EMBEDDING_MODELS ? modelId : DEFAULT_MODEL) as EmbeddingModel);
    const modelConfig = EMBEDDING_MODELS[normalized] || EMBEDDING_MODELS[DEFAULT_MODEL];

    return {
        model: normalized,
        dimension: modelConfig.dimension,
        provider: modelConfig.provider
    };
}

async function resolveEmbeddingModelConfig(): Promise<AIModelConfig | null> {
    const configuredId = process.env.KNOWLEDGE_BASE_EMBEDDING_MODEL_ID || DEFAULT_MODEL;
    const direct = await getModelConfigAsync(configuredId);
    if (direct) {
        return direct;
    }

    const usageModels = await getModelsByUsageTypeAsync('embedding');
    return usageModels[0] || null;
}

async function getEmbeddingConfig(): Promise<EmbeddingConfig> {
    const modelConfig = await resolveEmbeddingModelConfig();
    const metadata = getEmbeddingMetadata(modelConfig?.id || DEFAULT_MODEL);

    return {
        ...metadata,
        modelConfig,
    };
}

export async function getEmbeddingDimensionAsync(): Promise<number> {
    const config = await getEmbeddingConfig();
    return config.dimension;
}

export async function checkVectorIndexExists(dim: number, db: ScopedDb): Promise<boolean> {
    const data = await db.rpc('check_vector_index_exists', { p_dim: dim });
    return data === true;
}

async function callGatewayEmbedding(text: string, modelConfig: AIModelConfig): Promise<number[] | null> {
    const sources = getOrderedModelSources(modelConfig);

    for (const source of sources) {
        const runtimeConfig = applySourceToModel(modelConfig, source);
        const apiKey = process.env[runtimeConfig.apiKeyEnvVar];
        if (!apiKey || !runtimeConfig.apiUrl) {
            continue;
        }

        const response = await fetch(runtimeConfig.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: runtimeConfig.modelId,
                input: text
            })
        });

        if (!response.ok) {
            continue;
        }

        const data = await response.json() as { data?: Array<{ embedding: number[] }> };
        const embedding = data.data?.[0]?.embedding;
        if (embedding) {
            return embedding;
        }
    }

    return null;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
    const config = await getEmbeddingConfig();

    try {
        switch (config.provider) {
            case 'gateway':
                return config.modelConfig ? await callGatewayEmbedding(text, config.modelConfig) : null;
            case 'local':
                return await callLocalEmbedding(text, config.model);
            default:
                throw new Error(`Unknown embedding provider: ${config.provider}`);
        }
    } catch (err) {
        console.warn('[embedding] generateEmbedding failed:', err);
        return null;
    }
}

export async function generateEmbeddings(texts: string[]): Promise<{
    vectors: Array<number[] | null>;
    model: string;
    dimension: number;
}> {
    const config = await getEmbeddingConfig();
    const vectors: Array<number[] | null> = [];

    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchVectors = await Promise.all(batch.map((text) => generateEmbedding(text)));
        vectors.push(...batchVectors);
    }

    return {
        vectors,
        model: config.model,
        dimension: config.dimension
    };
}

async function callLocalEmbedding(_text: string, _model: EmbeddingModel): Promise<number[] | null> {
    void _text;
    void _model;
    return null;
}
