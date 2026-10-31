/**
 * models.dev 目录的纯函数部分（浏览器与服务端共用）：
 * 把 api.json 的一个模型记录整理成可填入模型编辑器的建议，并按模型 ID 排序匹配。
 *
 * 目录本身由 models.dev 社区维护；这里只取上下文窗口、默认输出上限、思考等级与图片能力，
 * 不覆盖管理端手填的来源网关、密钥或自定义参数。
 */
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';

/** models.dev 模型中我们关心的字段（api.json 的原始结构）。 */
export interface ModelsDevModelRecord {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
  reasoning_options?: unknown;
  attachment?: unknown;
  modalities?: { input?: unknown } | null;
  limit?: { context?: unknown; output?: unknown } | null;
}

export interface ModelsDevProviderRecord {
  name?: unknown;
  models?: Record<string, ModelsDevModelRecord> | null;
}

export type ModelsDevCatalog = Record<string, ModelsDevProviderRecord>;

export interface ModelsDevSuggestion {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  thinkingLevels: AIReasoningEffort[];
  vision: boolean;
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

/** 一个目录模型的建议；没有上下文和输出上限的记录没有可填内容，直接丢弃。 */
export function modelsDevSuggestion(
  provider: string,
  providerName: string,
  modelId: string,
  record: ModelsDevModelRecord,
): ModelsDevSuggestion | null {
  const contextWindow = positive(record.limit?.context);
  const maxTokens = positive(record.limit?.output);
  if (!contextWindow && !maxTokens) return null;
  return {
    id: typeof record.id === 'string' && record.id ? record.id : modelId,
    name: typeof record.name === 'string' && record.name ? record.name : modelId,
    provider,
    providerName,
    contextWindow,
    maxTokens,
    reasoning: record.reasoning === true,
    thinkingLevels: thinkingLevelsOf(record),
    vision: visionOf(record),
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
