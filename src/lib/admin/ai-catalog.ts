/**
 * 模型目录（管理后台「AI 服务」）的共享定义：接口形状、选项文案与校验。浏览器与服务端共用，不含密钥。
 */
import {
    AI_REASONING_EFFORTS,
    type AIModelPricing,
    type AIReasoningEffort,
    type AIUsageType,
} from '@/types';
import { GATEWAY_KEY_PATTERN } from '@/lib/ai/source-runtime';
import { isLobeIconId } from '@/lib/ai/lobe-icons';
import { isReservedModelKey } from '@/lib/byok/config';
import { PROMPT_CACHE_SWITCH } from '@/lib/ai/prompt-cache';
import { normalizeThinkingLevels } from '@/lib/ai/thinking';

export interface AdminGateway {
    id: string;
    gatewayKey: string;
    displayName: string;
    baseUrl: string;
    isEnabled: boolean;
    /** 已保存密钥的提示（如 `sk-…a1b2`）；null 表示还没有密钥。 */
    apiKeyHint: string | null;
    modelCount: number;
}

/** 新建或修改网关。apiKey：字符串 = 换成新密钥，null = 清除，不传 = 保持不变。 */
export interface AdminGatewayInput {
    gatewayKey: string;
    displayName: string;
    baseUrl: string;
    isEnabled: boolean;
    apiKey?: string | null;
}

/** 模型的一个来源：经哪个网关、向上游请求哪个模型；按列表顺序故障转移。 */
export interface AdminModelSource {
    gatewayId: string;
    /** 上游模型 ID；null 表示与模型 ID 相同。 */
    modelIdOverride: string | null;
    isEnabled: boolean;
}

export interface AdminModelInput {
    modelKey: string;
    displayName: string;
    /** 一句话说明，显示在模型选择里；空串表示不显示。 */
    description: string;
    vendor: string;
    /** lobehub 图标 ID；null 表示按供应商显示。 */
    icon: string | null;
    usageType: AIUsageType;
    /** 美元单价：对话与视觉按每百万 token，生图按每张；未定价的模型平台不提供。 */
    pricing: AIModelPricing;
    isEnabled: boolean;
    sortOrder: number;
    supportsVision: boolean;
    isReasoningDefault: boolean;
    /** 勾选的等级即表示支持思考；空数组不发送思考参数。 */
    thinkingLevels: AIReasoningEffort[];
    defaultReasoningEffort: AIReasoningEffort | null;
    contextWindow: number | null;
    /** 模型目录给出的默认输出上限；没有时按上游模型默认处理。 */
    defaultMaxTokens: number | null;
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
    { value: 'embedding', label: '向量' },
    { value: 'rerank', label: '重排' },
    { value: 'image', label: '生图' },
];

export type PriceField = keyof AIModelPricing;

/** 各用途要填的单价：对话按 token，生图按张；向量与重排不计费。 */
export const PRICE_FIELDS: ReadonlyArray<{ key: PriceField; label: string; unit: string; tokens: boolean }> = [
    { key: 'input', label: '输入', unit: '$/百万 token', tokens: true },
    { key: 'output', label: '输出', unit: '$/百万 token', tokens: true },
    { key: 'cacheRead', label: '缓存读取', unit: '$/百万 token', tokens: true },
    { key: 'cacheWrite', label: '缓存写入', unit: '$/百万 token', tokens: true },
    { key: 'image', label: '每张图', unit: '$/张', tokens: false },
];

export function priceFieldsFor(usageType: AIUsageType) {
    if (usageType === 'image') return PRICE_FIELDS.filter(field => !field.tokens);
    return usageType === 'chat' ? PRICE_FIELDS.filter(field => field.tokens) : [];
}

export const EMPTY_PRICING: AIModelPricing = { input: null, output: null, cacheRead: null, cacheWrite: null, image: null };

export const THINKING_LEVEL_LABELS: Record<AIReasoningEffort, string> = {
    minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高',
};

export type LimitPreset = { label: string; tokens: number };
export const CONTEXT_WINDOW_PRESETS: readonly LimitPreset[] = [
    { label: '32K', tokens: 32_000 }, { label: '128K', tokens: 128_000 }, { label: '200K', tokens: 200_000 },
    { label: '256K', tokens: 256_000 }, { label: '1M', tokens: 1_000_000 },
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
/** USD with at most four decimals, as numeric(12,4) keeps it. */
const optionalPrice = (value: unknown): number | null | undefined => {
    const number = optionalNumber(value, 0, 10_000);
    if (number === undefined || number === null) return number;
    const units = number * 10_000;
    return Math.abs(units - Math.round(units)) < 1e-6 ? Math.round(units) / 10_000 : undefined;
};

/** 只保存该用途要填的单价，其余清空。 */
function parsePricing(value: unknown, usageType: AIUsageType): Parsed<AIModelPricing> {
    const source = isRecord(value) ? value : {};
    const pricing: AIModelPricing = { ...EMPTY_PRICING };
    for (const field of priceFieldsFor(usageType)) {
        const price = optionalPrice(source[field.key]);
        if (price === undefined) return { error: `${field.label}单价需要是 0 到 10000 之间的数，最多 4 位小数` };
        pricing[field.key] = price;
    }
    return { value: pricing };
}

export function parseGatewayInput(body: unknown, options: { creating: boolean }): Parsed<AdminGatewayInput> {
    if (!isRecord(body)) return { error: '请求格式错误' };
    const gatewayKey = text(body.gatewayKey);
    if (options.creating && !GATEWAY_KEY_PATTERN.test(gatewayKey)) return { error: '网关标识只能用小写字母、数字、- 和 _，最多 40 个字符' };
    const displayName = text(body.displayName);
    if (!displayName || displayName.length > 60) return { error: '请填写网关名称（不超过 60 个字符）' };
    const baseUrl = normalizeGatewayBaseUrl(text(body.baseUrl));
    if (!baseUrl) return { error: '网关地址需要是 http:// 或 https:// 开头的完整地址' };
    if (body.apiKey !== undefined && body.apiKey !== null && (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 512)) {
        return { error: '密钥格式错误' };
    }
    return {
        value: {
            gatewayKey, displayName, baseUrl,
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
        if ((override?.length ?? 0) > 200) return { error: '上游模型 ID 过长' };
        sources.push({
            gatewayId: item.gatewayId,
            modelIdOverride: override === modelKey ? null : override,
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
    // Conversations name members' own models `byok:<id>`; the old browser-only ones were `custom:<id>`.
    if (isReservedModelKey(modelKey)) return { error: '模型 ID 不能以 byok: 或 custom: 开头' };
    const displayName = text(body.displayName);
    if (!displayName || displayName.length > 80) return { error: '请填写显示名称（不超过 80 个字符）' };
    const description = text(body.description).slice(0, 200);
    const vendor = text(body.vendor);
    if (!vendor || vendor.length > 40) return { error: '请选择或填写供应商' };
    const icon = optionalText(body.icon);
    if (icon !== null && !isLobeIconId(icon)) return { error: '图标不在可选范围内' };
    const usageType = body.usageType ?? 'chat';
    if (!USAGE_TYPES.some(item => item.value === usageType)) return { error: '模型用途无效' };
    const pricing = parsePricing(body.pricing, usageType as AIUsageType);
    if ('error' in pricing) return pricing;
    if (body.thinkingLevels !== undefined && (!Array.isArray(body.thinkingLevels)
        || body.thinkingLevels.some(level => !(AI_REASONING_EFFORTS as readonly unknown[]).includes(level)))) {
        return { error: '思考等级无效' };
    }
    const thinkingLevels = normalizeThinkingLevels(body.thinkingLevels);
    const defaultReasoningEffort = thinkingLevels.length > 0 && body.defaultReasoningEffort ? body.defaultReasoningEffort : null;
    if (defaultReasoningEffort !== null && (!(AI_REASONING_EFFORTS as readonly unknown[]).includes(defaultReasoningEffort)
        || (thinkingLevels.length && !thinkingLevels.includes(defaultReasoningEffort as AIReasoningEffort)))) {
        return { error: '默认思考等级必须是勾选的等级之一' };
    }
    const contextWindow = optionalNumber(body.contextWindow, 1024, 10_000_000, true);
    if (contextWindow === undefined) return { error: '上下文窗口需要是 1024 到 10000000 之间的整数' };
    const defaultMaxTokens = optionalNumber(body.defaultMaxTokens, 1, 1_000_000, true);
    if (defaultMaxTokens === undefined) return { error: '输出上限需要是正整数' };
    if (contextWindow && defaultMaxTokens && defaultMaxTokens >= contextWindow) return { error: '输出上限必须小于上下文窗口' };
    const sortOrder = optionalNumber(body.sortOrder, -100_000, 100_000, true);
    if (sortOrder === undefined) return { error: '排序需要是整数' };
    const customParameters = body.customParameters ?? null;
    if (customParameters !== null && !isRecord(customParameters)) return { error: '自定义参数必须是 JSON 对象' };
    if (customParameters !== null && PROMPT_CACHE_SWITCH in customParameters && typeof customParameters[PROMPT_CACHE_SWITCH] !== 'boolean') {
        return { error: '提示缓存开关必须是 true 或 false' };
    }
    const sources = parseSources(body.sources ?? [], modelKey);
    if ('error' in sources) return sources;
    return {
        value: {
            modelKey, displayName, description, vendor, icon,
            usageType: usageType as AIUsageType,
            pricing: pricing.value,
            isEnabled: body.isEnabled !== false,
            sortOrder: sortOrder ?? 0,
            supportsVision: body.supportsVision === true,
            isReasoningDefault: thinkingLevels.length > 0 && body.isReasoningDefault === true,
            thinkingLevels,
            defaultReasoningEffort: defaultReasoningEffort as AIReasoningEffort | null,
            contextWindow,
            defaultMaxTokens,
            customParameters: customParameters as Record<string, unknown> | null,
            sources: sources.value,
        },
    };
}
