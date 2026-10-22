import 'server-only';

import type {
  AIModelConfig,
  AIModelSourceConfig,
  AIVendor,
} from '@/types';
import { buildModels, clearModelCache as clearSharedModelCache } from '@/lib/ai/ai-config';
import { createSharedCache } from '@/lib/cache/shared.server';
import {
  applySourceToModel,
  buildManagedApiUrl,
  DEFAULT_AI_TRANSPORT,
  getModelUsageType,
  getOrderedModelSources,
  isManagedSourceKey,
  sortModelSources,
} from '@/lib/ai/source-runtime';
import { systemDb } from '@/lib/db/context.server';

interface DBGatewayRow {
  gateway_key: string | null;
  display_name: string | null;
  base_url: string | null;
  api_key_env_var: string | null;
  transport?: string | null;
  is_enabled?: boolean | null;
}

interface DBModelGatewayBindingRow {
  id?: string;
  model_id_override: string | null;
  reasoning_model_id: string | null;
  is_enabled: boolean;
  priority?: number | null;
  notes?: string | null;
  gateway?: DBGatewayRow | DBGatewayRow[] | null;
}

interface DBModelRow {
  id?: string;
  model_key: string;
  display_name: string;
  vendor: string;
  usage_type?: string;
  routing_mode?: string;
  supports_reasoning: boolean;
  is_reasoning_default: boolean;
  supports_vision: boolean;
  default_temperature: number | string | null;
  default_top_p?: number | string | null;
  default_presence_penalty?: number | string | null;
  default_frequency_penalty?: number | string | null;
  default_max_tokens: number | null;
  default_reasoning_effort?: AIModelConfig['defaultReasoningEffort'] | null;
  reasoning_effort_format?: AIModelConfig['reasoningEffortFormat'] | null;
  custom_parameters?: Record<string, unknown> | null;
  required_tier?: string;
  reasoning_required_tier?: string | null;
  bindings?: DBModelGatewayBindingRow[];
}

const DB_CACHE_TTL_MS = 5 * 60 * 1000;
const dbModelsCache = createSharedCache<AIModelConfig[]>({
  name: 'ai-models',
  ttlMs: DB_CACHE_TTL_MS,
});
import { IS_NODE_TEST_RUNTIME } from '@/lib/runtime';

function pickGateway(input: DBModelGatewayBindingRow['gateway']): DBGatewayRow | null {
  if (Array.isArray(input)) {
    return input[0] ?? null;
  }
  return input ?? null;
}

function buildSourcesForModel(row: DBModelRow): AIModelSourceConfig[] {
  const usageType = getModelUsageType({
    usageType: row.usage_type as AIModelConfig['usageType'],
    supportsVision: row.supports_vision ?? false,
  });

  const mappedSources = (row.bindings || [])
    .map((binding): AIModelSourceConfig | null => {
      const gateway = pickGateway(binding.gateway);
      if (!gateway || !isManagedSourceKey(gateway.gateway_key)) {
        return null;
      }

      return {
        sourceKey: gateway.gateway_key,
        sourceName: gateway.display_name || gateway.gateway_key,
        apiUrl: buildManagedApiUrl(gateway.base_url, usageType),
        apiKeyEnvVar: gateway.api_key_env_var || '',
        modelIdOverride: binding.model_id_override || row.model_key,
        reasoningModelId: binding.reasoning_model_id || undefined,
        transport: (gateway.transport as AIModelConfig['transport']) || DEFAULT_AI_TRANSPORT,
        priority: binding.priority ?? undefined,
        isEnabled: binding.is_enabled !== false && gateway.is_enabled !== false,
      };
    })
    .filter((source): source is AIModelSourceConfig => source !== null);

  return sortModelSources(mappedSources).map((source, index) => ({
    ...source,
    isActive: index === 0,
  }));
}

function mapDbModelRows(rows: DBModelRow[]): AIModelConfig[] {
  return rows.map((row) => {
    const sources = buildSourcesForModel(row);

    const baseModel: AIModelConfig = {
      id: row.model_key,
      name: row.display_name,
      vendor: row.vendor as AIVendor,
      usageType: row.usage_type as AIModelConfig['usageType'],
      routingMode: row.routing_mode as AIModelConfig['routingMode'],
      modelId: row.model_key,
      apiUrl: '',
      apiKeyEnvVar: '',
      supportsReasoning: row.supports_reasoning,
      isReasoningDefault: row.is_reasoning_default,
      supportsVision: row.supports_vision,
      defaultTemperature:
        row.default_temperature != null
          ? Number.parseFloat(String(row.default_temperature))
          : undefined,
      defaultTopP:
        row.default_top_p != null
          ? Number.parseFloat(String(row.default_top_p))
          : undefined,
      defaultPresencePenalty:
        row.default_presence_penalty != null
          ? Number.parseFloat(String(row.default_presence_penalty))
          : undefined,
      defaultFrequencyPenalty:
        row.default_frequency_penalty != null
          ? Number.parseFloat(String(row.default_frequency_penalty))
          : undefined,
      defaultMaxTokens: row.default_max_tokens ?? undefined,
      defaultReasoningEffort: row.default_reasoning_effort ?? undefined,
      reasoningEffortFormat: row.reasoning_effort_format ?? undefined,
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

function hasAvailableSource(model: AIModelConfig): boolean {
  return getOrderedModelSources(model).some((source) => {
    if (!source.apiUrl || !source.apiKeyEnvVar) {
      return false;
    }
    return !!process.env[source.apiKeyEnvVar];
  });
}

async function loadModelsFromDB(): Promise<AIModelConfig[]> {
  const db = systemDb();
  const rows: DBModelRow[] = await db.tx(async (trx) => {
      const models = await trx
        .selectFrom('ai_models')
        .select([
          'id', 'model_key', 'display_name', 'vendor', 'usage_type', 'routing_mode',
          'supports_reasoning', 'is_reasoning_default', 'supports_vision',
          'default_temperature', 'default_top_p', 'default_presence_penalty',
          'default_frequency_penalty', 'default_max_tokens', 'default_reasoning_effort',
          'reasoning_effort_format', 'custom_parameters', 'required_tier',
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
          'binding.is_enabled', 'binding.priority', 'binding.notes', 'binding.id',
          'gateway.gateway_key', 'gateway.display_name', 'gateway.base_url',
          'gateway.api_key_env_var', 'gateway.transport', 'gateway.is_enabled as gateway_enabled',
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
          notes: binding.notes,
          gateway: {
            gateway_key: binding.gateway_key,
            display_name: binding.display_name,
            base_url: binding.base_url,
            api_key_env_var: binding.api_key_env_var,
            transport: binding.transport,
            is_enabled: binding.gateway_enabled,
          },
        });
        grouped.set(binding.model_id, list);
      }
      // The row interface mirrors the former PostgREST projection; nullable
      // database defaults are flattened there.
      return models.map((model) => ({ ...model, bindings: grouped.get(model.id) ?? [] })) as unknown as DBModelRow[];
    });

  return mapDbModelRows(rows);
}

async function fetchModelsFromDB(): Promise<AIModelConfig[] | null> {
  try {
    return await dbModelsCache.load(loadModelsFromDB);
  } catch (error) {
    if (!IS_NODE_TEST_RUNTIME) {
      console.warn('[ai-config/server] Database unavailable, fallback to env models:', error);
    }
    return null;
  }
}

export async function getModelsAsync(): Promise<AIModelConfig[]> {
  const dbModels = await fetchModelsFromDB();
  if (dbModels !== null) {
    return dbModels;
  }
  return buildModels();
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
  return models.find((model) => hasAvailableSource(model));
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
  clearSharedModelCache();
  void dbModelsCache.invalidate();
  console.info('[ai-config/server] Model cache cleared');
}
