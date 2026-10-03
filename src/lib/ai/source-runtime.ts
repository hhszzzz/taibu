import type {
  AIModelConfig,
  AIModelSourceConfig,
  AIRoutingMode,
  AITransport,
  AIUsageType,
} from '@/types';

export const MANAGED_AI_SOURCE_KEYS = ['newapi', 'octopus'] as const;
export type ManagedAISourceKey = (typeof MANAGED_AI_SOURCE_KEYS)[number];
export const DEFAULT_AI_TRANSPORT: AITransport = 'openai_compatible';

export function isManagedSourceKey(sourceKey: string | null | undefined): sourceKey is ManagedAISourceKey {
  return !!sourceKey && MANAGED_AI_SOURCE_KEYS.includes(sourceKey as ManagedAISourceKey);
}

export function getModelUsageType(model: Pick<AIModelConfig, 'usageType' | 'supportsVision'>): AIUsageType {
  if (model.usageType) {
    return model.usageType;
  }
  return model.supportsVision ? 'vision' : 'chat';
}

export function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getManagedEndpointPath(usageType: AIUsageType): string {
  switch (usageType) {
    case 'embedding':
      return '/v1/embeddings';
    case 'rerank':
      return '/v1/rerank';
    case 'chat':
    case 'vision':
    default:
      return '/v1/chat/completions';
  }
}

export function buildManagedApiUrl(baseUrl: string | null | undefined, usageType: AIUsageType): string {
  const normalizedBaseUrl = trimTrailingSlash((baseUrl || '').trim());
  if (!normalizedBaseUrl) {
    return '';
  }

  const endpoint = getManagedEndpointPath(usageType);
  if (
    normalizedBaseUrl.endsWith('/chat/completions')
    || normalizedBaseUrl.endsWith('/embeddings')
    || normalizedBaseUrl.endsWith('/rerank')
  ) {
    return normalizedBaseUrl;
  }

  const normalizedEndpoint = normalizedBaseUrl.endsWith('/v1')
    ? endpoint.replace(/^\/v1/, '')
    : endpoint;

  return `${normalizedBaseUrl}${normalizedEndpoint}`;
}

export function isUserSelectableUsageType(usageType: AIUsageType): boolean {
  return usageType === 'chat' || usageType === 'vision';
}

export function sortModelSources<T extends AIModelSourceConfig>(sources: T[]): T[] {
  return [...sources].sort((left, right) => {
    const activeDelta = Number(Boolean(right.isActive)) - Number(Boolean(left.isActive));
    if (activeDelta !== 0) return activeDelta;

    const priorityDelta = (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER);
    if (priorityDelta !== 0) return priorityDelta;

    return left.sourceKey.localeCompare(right.sourceKey);
  });
}

export function getOrderedModelSources(model: AIModelConfig): AIModelSourceConfig[] {
  const routingMode: AIRoutingMode = model.routingMode || 'auto';

  const configuredSources = model.sources || [];
  let sources = configuredSources
    .filter((source) => source.isEnabled !== false)
    .filter((source) => !!source.apiUrl && !!source.apiKeyEnvVar);

  if (routingMode === 'newapi' || routingMode === 'octopus') {
    sources = sources.filter((source) => source.sourceKey === routingMode);
  }

  if (sources.length > 0) {
    return sortModelSources(sources);
  }

  // A configured list is authoritative, even when every binding is filtered out.
  // Empty lists are also emitted by legacy environment configurations.
  if (configuredSources.length > 0 || !model.apiUrl || !model.apiKeyEnvVar) {
    return [];
  }
  if ((routingMode === 'newapi' || routingMode === 'octopus') && model.sourceKey !== routingMode) {
    return [];
  }

  return [{
    sourceKey: model.sourceKey || 'default',
    sourceName: model.sourceKey || 'Default',
    apiUrl: model.apiUrl,
    apiKeyEnvVar: model.apiKeyEnvVar,
    modelIdOverride: model.modelId,
    reasoningModelId: model.reasoningModelId,
    transport: model.transport || DEFAULT_AI_TRANSPORT,
    priority: 1,
    isActive: true,
    isEnabled: true,
  }];
}

export function applySourceToModel(
  model: AIModelConfig,
  source: AIModelSourceConfig,
): AIModelConfig {
  return {
    ...model,
    modelId: source.modelIdOverride || model.modelId,
    reasoningModelId: source.reasoningModelId || model.reasoningModelId,
    apiUrl: source.apiUrl,
    apiKeyEnvVar: source.apiKeyEnvVar,
    sourceKey: source.sourceKey,
    transport: source.transport || model.transport || DEFAULT_AI_TRANSPORT,
  };
}
