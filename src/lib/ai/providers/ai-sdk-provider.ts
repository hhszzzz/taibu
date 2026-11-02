/**
 * AI SDK Provider 适配层
 *
 * 基于 Vercel AI SDK（ai v6 + @ai-sdk/openai v3）
 * 替换原有的 openai-compatible.ts / vision-provider.ts
 */

import { createOpenAI } from '@ai-sdk/openai';
// @ts-expect-error TS Cannot find module 'ai' due to Next.js 15 bundler resolution in CLI tsc
import { generateText, streamText, type CoreMessage, type ImageModel, type LanguageModel, type ProviderOptions, type JSONValue } from 'ai';
import type { AIModelConfig } from '@/types';
import type { ChatMessage, AIReasoningEffort } from '@/types';
import { normalizeGatewayBaseUrl } from '@/lib/ai/gateway-url';
import { resolveSourceApiKey } from '@/lib/ai/gateway-secrets.server';
import { resolveThinkingLevel, thinkingRequestFields, THINKING_REQUEST_FIELDS } from '@/lib/ai/thinking';
import { PROMPT_CACHE_SWITCH } from '@/lib/ai/prompt-cache';
import { modelPromptCacheKey } from '@/lib/ai/prompt-cache.server';
import { estimateUsage, hasTokens, tokenUsageOf, type TokenUsage } from '@/lib/billing/pricing';
import packageJson from '../../../../package.json';

// AI 请求只需要最小消息结构，避免强制依赖存储/展示字段。
export type AIRequestMessage = Pick<ChatMessage, 'role' | 'content' | 'model' | 'reasoning'>;

export interface AIProviderOptions {
    temperature?: number;
    maxTokens?: number;
    reasoning?: boolean;
    reasoningEffort?: AIReasoningEffort;
    imageBase64?: string;
    imageMimeType?: string;
    abortSignal?: AbortSignal;
    /** The conversation this request belongs to; its hash becomes the model's prompt cache key. */
    conversationId?: string;
    /** The member the request belongs to. It is part of the key, so cache partitions never mix members. */
    cacheScope?: string;
    /** Receives what the call used, once; counted locally when the provider reported nothing. */
    onUsage?: (usage: TokenUsage, estimated: boolean) => void | Promise<void>;
}

/**
 * 根据 AIModelConfig 动态创建 AI SDK provider 实例和模型
 *
 * 没有传入 apiKey 时，使用当前来源网关保存的密钥（请求时才解开）。
 */
export function createModelFromConfig(
    config: AIModelConfig,
    options?: { reasoning?: boolean; reasoningEffort?: AIReasoningEffort; apiKey?: string; fetch?: typeof globalThis.fetch },
): LanguageModel {
    const apiKey = options?.apiKey ?? resolveSourceApiKey(config);
    if (!apiKey) {
        throw new Error(`${config.name || config.id} 的网关没有保存密钥`);
    }

    const baseURL = normalizeBaseUrl(config.apiUrl);
    const requestParameters = buildModelRequestParameters(config, options);
    // 平台网关与用户自己的模型服务都收到同一个 User-Agent。
    const baseFetch = withModelUserAgent(options?.fetch ?? gatewayFetch);
    const provider = createOpenAI({
        apiKey,
        baseURL,
        fetch: Object.keys(requestParameters).length ? async (input, init) => {
            if (typeof init?.body !== 'string') return baseFetch(input, init);
            const body = JSON.parse(init.body) as Record<string, unknown>;
            return baseFetch(input, { ...init, body: JSON.stringify({ ...body, ...requestParameters }) });
        } : baseFetch,
    });

    // For OpenAI-compatible gateways (NewAPI/Octopus), use chat-completions mode.
    return provider.chat(config.modelId);
}

/**
 * 生图模型：同样的网关地址与密钥，`generateImage` 会把 `/images/generations` 拼在 baseURL 后面。
 * 平台网关与用户自己的模型服务都收到同一个 User-Agent。
 */
export function createImageModelFromConfig(
    config: AIModelConfig,
    options?: { apiKey?: string; fetch?: typeof globalThis.fetch },
): ImageModel {
    const apiKey = options?.apiKey ?? resolveSourceApiKey(config);
    if (!apiKey) {
        throw new Error(`${config.name || config.id} 的网关没有保存密钥`);
    }
    const provider = createOpenAI({
        apiKey,
        baseURL: normalizeBaseUrl(config.apiUrl),
        fetch: withModelUserAgent(options?.fetch ?? gatewayFetch),
    });
    return provider.image(config.modelId);
}

/**
 * 检查模型配置是否可用：当前来源有地址，且网关保存了密钥
 */
export function isModelAvailable(config: AIModelConfig): boolean {
    return !!config.apiUrl && !!config.gatewayId && !!config.apiKeySecret;
}

/**
 * 将 AIRequestMessage 转换为 AI SDK CoreMessage 格式
 */
export function toCoreMessages(
    messages: AIRequestMessage[],
    options?: { imageBase64?: string; imageMimeType?: string },
): CoreMessage[] {
    // system role 通过 streamText/generateText 的 system 参数传递，不放入 messages 数组
    return messages.filter(msg => msg.role !== 'system').map((msg, index, filtered) => {
        // Vision: 在最后一条用户消息中添加图片
        if (
            msg.role === 'user' &&
            options?.imageBase64 &&
            index === filtered.length - 1
        ) {
            return {
                role: 'user' as const,
                content: [
                    {
                        type: 'image' as const,
                        image: `data:${options.imageMimeType || 'image/jpeg'};base64,${options.imageBase64}`,
                    },
                    {
                        type: 'text' as const,
                        text: msg.content,
                    },
                ],
            };
        }

        return {
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
        };
    });
}

// Keep the SDK-generated transcript, tools and output budget authoritative.
const RESERVED_MODEL_BODY_FIELDS = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', PROMPT_CACHE_SWITCH, '__proto__', 'constructor', 'prototype']);
const SDK_BODY_NAMES: Record<string, string> = { reasoningEffort: 'reasoning_effort', logitBias: 'logit_bias', topLogprobs: 'top_logprobs', parallelToolCalls: 'parallel_tool_calls', serviceTier: 'service_tier', maxCompletionTokens: 'max_completion_tokens', maxTokens: 'max_tokens', maxOutputTokens: 'max_completion_tokens' };

/**
 * Compatible gateways accept provider extensions that the OpenAI SDK schema omits. Thinking is written by the model's
 * thinking format (the same fields the Agent sends), never by custom parameters.
 */
function buildModelRequestParameters(config: AIModelConfig, options?: Pick<AIProviderOptions, 'reasoning' | 'reasoningEffort'>) {
    const parameters: Record<string, JSONValue> = {};
    for (const [key, value] of Object.entries(config.customParameters ?? {})) {
        const name = Object.hasOwn(SDK_BODY_NAMES, key) ? SDK_BODY_NAMES[key] : key;
        if (!RESERVED_MODEL_BODY_FIELDS.has(name) && !THINKING_REQUEST_FIELDS.has(name)) parameters[name] = value as JSONValue;
    }
    if (options?.reasoning === undefined) return parameters;
    return { ...parameters, ...thinkingRequestFields(config, options.reasoning ? resolveThinkingLevel(config, options.reasoningEffort) : null) };
}

/**
 * 构建 AI SDK 调用的 provider-specific 选项
 */
export function buildProviderOptions(
    config: AIModelConfig,
    options?: AIProviderOptions,
): ProviderOptions | undefined {
    const parameters = buildModelRequestParameters(config, options);
    const providerOptions = Object.fromEntries(Object.entries(parameters).map(([name, value]) => [
        Object.keys(SDK_BODY_NAMES).find(key => SDK_BODY_NAMES[key] === name) ?? name, value,
    ]));

    // max is a Pi/provider extension; the Chat Completions SDK only validates through xhigh.
    // The existing model fetch adapter sends the actual value to the compatible gateway.
    if (providerOptions.reasoningEffort === 'max') delete providerOptions.reasoningEffort;

    // Off by default: only a model that opts in and a request that names its conversation send the key.
    const cacheKey = modelPromptCacheKey(config, options?.conversationId, options?.cacheScope);
    if (cacheKey) providerOptions.promptCacheKey = cacheKey;

    if (Object.keys(providerOptions).length === 0) return undefined;

    return { openai: providerOptions };
}

function promptText(systemPrompt: string, messages: CoreMessage[]): string {
    return [systemPrompt, ...messages.map(message => typeof message.content === 'string' ? message.content
        : (message.content as Array<{ text?: unknown }>).map(part => typeof part.text === 'string' ? part.text : '').join(''))].join('\n');
}

/** The provider's count, or a local estimate of the prompt and the reply; null when nothing came back. */
function meteredUsage(config: AIModelConfig, systemPrompt: string, messages: CoreMessage[], usage: import('ai').LanguageModelUsage | undefined, output: string) {
    const counted = tokenUsageOf(usage);
    if (hasTokens(counted)) return { usage: counted, estimated: false };
    if (!output) return null;
    return { usage: estimateUsage(config.modelId || config.id, promptText(systemPrompt, messages), output), estimated: true };
}

/**
 * 非流式调用
 */
export async function callWithAISDK(
    model: LanguageModel,
    messages: CoreMessage[],
    systemPrompt: string,
    config: AIModelConfig,
    options?: AIProviderOptions,
): Promise<{ text: string; reasoning?: string; usage?: import('ai').LanguageModelUsage }> {
    const result = await generateText({
        model,
        abortSignal: options?.abortSignal,
        system: systemPrompt,
        messages,
        maxRetries: 0,
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? config.defaultMaxTokens ?? undefined,
        providerOptions: buildProviderOptions(config, options),
    });

    const metered = options?.onUsage && meteredUsage(config, systemPrompt, messages, result.usage, result.text + (result.reasoningText ?? ''));
    if (metered) await options!.onUsage!(metered.usage, metered.estimated);
    return {
        text: result.text,
        reasoning: result.reasoningText ?? undefined,
        usage: result.usage,
    };
}

/**
 * 流式调用 — 返回 AI SDK StreamTextResult
 *
 * 调用方可以使用:
 * - result.toDataStream() 获取 DataStream（用于 chat route 的 toDataStreamResponse）
 * - result.textStream 获取纯文本流
 * - result.fullStream 获取完整事件流
 *
 * 计量的流总会读到结束（consumeStream），客户端断开时用量照样落账；中断或出错时按已产出的文字估算。
 */
export function streamWithAISDK(
    model: LanguageModel,
    messages: CoreMessage[],
    systemPrompt: string,
    config: AIModelConfig,
    options?: AIProviderOptions,
) {
    let output = '';
    let settled = false;
    const settle = async (usage: import('ai').LanguageModelUsage | undefined, final: boolean) => {
        if (settled || !options?.onUsage) return;
        const metered = meteredUsage(config, systemPrompt, messages, usage, output);
        if (!metered && !final) return;
        settled = true;
        if (metered) await options.onUsage(metered.usage, metered.estimated);
    };
    const result = streamText({
        model,
        system: systemPrompt,
        messages,
        abortSignal: options?.abortSignal,
        maxRetries: 0,
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? config.defaultMaxTokens ?? undefined,
        providerOptions: buildProviderOptions(config, options),
        ...(options?.onUsage ? {
            onChunk: ({ chunk }: { chunk: { type: string; text?: string } }) => {
                if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && chunk.text) output += chunk.text;
            },
            onFinish: ({ totalUsage }: { totalUsage: import('ai').LanguageModelUsage }) => settle(totalUsage, true),
            onAbort: () => settle(undefined, true),
            onError: () => settle(undefined, false),
        } : {}),
    });
    if (options?.onUsage) void result.consumeStream();

    return result;
}

// ─── Internal Helpers ───

/**
 * 太卜发出的模型请求一律以 `taibu-agent/<应用版本>` 自报身份，网关日志里认得出是谁、哪个版本在调用。
 * 按 User-Agent 拦截的网关（如上游 CDN 拒绝 Node.js 或 Python 的默认值）把它加入白名单即可，不再冒充浏览器。
 */
export const MODEL_REQUEST_USER_AGENT = `taibu-agent/${packageJson.version}`;

function withModelUserAgent(fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
    return (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('User-Agent', MODEL_REQUEST_USER_AGENT);
        return fetcher(input, { ...init, headers });
    };
}

/** 平台网关的请求头：自报身份，并按是否流式声明 Accept。 */
function normalizeGatewayHeaders(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', MODEL_REQUEST_USER_AGENT);
    if (!headers.has('Accept')) {
        let isStream = true;
        try {
            if (typeof init?.body === 'string') {
                isStream = JSON.parse(init.body).stream !== false;
            }
        } catch { /* default to stream */ }
        headers.set('Accept', isStream ? 'text/event-stream' : 'application/json');
    }
    return headers;
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
    if (signals.length === 1) {
        return signals[0];
    }
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any(signals);
    }

    const controller = new AbortController();
    const abort = (reason?: unknown) => {
        if (!controller.signal.aborted) {
            controller.abort(reason);
        }
    };
    for (const signal of signals) {
        if (signal.aborted) {
            abort(signal.reason);
            break;
        }
        signal.addEventListener('abort', () => abort(signal.reason), { once: true });
    }
    return controller.signal;
}

async function fetchWithGatewayHeaders(
    url: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number,
    connectTimeoutMs?: number,
): Promise<Response> {
    const headers = normalizeGatewayHeaders(init);
    const signalParts: AbortSignal[] = [];
    if (init?.signal) {
        signalParts.push(init.signal);
    }
    if (typeof timeoutMs === 'number' && typeof AbortSignal.timeout === 'function') {
        signalParts.push(AbortSignal.timeout(timeoutMs));
    }

    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectController: AbortController | null = null;
    if (typeof connectTimeoutMs === 'number') {
        connectController = new AbortController();
        connectTimer = setTimeout(() => {
            connectController?.abort(new Error('CONNECT_TIMEOUT'));
        }, connectTimeoutMs);
        connectTimer.unref?.();
        signalParts.push(connectController.signal);
    }

    try {
        return await globalThis.fetch(url, {
            ...init,
            headers,
            signal: signalParts.length > 0 ? mergeAbortSignals(signalParts) : undefined,
        });
    } catch (error) {
        if (connectController?.signal.aborted && connectController.signal.reason instanceof Error) {
            throw connectController.signal.reason;
        }
        throw error;
    } finally {
        if (connectTimer) {
            clearTimeout(connectTimer);
        }
    }
}

/** 平台网关的请求：自报身份、按是否流式声明 Accept。 */
export function gatewayFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    return fetchWithGatewayHeaders(url, init);
}

/**
 * 标准化 baseURL：
 * - AI SDK createOpenAI 内部会拼 /chat/completions
 * - 如果用户配置的 URL 包含完整路径，截掉
 * - 如果 URL 不含 /v1，补上（NewAPI 等网关需要 /v1 前缀）
 */
function normalizeBaseUrl(apiUrl: string): string {
    return normalizeGatewayBaseUrl(apiUrl);
}
