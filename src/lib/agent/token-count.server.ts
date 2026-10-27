import 'server-only';
import { createHash } from 'node:crypto';
import type { AIModelConfig } from '@/types';
import { isModelAvailable, MODEL_REQUEST_USER_AGENT } from '@/lib/ai/providers/ai-sdk-provider';
import { sourceApiKeyOrNone } from '@/lib/ai/gateway-secrets.server';
import { applySourceToModel, getOrderedModelSources } from '@/lib/ai/source-runtime';
import { estimateTokens } from './token-estimate';

/**
 * 按模型真实计数一段进入上下文的文本：调用模型所在网关的 `POST /v1/messages/count_tokens`。
 * new-api 提供这个接口：上游支持时转发原生计数（Anthropic、DeepSeek、通义、Kimi、智谱等），否则在网关侧用 tokenkit
 * 计数（GPT 系 tiktoken 精确，其余按校准权重），不预扣、不结算、不写消费日志。
 * 计数含消息框架，减去同模型下一个「.」的基线后加回它自己的 1 个 token。
 * 网关没有这个接口（直连厂商、其他网关）或用户自带的直连模型，用同一套 tokenkit 权重在本地估算。
 */

const TIMEOUT_MS = 3000;
/** 网关回 404 / 405 / 501 说明没有这个接口，十分钟内不再问。 */
const UNSUPPORTED_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 500;

const counts = new Map<string, Promise<number | null>>();
const unsupported = new Map<string, number>();

type Fetch = typeof fetch;

async function requestCount(url: string, key: string, model: string, text: string, fetcher: Fetch): Promise<number | null> {
    const response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'user-agent': MODEL_REQUEST_USER_AGENT },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ([404, 405, 501].includes(response.status)) {
        unsupported.set(url, Date.now() + UNSUPPORTED_TTL_MS);
        return null;
    }
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { input_tokens?: unknown } | null;
    return typeof body?.input_tokens === 'number' && body.input_tokens >= 0 ? body.input_tokens : null;
}

function cached(key: string, load: () => Promise<number | null>) {
    let entry = counts.get(key);
    if (!entry) {
        if (counts.size >= CACHE_LIMIT) counts.clear();
        // 失败不留缓存，下一次重新问。
        entry = load().catch(() => null).then(value => { if (value === null) counts.delete(key); return value; });
        counts.set(key, entry);
    }
    return entry;
}

/**
 * 文本在模型上下文里占多少 token。`apiKey` 表示用户自带的直连模型：不替用户向其服务商发计数请求，直接估算。
 * 网关计数失败、超时或网关不支持时回落到估算，所以总能给出数字。
 */
export async function countModelTokens(config: AIModelConfig, text: string, options: { apiKey?: string; fetch?: Fetch } = {}): Promise<number> {
    if (!text) return 0;
    const estimate = () => estimateTokens(config.modelId || config.id, text);
    if (options.apiKey) return estimate();
    const source = getOrderedModelSources(config).map(item => applySourceToModel(config, item)).find(isModelAvailable);
    const key = source && sourceApiKeyOrNone(source);
    if (!source || !key) return estimate();
    const url = `${source.apiUrl.replace(/\/+$/u, '')}/messages/count_tokens`;
    if ((unsupported.get(url) ?? 0) > Date.now()) return estimate();
    const fetcher = options.fetch ?? fetch;
    const prefix = `${url}\n${source.modelId}\n`;
    const baseline = await cached(`${prefix}baseline`, () => requestCount(url, key, source.modelId, '.', fetcher));
    if (baseline === null) return estimate();
    const hash = createHash('sha256').update(text).digest('base64url');
    const total = await cached(prefix + hash, () => requestCount(url, key, source.modelId, text, fetcher));
    return total === null ? estimate() : Math.max(total - baseline + 1, 0);
}

/** 测试用：清掉计数缓存与「网关不支持」的记录。 */
export function resetTokenCountCache() {
    counts.clear();
    unsupported.clear();
}
