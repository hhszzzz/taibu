import type {
  AIModelConfig,
  AIModelSourceConfig,
  AIUsageType,
} from '@/types';

/** Gateway identifiers: lowercase, digits, `-` and `_`, as the database checks them. */
export const GATEWAY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/u;

export function getModelUsageType(model: Pick<AIModelConfig, 'usageType'>): AIUsageType {
  return model.usageType ?? 'chat';
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
    // Image models append /images/generations to the API base themselves.
    case 'image':
      return '/v1';
    case 'chat':
    default:
      return '/v1/chat/completions';
  }
}

export function buildManagedApiUrl(baseUrl: string | null | undefined, usageType: AIUsageType): string {
  let normalizedBaseUrl = trimTrailingSlash((baseUrl || '').trim());
  if (!normalizedBaseUrl) {
    return '';
  }

  // A pasted full endpoint is the same gateway as its base URL.
  if (normalizedBaseUrl.endsWith('/images/generations')) {
    normalizedBaseUrl = trimTrailingSlash(normalizedBaseUrl.slice(0, -'/images/generations'.length));
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
  return usageType === 'chat';
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

/** Enabled sources that can be called (a URL and a saved key), in failover order. */
export function getOrderedModelSources(model: AIModelConfig): AIModelSourceConfig[] {
  return sortModelSources((model.sources || [])
    .filter((source) => source.isEnabled !== false)
    .filter((source) => !!source.apiUrl && !!source.apiKeySecret));
}

export function applySourceToModel(
  model: AIModelConfig,
  source: AIModelSourceConfig,
): AIModelConfig {
  return {
    ...model,
    modelId: source.modelIdOverride || model.modelId,
    apiUrl: source.apiUrl,
    gatewayId: source.gatewayId,
    apiKeySecret: source.apiKeySecret,
    sourceKey: source.sourceKey,
  };
}
