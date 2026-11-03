import type { AIModelConfig } from '@/types';

/** Application context limits. Unknown model capacities are deliberately absent. */
export interface ModelContextConfig {
    maxContext: number;
    reserveOutput: number;
    reserveHistory: number;
}

const MODEL_CONTEXT_CONFIGS: Record<string, ModelContextConfig> = {
    'deepseek-v3.2': { maxContext: 32000, reserveOutput: 2000, reserveHistory: 4000 },
    'deepseek-pro': { maxContext: 64000, reserveOutput: 4000, reserveHistory: 4000 },
    'deepseek-pro-reasoner': { maxContext: 64000, reserveOutput: 4000, reserveHistory: 4000 },
    'glm-4.6': { maxContext: 128000, reserveOutput: 2000, reserveHistory: 4000 },
    'glm-4.6-reasoner': { maxContext: 128000, reserveOutput: 2000, reserveHistory: 4000 },
    'glm-4.7': { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
    'glm-4.7-reasoner': { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
    'gemini-3': { maxContext: 128000, reserveOutput: 2000, reserveHistory: 4000 },
    'gemini-pro': { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
    'qwen-3-max': { maxContext: 64000, reserveOutput: 4000, reserveHistory: 4000 },
    deepai: { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
    'qwen-vl-plus': { maxContext: 32000, reserveOutput: 4000, reserveHistory: 4000 },
    'qwen-vl-plus-reasoner': { maxContext: 32000, reserveOutput: 5000, reserveHistory: 4000 },
    'gemini-vl': { maxContext: 32000, reserveOutput: 4000, reserveHistory: 8000 },
    'kimi-k2.5': { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
    'kimi-k2.5-reasoner': { maxContext: 128000, reserveOutput: 4000, reserveHistory: 4000 },
};

export function resolveKnownModelContextConfig(modelId: string, reasoningEnabled?: boolean): ModelContextConfig | null {
    const reasoningId = `${modelId}-reasoner`;
    if (reasoningEnabled && Object.hasOwn(MODEL_CONTEXT_CONFIGS, reasoningId)) return MODEL_CONTEXT_CONFIGS[reasoningId];
    if (Object.hasOwn(MODEL_CONTEXT_CONFIGS, modelId)) return MODEL_CONTEXT_CONFIGS[modelId];
    if (modelId.startsWith('gemini-pro-')) return MODEL_CONTEXT_CONFIGS['gemini-pro'];
    if (modelId.startsWith('gemini-vl-')) return MODEL_CONTEXT_CONFIGS['gemini-vl'];
    if (modelId.startsWith('deepai-')) return MODEL_CONTEXT_CONFIGS.deepai;
    if (modelId.startsWith('kimi-')) return MODEL_CONTEXT_CONFIGS['kimi-k2.5'];
    return null;
}

/** Ordinary chat still needs a bounded prompt budget when capacity is unknown. */
const DEFAULT_PROMPT_BUDGET: ModelContextConfig = { maxContext: 32000, reserveOutput: 2000, reserveHistory: 4000 };

type WindowedModel = Pick<AIModelConfig, 'id' | 'contextWindow' | 'defaultMaxTokens'>;

/**
 * A model's window: the context window set for it in the admin catalog (reserving its output limit), else the known
 * application limit for its ID; null when neither is known.
 */
export function resolveModelWindow(model: WindowedModel, reasoningEnabled?: boolean): ModelContextConfig | null {
    const known = resolveKnownModelContextConfig(model.id, reasoningEnabled);
    if (!model.contextWindow) return known;
    const base = known ?? DEFAULT_PROMPT_BUDGET;
    return { ...base, maxContext: model.contextWindow, reserveOutput: model.defaultMaxTokens ?? base.reserveOutput };
}

export function resolveModelContextConfig(model: string | WindowedModel, reasoningEnabled?: boolean): ModelContextConfig {
    return (typeof model === 'string' ? resolveKnownModelContextConfig(model, reasoningEnabled) : resolveModelWindow(model, reasoningEnabled))
        ?? DEFAULT_PROMPT_BUDGET;
}
