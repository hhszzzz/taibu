/**
 * 模型目录（管理后台「AI 服务」）的共享定义：接口形状、选项文案与校验。浏览器与服务端共用，不含密钥。
 */
import {
    AI_REASONING_EFFORTS,
    type AIReasoningEffort,
    type AIThinkingFormat,
    type AIUsageType,
} from '@/types';
import { GATEWAY_KEY_PATTERN } from '@/lib/ai/source-runtime';
import { isThinkingFormat, normalizeThinkingLevels } from '@/lib/ai/thinking';

export type CatalogTier = 'free' | 'plus' | 'pro';

export interface AdminGateway {
    id: string;
    gatewayKey: string;
    displayName: string;
    baseUrl: string;
    isEnabled: boolean;
    notes: string | null;
    /** 已保存密钥的提示（如 `sk-…a1b2`）；null 表示还没有密钥。 */
    apiKeyHint: string | null;
    modelCount: number;
}

/** 新建或修改网关。apiKey：字符串 = 换成新密钥，null = 清除，不传 = 保持不变。 */
export interface AdminGatewayInput {
    gatewayKey: string;
    displayName: string;
    baseUrl: string;
    notes: string | null;
    isEnabled: boolean;
    apiKey?: string | null;
}

/** 模型的一个来源：经哪个网关、向上游请求哪个模型；按列表顺序故障转移。 */
export interface AdminModelSource {
    gatewayId: string;
    /** 上游模型 ID；null 表示与模型 ID 相同。 */
    modelIdOverride: string | null;
    /** 开启思考时改用的上游模型 ID。 */
    reasoningModelId: string | null;
    isEnabled: boolean;
}

export interface AdminModelInput {
    modelKey: string;
    displayName: string;
    vendor: string;
    description: string | null;
    usageType: AIUsageType;
    /** 生图模型每张图扣除的积分；仅生图用途使用。 */
    creditCost: number;
    isEnabled: boolean;
    sortOrder: number;
    requiredTier: CatalogTier;
    supportsVision: boolean;
    supportsReasoning: boolean;
    isReasoningDefault: boolean;
    reasoningRequiredTier: CatalogTier;
    thinkingFormat: AIThinkingFormat;
    thinkingLevels: AIReasoningEffort[];
    defaultReasoningEffort: AIReasoningEffort | null;
    contextWindow: number | null;
    defaultMaxTokens: number | null;
    defaultTemperature: number | null;
    defaultTopP: number | null;
    defaultPresencePenalty: number | null;
    defaultFrequencyPenalty: number | null;
    customParameters: Record<string, unknown> | null;
    sources: AdminModelSource[];
}

export interface AdminModel extends AdminModelInput {
    id: string;
}

export interface GatewayProbeResult {
    ok: boolean;
    /** 网关返回的模型 ID（最多 500 个），用于选择上游模型。 */
    models: string[];
    latencyMs?: number;
    message?: string;
}

export const USAGE_TYPES: ReadonlyArray<{ value: AIUsageType; label: string }> = [
    { value: 'chat', label: '对话' },
    { value: 'vision', label: '视觉' },
    { value: 'embedding', label: '向量' },
    { value: 'rerank', label: '重排' },
    { value: 'image', label: '生图' },
];

export const TIERS: ReadonlyArray<{ value: CatalogTier; label: string }> = [
    { value: 'free', label: 'Free' },
    { value: 'plus', label: 'Plus' },
    { value: 'pro', label: 'Pro' },
];

export const THINKING_LEVEL_LABELS: Record<AIReasoningEffort, string> = {
    minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高',
};

/** 每种格式写进请求体的字段，与 Agent（pi-ai）发送的一致。 */
export const THINKING_FORMAT_OPTIONS: ReadonlyArray<{ value: AIThinkingFormat; label: string; fields: string }> = [
    { value: 'openai', label: 'OpenAI', fields: 'reasoning_effort' },
    { value: 'deepseek', label: 'DeepSeek', fields: 'thinking.type + reasoning_effort' },
    { value: 'openrouter', label: 'OpenRouter', fields: 'reasoning.effort' },
    { value: 'qwen', label: '通义 / DashScope', fields: 'enable_thinking + reasoning_effort' },
    { value: 'zai', label: '智谱 GLM', fields: 'thinking.type' },
    { value: 'qwen-chat-template', label: 'vLLM / SGLang', fields: 'chat_template_kwargs.enable_thinking' },
];

export type LimitPreset = { label: string; tokens: number };
export const CONTEXT_WINDOW_PRESETS: readonly LimitPreset[] = [
    { label: '32K', tokens: 32_000 }, { label: '128K', tokens: 128_000 }, { label: '200K', tokens: 200_000 },
    { label: '256K', tokens: 256_000 }, { label: '1M', tokens: 1_000_000 },
];
export const MAX_OUTPUT_PRESETS: readonly LimitPreset[] = [
    { label: '4K', tokens: 4_096 }, { label: '8K', tokens: 8_192 }, { label: '16K', tokens: 16_384 },
    { label: '32K', tokens: 32_768 }, { label: '64K', tokens: 65_536 },
];

/** 1000000 → 1M，131072 → 128K，32768 → 32K。 */
export function formatTokenCount(tokens: number | null | undefined): string {
    if (!tokens) return '—';
    if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`;
    if (tokens % 1000 === 0) return `${tokens / 1000}K`;
    if (tokens % 1024 === 0) return `${tokens / 1024}K`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/u, '')}K`;
    return String(tokens);
}

/** 只认 http(s) 地址；结尾的斜杠去掉，便于比对。 */
export function normalizeGatewayBaseUrl(value: string): string | null {
    const trimmed = value.trim().replace(/\/+$/u, '');
    try {
        const url = new URL(trimmed);
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? trimmed : null;
    } catch {
        return null;
    }
}

type Parsed<T> = { value: T } | { error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const optionalText = (value: unknown) => text(value) || null;
const optionalNumber = (value: unknown, min: number, max: number, integer = false): number | null | undefined => {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return undefined;
    return number;
};
const tier = (value: unknown, fallback: CatalogTier): CatalogTier | undefined =>
    value === undefined ? fallback : TIERS.some(item => item.value === value) ? value as CatalogTier : undefined;

export function parseGatewayInput(body: unknown, options: { creating: boolean }): Parsed<AdminGatewayInput> {
    if (!isRecord(body)) return { error: '请求格式错误' };
    const gatewayKey = text(body.gatewayKey);
    if (options.creating && !GATEWAY_KEY_PATTERN.test(gatewayKey)) return { error: '网关标识只能用小写字母、数字、- 和 _，最多 40 个字符' };
    const displayName = text(body.displayName);
    if (!displayName || displayName.length > 60) return { error: '请填写网关名称（不超过 60 个字符）' };
    const baseUrl = normalizeGatewayBaseUrl(text(body.baseUrl));
    if (!baseUrl) return { error: '网关地址需要是 http:// 或 https:// 开头的完整地址' };
    const notes = optionalText(body.notes);
    if (notes && notes.length > 500) return { error: '备注不能超过 500 个字符' };
    if (body.apiKey !== undefined && body.apiKey !== null && (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 512)) {
        return { error: '密钥格式错误' };
    }
    return {
        value: {
            gatewayKey, displayName, baseUrl, notes,
            isEnabled: body.isEnabled !== false,
            ...(body.apiKey === undefined ? {} : { apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : null }),
        },
    };
}

function parseSources(value: unknown, modelKey: string): Parsed<AdminModelSource[]> {
    if (!Array.isArray(value) || value.length > 8) return { error: '来源格式错误' };
    const sources: AdminModelSource[] = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item.gatewayId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(item.gatewayId)) return { error: '来源格式错误' };
        if (sources.some(source => source.gatewayId === item.gatewayId)) return { error: '同一个网关只能添加一次' };
        const override = optionalText(item.modelIdOverride);
        const reasoning = optionalText(item.reasoningModelId);
        if ((override?.length ?? 0) > 200 || (reasoning?.length ?? 0) > 200) return { error: '上游模型 ID 过长' };
        sources.push({
            gatewayId: item.gatewayId,
            modelIdOverride: override === modelKey ? null : override,
            reasoningModelId: reasoning,
            isEnabled: item.isEnabled !== false,
        });
    }
    return { value: sources };
}

/** 完整校验一个模型；客户端保存前与服务端写入前用同一份规则。 */
export function parseModelInput(body: unknown): Parsed<AdminModelInput> {
    if (!isRecord(body)) return { error: '请求格式错误' };
    const modelKey = text(body.modelKey);
    if (!modelKey || modelKey.length > 200 || /\s/u.test(modelKey)) return { error: '模型 ID 不能为空，也不能含空格' };
    const displayName = text(body.displayName);
    if (!displayName || displayName.length > 80) return { error: '请填写显示名称（不超过 80 个字符）' };
    const vendor = text(body.vendor);
    if (!vendor || vendor.length > 40) return { error: '请选择或填写供应商' };
    const usageType = body.usageType ?? 'chat';
    if (!USAGE_TYPES.some(item => item.value === usageType)) return { error: '模型用途无效' };
    const creditCost = optionalNumber(body.creditCost, 0, 1000, true);
    if (creditCost === undefined) return { error: '每张图积分需要是 0 到 1000 之间的整数' };
    const requiredTier = tier(body.requiredTier, 'free');
    const reasoningRequiredTier = tier(body.reasoningRequiredTier, 'plus');
    if (!requiredTier || !reasoningRequiredTier) return { error: '会员等级无效' };
    const thinkingFormat = body.thinkingFormat ?? 'openai';
    if (!isThinkingFormat(thinkingFormat)) return { error: '思考参数格式无效' };
    if (body.thinkingLevels !== undefined && (!Array.isArray(body.thinkingLevels)
        || body.thinkingLevels.some(level => !(AI_REASONING_EFFORTS as readonly unknown[]).includes(level)))) {
        return { error: '思考等级无效' };
    }
    const supportsReasoning = body.supportsReasoning === true;
    const thinkingLevels = supportsReasoning ? normalizeThinkingLevels(body.thinkingLevels) : [];
    const defaultReasoningEffort = supportsReasoning && body.defaultReasoningEffort ? body.defaultReasoningEffort : null;
    if (defaultReasoningEffort !== null && (!(AI_REASONING_EFFORTS as readonly unknown[]).includes(defaultReasoningEffort)
        || (thinkingLevels.length && !thinkingLevels.includes(defaultReasoningEffort as AIReasoningEffort)))) {
        return { error: '默认思考等级必须是勾选的等级之一' };
    }
    const contextWindow = optionalNumber(body.contextWindow, 1024, 10_000_000, true);
    if (contextWindow === undefined) return { error: '上下文窗口需要是 1024 到 10000000 之间的整数' };
    const defaultMaxTokens = optionalNumber(body.defaultMaxTokens, 1, 1_000_000, true);
    if (defaultMaxTokens === undefined) return { error: '最大输出需要是正整数' };
    if (contextWindow && defaultMaxTokens && defaultMaxTokens >= contextWindow) return { error: '最大输出必须小于上下文窗口' };
    const sortOrder = optionalNumber(body.sortOrder, -100_000, 100_000, true);
    if (sortOrder === undefined) return { error: '排序需要是整数' };
    const sampling = {
        defaultTemperature: optionalNumber(body.defaultTemperature, 0, 2),
        defaultTopP: optionalNumber(body.defaultTopP, 0, 1),
        defaultPresencePenalty: optionalNumber(body.defaultPresencePenalty, -2, 2),
        defaultFrequencyPenalty: optionalNumber(body.defaultFrequencyPenalty, -2, 2),
    };
    if (Object.values(sampling).some(value => value === undefined)) return { error: '采样参数超出范围' };
    const customParameters = body.customParameters ?? null;
    if (customParameters !== null && !isRecord(customParameters)) return { error: '自定义参数必须是 JSON 对象' };
    const sources = parseSources(body.sources ?? [], modelKey);
    if ('error' in sources) return sources;
    const description = optionalText(body.description);
    if ((description?.length ?? 0) > 500) return { error: '描述不能超过 500 个字符' };
    return {
        value: {
            modelKey, displayName, vendor, description,
            usageType: usageType as AIUsageType,
            creditCost: creditCost ?? 1,
            isEnabled: body.isEnabled !== false,
            sortOrder: sortOrder ?? 0,
            requiredTier, reasoningRequiredTier,
            supportsVision: body.supportsVision === true || usageType === 'vision',
            supportsReasoning,
            isReasoningDefault: supportsReasoning && body.isReasoningDefault === true,
            thinkingFormat,
            thinkingLevels,
            defaultReasoningEffort: defaultReasoningEffort as AIReasoningEffort | null,
            contextWindow, defaultMaxTokens,
            defaultTemperature: sampling.defaultTemperature ?? null,
            defaultTopP: sampling.defaultTopP ?? null,
            defaultPresencePenalty: sampling.defaultPresencePenalty ?? null,
            defaultFrequencyPenalty: sampling.defaultFrequencyPenalty ?? null,
            customParameters: customParameters as Record<string, unknown> | null,
            sources: sources.value,
        },
    };
}
