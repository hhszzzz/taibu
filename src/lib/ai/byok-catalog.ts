import type { AIVendor } from '@/types';
import { getVendorName } from '@/lib/ai/vendor-labels';

export type ByokProviderKey = AIVendor | 'other';

export interface ByokCatalogModel {
  id: string;
  name: string;
  vendor: AIVendor;
}

export interface ByokProviderOption {
  key: ByokProviderKey;
  label: string;
  defaultApiUrl: string | null;
  models: Array<{ id: string; name: string }>;
}

export const OTHER_BYOK_PROVIDER_KEY = 'other' as const;

type ByokProviderPreset = {
  key: AIVendor;
  label: string;
  defaultApiUrl: string;
  aliases?: string[];
  preferredModelIds: string[];
  fallbackModel: { id: string; name: string };
};

const PROVIDER_DEFAULT_API_URLS: Partial<Record<string, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  xai: 'https://api.x.ai/v1',
  minimax: 'https://api.minimax.io/v1',
};

const BYOK_PROVIDER_PRESETS: ByokProviderPreset[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.openai!,
    preferredModelIds: ['gpt-5.4'],
    fallbackModel: { id: 'gpt-5.4', name: 'ChatGPT 5.4' },
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.anthropic!,
    preferredModelIds: ['claude-opus-4-6'],
    fallbackModel: { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  },
  {
    key: 'gemini',
    label: 'Google',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.gemini!,
    aliases: ['google'],
    preferredModelIds: ['gemini-3.1-pro-preview', 'gemini-3.1-pro'],
    fallbackModel: { id: 'gemini-3.1-pro-preview', name: 'Gemini 3 Pro' },
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.deepseek!,
    preferredModelIds: ['deepseek-reasoner', 'deepseek-chat'],
    fallbackModel: { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  },
  {
    key: 'glm',
    label: 'GLM',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.glm!,
    preferredModelIds: ['glm-5.1', 'GLM-5.1'],
    fallbackModel: { id: 'glm-5.1', name: 'GLM-5.1' },
  },
  {
    key: 'qwen',
    label: 'Qwen',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.qwen!,
    preferredModelIds: ['qwen3-max', 'qwen-max'],
    fallbackModel: { id: 'qwen3-max', name: 'Qwen3-Max' },
  },
  {
    key: 'moonshot',
    label: 'Kimi',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.moonshot!,
    preferredModelIds: ['kimi-k2.5', 'kimi-k2-5'],
    fallbackModel: { id: 'kimi-k2.5', name: 'Kimi K2.5' },
  },
  {
    key: 'xai',
    label: 'xAI',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.xai!,
    preferredModelIds: ['grok-4.20', 'grok-4.20-reasoning', 'grok-4.2'],
    fallbackModel: { id: 'grok-4.20', name: 'Grok 4.20' },
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    defaultApiUrl: PROVIDER_DEFAULT_API_URLS.minimax!,
    preferredModelIds: ['MiniMax-M2.7'],
    fallbackModel: { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
  },
];

const BYOK_PROVIDER_LABELS = new Map<string, string>(
  BYOK_PROVIDER_PRESETS.flatMap((preset) => [
    [preset.key, preset.label],
    ...(preset.aliases ?? []).map((alias) => [alias, preset.label] as const),
  ]),
);

function dedupeModels(models: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const next: Array<{ id: string; name: string }> = [];
  for (const model of models) {
    const normalizedId = model.id.trim();
    if (!normalizedId || seen.has(normalizedId)) continue;
    seen.add(normalizedId);
    next.push({
      id: normalizedId,
      name: model.name.trim() || normalizedId,
    });
  }
  return next;
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function selectPreferredModel(
  models: Array<{ id: string; name: string }>,
  preferredModelIds: string[],
): { id: string; name: string } | null {
  const preferredIds = new Set(preferredModelIds.map((item) => normalizeModelId(item)));
  return models.find((model) => preferredIds.has(normalizeModelId(model.id))) ?? null;
}

export function normalizeByokProviderKey(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return '';
  if (normalized === 'google') return 'gemini';
  return normalized;
}

export function isOtherByokProviderKey(value: string | null | undefined): value is typeof OTHER_BYOK_PROVIDER_KEY {
  return value === OTHER_BYOK_PROVIDER_KEY;
}

export function getByokProviderLabel(providerKey: string | null | undefined, explicitLabel?: string | null): string {
  if (!providerKey || isOtherByokProviderKey(providerKey)) {
    return '其他';
  }
  const normalized = normalizeByokProviderKey(providerKey);
  const presetLabel = BYOK_PROVIDER_LABELS.get(normalized);
  const explicit = explicitLabel?.trim();

  if (!presetLabel) {
    return explicit || getVendorName(normalized);
  }

  if (!explicit) {
    return presetLabel;
  }

  const originalVendorLabel = getVendorName(providerKey.trim());
  const normalizedVendorLabel = getVendorName(normalized);
  if (explicit === originalVendorLabel || explicit === normalizedVendorLabel) {
    return presetLabel;
  }

  return explicit;
}

export function buildByokProviderOptions(models: ByokCatalogModel[]): ByokProviderOption[] {
  const grouped = new Map<string, Array<{ id: string; name: string }>>();

  for (const model of models) {
    const vendor = normalizeByokProviderKey(model.vendor);
    if (!vendor) continue;
    const current = grouped.get(vendor) ?? [];
    current.push({ id: model.id, name: model.name });
    grouped.set(vendor, current);
  }

  const providers: ByokProviderOption[] = BYOK_PROVIDER_PRESETS.map((preset) => {
    const mappedModels = dedupeModels(grouped.get(preset.key) ?? []);
    const selectedModel = selectPreferredModel(mappedModels, preset.preferredModelIds) ?? preset.fallbackModel;
    return {
      key: preset.key,
      label: preset.label,
      defaultApiUrl: preset.defaultApiUrl,
      models: [selectedModel],
    } satisfies ByokProviderOption;
  });

  providers.push({
    key: OTHER_BYOK_PROVIDER_KEY,
    label: '其他',
    defaultApiUrl: null,
    models: [],
  });

  return providers;
}
