/**
 * models.dev 目录的纯函数部分（浏览器与服务端共用）：
 * 把 api.json 的一个模型记录整理成可填入模型编辑器的建议，并按模型 ID 排序匹配。
 *
 * 目录本身由 models.dev 社区维护；这里只取上下文窗口、默认输出上限、思考等级、图片能力与单价，
 * 不覆盖管理端手填的来源网关、密钥或自定义参数。
 */
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';
import type { AdminModelInput } from '@/lib/admin/ai-catalog';

/** models.dev 模型中我们关心的字段（api.json 的原始结构）。 */
export interface ModelsDevModelRecord {
  id?: unknown;
  name?: unknown;
  /** 经销商条目指向的原厂模型（如 `anthropic/claude-sonnet-4-5`）。 */
  canonical_model_id?: unknown;
  reasoning?: unknown;
  reasoning_options?: unknown;
  attachment?: unknown;
  modalities?: { input?: unknown } | null;
  limit?: { context?: unknown; output?: unknown } | null;
  /** 美元/百万 token。 */
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown } | null;
}

export interface ModelsDevProviderRecord {
  name?: unknown;
  models?: Record<string, ModelsDevModelRecord> | null;
}

export type ModelsDevCatalog = Record<string, ModelsDevProviderRecord>;

/** 美元/百万 token；缓存价可能没有。 */
export type ModelsDevPricing = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

export interface ModelsDevSuggestion {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  canonicalId?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  thinkingLevels: AIReasoningEffort[];
  vision: boolean;
  pricing?: ModelsDevPricing;
}

const PROVIDER_PRIORITY = [
  'openai', 'anthropic', 'google', 'google-vertex', 'deepseek', 'moonshotai', 'moonshotai-cn',
  'zhipuai', 'z-ai', 'alibaba', 'minimax', 'minimax-cn', 'xai', 'meta', 'mistral', 'openrouter',
];

const positive = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
);

/** models.dev 的努力档位名字（low/medium/high/max…）→ 太卜的思考等级。 */
function thinkingLevelsOf(record: ModelsDevModelRecord): AIReasoningEffort[] {
  if (record.reasoning !== true || !Array.isArray(record.reasoning_options)) return [];
  const values = new Set<string>();
  for (const option of record.reasoning_options) {
    if (!option || typeof option !== 'object') continue;
    const entry = option as { type?: unknown; values?: unknown };
    if (entry.type !== 'effort' || !Array.isArray(entry.values)) continue;
    for (const value of entry.values) if (typeof value === 'string') values.add(value.toLowerCase());
  }
  return AI_REASONING_EFFORTS.filter(level => values.has(level));
}

function visionOf(record: ModelsDevModelRecord): boolean {
  const inputs = record.modalities?.input;
  return Array.isArray(inputs) && inputs.includes('image');
}

/** 单价按 numeric(12,4) 取到 4 位小数；负数、超过 10000 或不是数的不要。 */
const price = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000 ? Math.round(value * 10_000) / 10_000 : undefined
);

/** 输入与输出价都有才算定价；缓存价随附。 */
function pricingOf(record: ModelsDevModelRecord): ModelsDevPricing | undefined {
  const input = price(record.cost?.input);
  const output = price(record.cost?.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = price(record.cost?.cache_read);
  const cacheWrite = price(record.cost?.cache_write);
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }), ...(cacheWrite === undefined ? {} : { cacheWrite }) };
}

/** 一个目录模型的建议；上下文、输出上限与单价都没有的记录没有可填内容，直接丢弃。 */
export function modelsDevSuggestion(
  provider: string,
  providerName: string,
  modelId: string,
  record: ModelsDevModelRecord,
): ModelsDevSuggestion | null {
  const contextWindow = positive(record.limit?.context);
  const maxTokens = positive(record.limit?.output);
  const pricing = pricingOf(record);
  if (!contextWindow && !maxTokens && !pricing) return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : modelId,
    name: typeof record.name === 'string' && record.name ? record.name : modelId,
    provider,
    providerName,
    ...(typeof record.canonical_model_id === 'string' && record.canonical_model_id ? { canonicalId: record.canonical_model_id } : {}),
    contextWindow,
    maxTokens,
    reasoning: record.reasoning === true,
    thinkingLevels: thinkingLevelsOf(record),
    vision: visionOf(record),
    ...(pricing ? { pricing } : {}),
  };
}

/** 把整个 api.json 摊平成建议列表（一次解析，之后只做内存匹配）。 */
export function flattenModelsDevCatalog(catalog: ModelsDevCatalog): ModelsDevSuggestion[] {
  const models: ModelsDevSuggestion[] = [];
  for (const [provider, value] of Object.entries(catalog)) {
    if (!value || typeof value !== 'object' || !value.models) continue;
    const providerName = typeof value.name === 'string' && value.name ? value.name : provider;
    for (const [modelId, record] of Object.entries(value.models)) {
      if (!record || typeof record !== 'object') continue;
      const suggestion = modelsDevSuggestion(provider, providerName, modelId, record);
      if (suggestion) models.push(suggestion);
    }
  }
  return models;
}

/** 比较用的归一化：小写、去掉供应商前缀和所有非字母数字。 */
function normalize(value: string): string {
  const tail = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  return tail.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function score(suggestion: ModelsDevSuggestion, query: string): number {
  const needle = normalize(query);
  if (!needle) return 0;
  const id = normalize(suggestion.id);
  const name = normalize(suggestion.name);
  if (id === needle) return 1_000;
  if (name === needle) return 900;
  if (id.startsWith(needle) || needle.startsWith(id)) return 700;
  if (needle.length >= 6 && (id.includes(needle) || needle.includes(id))) return 500;
  if (needle.length >= 4 && (name.includes(needle) || needle.includes(name))) return 300;
  return 0;
}

const providerRank = (provider: string): number => {
  const index = PROVIDER_PRIORITY.indexOf(provider);
  return index === -1 ? PROVIDER_PRIORITY.length : index;
};

/**
 * 按模型 ID 或显示名找目录条目。完全相同的 ID 排在前面，其次是前缀/包含匹配；
 * 同一模型出现在多个供应商时，主流供应商优先。
 */
export function matchModelsDevModels(
  models: readonly ModelsDevSuggestion[],
  query: string,
  limit = 20,
): ModelsDevSuggestion[] {
  if (!query.trim()) return [];
  return models
    .map(model => ({ model, score: score(model, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score
      || providerRank(a.model.provider) - providerRank(b.model.provider)
      || a.model.id.localeCompare(b.model.id))
    .slice(0, limit)
    .map(entry => entry.model);
}

/**
 * 批量补全用的精确匹配：目录条目的 ID（或原厂 ID）、名称与某个候选归一化后完全相同才算，ID 相同优先于名称相同；
 * 同一模型在多个供应商时取主流供应商。前缀与包含一律不算，免得 gpt-4o 拿到 gpt-4o-mini 的价格。
 */
export function exactModelsDevMatch(models: readonly ModelsDevSuggestion[], candidates: readonly string[]): ModelsDevSuggestion | null {
  const needles = new Set(candidates.map(normalize).filter(Boolean));
  if (!needles.size) return null;
  let best: { model: ModelsDevSuggestion; tier: number } | null = null;
  for (const model of models) {
    const tier = needles.has(normalize(model.id)) || (model.canonicalId && needles.has(normalize(model.canonicalId))) ? 0
      : needles.has(normalize(model.name)) ? 1 : -1;
    if (tier < 0) continue;
    if (!best || tier < best.tier || (tier === best.tier && providerRank(model.provider) < providerRank(best.model.provider))) best = { model, tier };
  }
  return best?.model ?? null;
}

/** 勾选了等级时的默认等级：有中档用中档，否则取最高一档。 */
export function defaultThinkingLevel(levels: readonly AIReasoningEffort[]): AIReasoningEffort | null {
  return levels.includes('medium') ? 'medium' : levels.at(-1) ?? null;
}

const PRICE_LABELS = [['input', '输入价'], ['output', '输出价'], ['cacheRead', '缓存读价'], ['cacheWrite', '缓存写价']] as const;

/**
 * 只补空缺：没填的上下文、输出上限、思考等级与单价；图片输入、名称、来源、排序、图标与已填的值都不动。
 * 目录里全为 0 的价格不补（经销商的免费额度不代表平台可以免费提供）。只处理对话模型。
 */
export function planModelsDevFill(model: AdminModelInput, suggestion: ModelsDevSuggestion): { input: AdminModelInput; changes: string[] } {
  const input: AdminModelInput = { ...model, pricing: { ...model.pricing } };
  const changes: string[] = [];
  if (model.usageType !== 'chat') return { input, changes };
  if (input.contextWindow === null && suggestion.contextWindow && suggestion.contextWindow >= 1024 && suggestion.contextWindow <= 10_000_000) {
    input.contextWindow = suggestion.contextWindow;
    changes.push('上下文');
  }
  if (input.defaultMaxTokens === null && suggestion.maxTokens && suggestion.maxTokens <= 1_000_000
    && (!input.contextWindow || suggestion.maxTokens < input.contextWindow)) {
    input.defaultMaxTokens = suggestion.maxTokens;
    changes.push('输出上限');
  }
  if (!input.thinkingLevels.length && suggestion.reasoning && suggestion.thinkingLevels.length) {
    input.thinkingLevels = [...suggestion.thinkingLevels];
    input.defaultReasoningEffort = defaultThinkingLevel(input.thinkingLevels);
    changes.push('思考等级');
  }
  const pricing = suggestion.pricing;
  if (pricing && (pricing.input > 0 || pricing.output > 0)) {
    for (const [field, label] of PRICE_LABELS) {
      const value = pricing[field];
      if (input.pricing[field] !== null || value === undefined) continue;
      input.pricing[field] = value;
      changes.push(label);
    }
  }
  return { input, changes };
}
