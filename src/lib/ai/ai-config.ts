/**
 * AI 模型配置
 *
 * 共享层不直接定义模型目录；模型本身应由数据库/后台维护。
 * 这里仅提供默认模型 ID、统一网关回退来源拼装，以及可选的环境变量回退模型。
 */

import type { AIModelConfig, AIModelSourceConfig, AIVendor } from '@/types';
import { buildManagedApiUrl, DEFAULT_AI_TRANSPORT, getModelUsageType } from './source-runtime';

type GatewaySourceEnv = {
  sourceKey: 'newapi' | 'octopus';
  sourceName: string;
  baseUrlEnvVar: 'NEWAPI_BASE_URL' | 'OCTOPUS_BASE_URL';
  apiKeyEnvVar: 'NEWAPI_API_KEY' | 'OCTOPUS_API_KEY';
  priority: number;
  isActive: boolean;
};

const GATEWAY_SOURCES: GatewaySourceEnv[] = [
  {
    sourceKey: 'newapi',
    sourceName: 'NewAPI',
    baseUrlEnvVar: 'NEWAPI_BASE_URL',
    apiKeyEnvVar: 'NEWAPI_API_KEY',
    priority: 1,
    isActive: true,
  },
  {
    sourceKey: 'octopus',
    sourceName: 'Octopus',
    baseUrlEnvVar: 'OCTOPUS_BASE_URL',
    apiKeyEnvVar: 'OCTOPUS_API_KEY',
    priority: 2,
    isActive: false,
  },
];

export function buildGatewaySourcesForModel(model: AIModelConfig): AIModelSourceConfig[] {
  const usageType = getModelUsageType(model);
  return GATEWAY_SOURCES.flatMap((gateway) => {
    const baseUrl = process.env[gateway.baseUrlEnvVar]?.trim();
    if (!baseUrl) {
      return [];
    }

    return [{
      sourceKey: gateway.sourceKey,
      sourceName: gateway.sourceName,
      apiUrl: buildManagedApiUrl(baseUrl, usageType),
      apiKeyEnvVar: gateway.apiKeyEnvVar,
      modelIdOverride: model.modelId || model.id,
      reasoningModelId: model.reasoningModelId || (model.supportsReasoning ? model.modelId || model.id : undefined),
      transport: DEFAULT_AI_TRANSPORT,
      priority: gateway.priority,
      isActive: gateway.isActive,
      isEnabled: true,
    }];
  });
}

export function attachGatewaySources(model: AIModelConfig): AIModelConfig {
  const sources = buildGatewaySourcesForModel(model);
  const primary = sources[0];
  if (!primary) {
    return {
      ...model,
      sources: [],
      transport: model.transport || DEFAULT_AI_TRANSPORT,
    };
  }

  return {
    ...model,
    modelId: primary.modelIdOverride || model.modelId,
    apiUrl: primary.apiUrl,
    apiKeyEnvVar: primary.apiKeyEnvVar,
    reasoningModelId: primary.reasoningModelId || model.reasoningModelId,
    sourceKey: primary.sourceKey,
    transport: primary.transport || DEFAULT_AI_TRANSPORT,
    sources,
  };
}

type EnvFallbackModel = Partial<AIModelConfig> & Pick<AIModelConfig, 'id' | 'vendor'>;

function normalizeEnvFallbackModel(input: EnvFallbackModel): AIModelConfig | null {
  if (!input.id || !input.vendor) {
    return null;
  }

  const usageType = input.usageType ?? (input.supportsVision ? 'vision' : 'chat');
  const normalized: AIModelConfig = {
    id: input.id,
    name: input.name || input.id,
    vendor: input.vendor as AIVendor,
    usageType,
    modelId: input.modelId || input.id,
    apiUrl: input.apiUrl || '',
    apiKeyEnvVar: input.apiKeyEnvVar || '',
    supportsReasoning: input.supportsReasoning ?? false,
    reasoningModelId: input.reasoningModelId,
    isReasoningDefault: input.isReasoningDefault ?? false,
    supportsVision: input.supportsVision ?? usageType === 'vision',
    defaultTemperature: input.defaultTemperature,
    defaultTopP: input.defaultTopP,
    defaultPresencePenalty: input.defaultPresencePenalty,
    defaultFrequencyPenalty: input.defaultFrequencyPenalty,
    defaultMaxTokens: input.defaultMaxTokens,
    defaultReasoningEffort: input.defaultReasoningEffort,
    reasoningEffortFormat: input.reasoningEffortFormat,
    customParameters: input.customParameters,
    requiredTier: input.requiredTier,
    reasoningRequiredTier: input.reasoningRequiredTier,
    sourceKey: input.sourceKey,
    transport: input.transport || DEFAULT_AI_TRANSPORT,
    sources: input.sources || [],
  };

  return attachGatewaySources(normalized);
}

function parseEnvFallbackModels(): AIModelConfig[] {
  const raw = process.env.MINGAI_FALLBACK_MODELS_JSON?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeEnvFallbackModel(entry as EnvFallbackModel))
      .filter((entry): entry is AIModelConfig => entry !== null);
  } catch (error) {
    console.warn('[ai-config] Failed to parse MINGAI_FALLBACK_MODELS_JSON:', error);
    return [];
  }
}

// ===== 动态生成模型配置 =====

export function buildModels(): AIModelConfig[] {
  return parseEnvFallbackModels();
}

// 懒加载模型配置（环境变量）
let _models: AIModelConfig[] | null = null;

/**
 * 同步获取环境变量回退模型配置
 */
export function getModels(): AIModelConfig[] {
  if (_models === null) {
    _models = buildModels();
  }
  return _models;
}

export function clearModelCache(): void {
  _models = null;
  console.info('[ai-config] Model cache cleared');
}

export function getModelConfig(modelId: string): AIModelConfig | undefined {
  const models = getModels();
  return models.find((model) => model.id === modelId);
}

export const DEFAULT_MODEL_ID = '';
export const DEFAULT_VISION_MODEL_ID = '';
export const DEFAULT_EMBEDDING_MODEL_ID = process.env.KNOWLEDGE_BASE_EMBEDDING_MODEL_ID || 'text-embedding-v4';
export const DEFAULT_RERANK_MODEL_ID = process.env.KNOWLEDGE_BASE_RERANK_MODEL_ID || 'qwen3-rerank';

export function getModelName(modelId: string): string {
  const model = getModelConfig(modelId);
  return model?.name || modelId;
}

export { VENDOR_NAMES, getVendorName, VENDOR_PRESETS } from './vendor-labels';
