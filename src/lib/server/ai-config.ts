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
  getModelUsageType,
  getOrderedModelSources,
  sortModelSources,
} from '@/lib/ai/source-runtime';
import { normalizeThinkingLevels } from '@/lib/ai/thinking';
import { systemDb } from '@/lib/db/context.server';

interface DBGatewayRow {
  id: string;
  gateway_key: string;
  display_name: string | null;
  base_url: string | null;
  api_key_secret: AISealedSecret | null;
  is_enabled?: boolean | null;
}

interface DBModelGatewayBindingRow {
  id?: string;
  model_id_override: string | null;
  is_enabled: boolean;
  priority?: number | null;
  gateway: DBGatewayRow;
}

interface DBModelRow {
  id?: string;
  model_key: string;
  display_name: string;
  vendor: string;
  icon: string | null;
  usage_type?: string;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  image_price: number | null;
  is_reasoning_default: boolean;
  supports_vision: boolean;
  default_max_tokens: number | null;
  default_reasoning_effort?: AIModelConfig['defaultReasoningEffort'] | null;
  thinking_levels: string[] | null;
  context_window: number | null;
  custom_parameters?: Record<string, unknown> | null;
  bindings?: DBModelGatewayBindingRow[];
}

const DB_CACHE_TTL_MS = 5 * 60 * 1000;
// Sources carry the gateway key only as ciphertext, so the shared (Redis) copy never holds a usable key.
const dbModelsCache = createSharedCache<AIModelConfig[]>({
  name: 'ai-models',
  ttlMs: DB_CACHE_TTL_MS,
});

function buildSourcesForModel(row: DBModelRow): AIModelSourceConfig[] {
  const usageType = getModelUsageType({
    usageType: row.usage_type as AIModelConfig['usageType'],
  });

  const sources = (row.bindings || []).map((binding): AIModelSourceConfig => ({
    sourceKey: binding.gateway.gateway_key,
    sourceName: binding.gateway.display_name || binding.gateway.gateway_key,
    gatewayId: binding.gateway.id,
    apiUrl: buildManagedApiUrl(binding.gateway.base_url, usageType),
    apiKeySecret: binding.gateway.api_key_secret,
    modelIdOverride: binding.model_id_override || row.model_key,
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
      icon: row.icon,
      usageType: row.usage_type as AIModelConfig['usageType'],
      pricing: {
        input: row.input_price, output: row.output_price, cacheRead: row.cache_read_price,
        cacheWrite: row.cache_write_price, image: row.image_price,
      },
      modelId: row.model_key,
      apiUrl: '',
      supportsReasoning: thinkingLevels.length > 0,
      isReasoningDefault: row.is_reasoning_default,
      supportsVision: row.supports_vision,
      thinkingLevels,
      ...(row.context_window ? { contextWindow: row.context_window } : {}),
      defaultMaxTokens: row.default_max_tokens ?? undefined,
      defaultReasoningEffort: row.default_reasoning_effort ?? undefined,
      customParameters: (row.custom_parameters as Record<string, unknown> | null) ?? null,
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
          'id', 'model_key', 'display_name', 'vendor', 'icon', 'usage_type',
          'input_price', 'output_price', 'cache_read_price', 'cache_write_price', 'image_price',
          'is_reasoning_default', 'supports_vision',
          'default_max_tokens', 'default_reasoning_effort',
          'thinking_levels', 'context_window', 'custom_parameters',
        ])
        .where('is_enabled', '=', true)
        .orderBy('sort_order', 'asc')
        .execute();
      if (!models.length) return [];
      const bindings = await trx
        .selectFrom('ai_model_gateway_bindings as binding')
        .innerJoin('ai_gateways as gateway', 'gateway.id', 'binding.gateway_id')
        .select([
          'binding.model_id', 'binding.model_id_override',
          'binding.is_enabled', 'binding.priority', 'binding.id',
          'gateway.id as gateway_id', 'gateway.gateway_key', 'gateway.display_name', 'gateway.base_url',
          'gateway.api_key_secret', 'gateway.is_enabled as gateway_enabled',
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
          is_enabled: binding.is_enabled,
          priority: binding.priority,
          gateway: {
            id: binding.gateway_id,
            gateway_key: binding.gateway_key,
            display_name: binding.display_name,
            base_url: binding.base_url,
            api_key_secret: binding.api_key_secret as AISealedSecret | null,
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
  usageType: NonNullable<AIModelConfig['usageType']> = 'chat',
  options?: { requireVision?: boolean },
): Promise<AIModelConfig | undefined> {
  const models = await getModelsByUsageTypeAsync(usageType);
  return models.find((model) => getOrderedModelSources(model).length > 0 && (!options?.requireVision || model.supportsVision));
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
