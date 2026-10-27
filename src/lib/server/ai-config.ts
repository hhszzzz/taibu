import 'server-only';

import type {
  AIModelConfig,
  AIModelSourceConfig,
  AISealedSecret,
  AIVendor,
} from '@/types';
import { createSharedCache } from '@/lib/cache/shared.server';
import {
  applySourceToModel,
  buildManagedApiUrl,
  DEFAULT_AI_TRANSPORT,
  getModelUsageType,
  getOrderedModelSources,
  sortModelSources,
} from '@/lib/ai/source-runtime';
import { isThinkingFormat, normalizeThinkingLevels } from '@/lib/ai/thinking';
import { systemDb } from '@/lib/db/context.server';

interface DBGatewayRow {
  id: string;
  gateway_key: string;
  display_name: string | null;
  base_url: string | null;
  api_key_secret: AISealedSecret | null;
  transport?: string | null;
  is_enabled?: boolean | null;
}

interface DBModelGatewayBindingRow {
  id?: string;
  model_id_override: string | null;
  reasoning_model_id: string | null;
  is_enabled: boolean;
  priority?: number | null;
  gateway: DBGatewayRow;
}

interface DBModelRow {
  id?: string;
  model_key: string;
  display_name: string;
  vendor: string;
  usage_type?: string;
  credit_cost?: number | null;
  supports_reasoning: boolean;
  is_reasoning_default: boolean;
  supports_vision: boolean;
  default_temperature: number | string | null;
  default_top_p?: number | string | null;
  default_presence_penalty?: number | string | null;
  default_frequency_penalty?: number | string | null;
  default_max_tokens: number | null;
  default_reasoning_effort?: AIModelConfig['defaultReasoningEffort'] | null;
  thinking_format: string;
  thinking_levels: string[] | null;
  context_window: number | null;
  custom_parameters?: Record<string, unknown> | null;
  required_tier?: string;
  reasoning_required_tier?: string | null;
  bindings?: DBModelGatewayBindingRow[];
}

const DB_CACHE_TTL_MS = 5 * 60 * 1000;
// Sources carry the gateway key only as ciphertext, so the shared (Redis) copy never holds a usable key.
const dbModelsCache = createSharedCache<AIModelConfig[]>({
  name: 'ai-models',
  ttlMs: DB_CACHE_TTL_MS,
});

const numberOrUndefined = (value: number | string | null | undefined) =>
  value != null ? Number.parseFloat(String(value)) : undefined;

function buildSourcesForModel(row: DBModelRow): AIModelSourceConfig[] {
  const usageType = getModelUsageType({
    usageType: row.usage_type as AIModelConfig['usageType'],
    supportsVision: row.supports_vision ?? false,
  });

  const sources = (row.bindings || []).map((binding): AIModelSourceConfig => ({
    sourceKey: binding.gateway.gateway_key,
    sourceName: binding.gateway.display_name || binding.gateway.gateway_key,
    gatewayId: binding.gateway.id,
    apiUrl: buildManagedApiUrl(binding.gateway.base_url, usageType),
    apiKeySecret: binding.gateway.api_key_secret,
    modelIdOverride: binding.model_id_override || row.model_key,
    reasoningModelId: binding.reasoning_model_id || undefined,
    transport: (binding.gateway.transport as AIModelConfig['transport']) || DEFAULT_AI_TRANSPORT,
    priority: binding.priority ?? undefined,
    isEnabled: binding.is_enabled !== false && binding.gateway.is_enabled !== false,
  }));

  return sortModelSources(sources).map((source, index) => ({
    ...source,
    isActive: index === 0,
  }));
}

function mapDbModelRows(rows: DBModelRow[]): AIModelConfig[] {
  return rows.map((row) => {
    const sources = buildSourcesForModel(row);
    const thinkingLevels = normalizeThinkingLevels(row.thinking_levels);

    const baseModel: AIModelConfig = {
      id: row.model_key,
      name: row.display_name,
      vendor: row.vendor as AIVendor,
      usageType: row.usage_type as AIModelConfig['usageType'],
      creditCost: row.credit_cost == null ? undefined : Number(row.credit_cost),
      modelId: row.model_key,
      apiUrl: '',
      supportsReasoning: row.supports_reasoning,
      isReasoningDefault: row.is_reasoning_default,
      supportsVision: row.supports_vision,
      thinkingFormat: isThinkingFormat(row.thinking_format) ? row.thinking_format : 'openai',
      thinkingLevels,
      ...(row.context_window ? { contextWindow: row.context_window } : {}),
      defaultTemperature: numberOrUndefined(row.default_temperature),
      defaultTopP: numberOrUndefined(row.default_top_p),
      defaultPresencePenalty: numberOrUndefined(row.default_presence_penalty),
      defaultFrequencyPenalty: numberOrUndefined(row.default_frequency_penalty),
      defaultMaxTokens: row.default_max_tokens ?? undefined,
      defaultReasoningEffort: row.default_reasoning_effort ?? undefined,
      customParameters: (row.custom_parameters as Record<string, unknown> | null) ?? null,
      requiredTier: row.required_tier as AIModelConfig['requiredTier'],
      reasoningRequiredTier: row.reasoning_required_tier as AIModelConfig['reasoningRequiredTier'],
      transport: DEFAULT_AI_TRANSPORT,
      sources,
    };

    if (sources.length === 0) {
      return baseModel;
    }

    return applySourceToModel(baseModel, sources[0]);
  });
}

async function loadModelsFromDB(): Promise<AIModelConfig[]> {
  const db = systemDb();
  const rows: DBModelRow[] = await db.tx(async (trx) => {
      const models = await trx
        .selectFrom('ai_models')
        .select([
          'id', 'model_key', 'display_name', 'vendor', 'usage_type', 'credit_cost',
          'supports_reasoning', 'is_reasoning_default', 'supports_vision',
          'default_temperature', 'default_top_p', 'default_presence_penalty',
          'default_frequency_penalty', 'default_max_tokens', 'default_reasoning_effort',
          'thinking_format', 'thinking_levels', 'context_window', 'custom_parameters', 'required_tier',
          'reasoning_required_tier',
        ])
        .where('is_enabled', '=', true)
        .orderBy('sort_order', 'asc')
        .execute();
      if (!models.length) return [];
      const bindings = await trx
        .selectFrom('ai_model_gateway_bindings as binding')
        .innerJoin('ai_gateways as gateway', 'gateway.id', 'binding.gateway_id')
        .select([
          'binding.model_id', 'binding.model_id_override', 'binding.reasoning_model_id',
          'binding.is_enabled', 'binding.priority', 'binding.id',
          'gateway.id as gateway_id', 'gateway.gateway_key', 'gateway.display_name', 'gateway.base_url',
          'gateway.api_key_secret', 'gateway.transport', 'gateway.is_enabled as gateway_enabled',
        ])
        .where('binding.model_id', 'in', models.map((model) => model.id))
        .orderBy('binding.priority', 'asc')
        .execute();
      const grouped = new Map<string, DBModelGatewayBindingRow[]>();
      for (const binding of bindings) {
        const list = grouped.get(binding.model_id) ?? [];
        list.push({
          id: binding.id,
          model_id_override: binding.model_id_override,
          reasoning_model_id: binding.reasoning_model_id,
          is_enabled: binding.is_enabled,
          priority: binding.priority,
          gateway: {
            id: binding.gateway_id,
            gateway_key: binding.gateway_key,
            display_name: binding.display_name,
            base_url: binding.base_url,
            api_key_secret: binding.api_key_secret as AISealedSecret | null,
            transport: binding.transport,
            is_enabled: binding.gateway_enabled,
          },
        });
        grouped.set(binding.model_id, list);
      }
      // The row mapper normalizes nullable database defaults.
      return models.map((model) => ({ ...model, bindings: grouped.get(model.id) ?? [] })) as unknown as DBModelRow[];
    });

  return mapDbModelRows(rows);
}

export async function getModelsAsync(): Promise<AIModelConfig[]> {
  return dbModelsCache.load(loadModelsFromDB);
}

export async function getModelsByUsageTypeAsync(
  usageType: NonNullable<AIModelConfig['usageType']>
): Promise<AIModelConfig[]> {
  const models = await getModelsAsync();
  return models.filter((model) => getModelUsageType(model) === usageType);
}

export async function getDefaultModelConfigAsync(
  usageType: NonNullable<AIModelConfig['usageType']> = 'chat'
): Promise<AIModelConfig | undefined> {
  const models = await getModelsByUsageTypeAsync(usageType);
  return models.find((model) => getOrderedModelSources(model).length > 0);
}

export async function getModelConfigAsync(
  modelId: string
): Promise<AIModelConfig | undefined> {
  const models = await getModelsAsync();
  const direct = models.find((model) => model.id === modelId);
  if (direct) return direct;
  if (modelId === 'deepseek-chat' || modelId === 'deepseek') {
    return models.find((model) => model.id === 'deepseek-v3.2');
  }
  return undefined;
}

export function clearModelCache(): void {
  void dbModelsCache.invalidate();
  console.info('[ai-config/server] Model cache cleared');
}
