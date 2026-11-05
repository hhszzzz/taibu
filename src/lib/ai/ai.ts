/**
 * AI API 调用封装
 *
 * 基于 Vercel AI SDK（ai v6 + @ai-sdk/openai v3）
 * 服务端组件：保护 API 密钥不暴露给客户端
 */
import 'server-only';

import type { AIModelConfig } from '@/types';
import { BASE_SYSTEM_PROMPT } from './base-prompt';
import {
    type AIRequestMessage,
    createModelFromConfig,
    isModelAvailable,
    toCoreMessages,
    callWithAISDK,
    streamWithAISDK,
} from './providers';
import { DEFAULT_MODEL_ID } from './ai-config';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { applySourceToModel, getOrderedModelSources } from './source-runtime';
import type { TokenUsage } from '@/lib/billing/pricing';
// ===== 流式转换辅助函数 =====

const SSE_ENCODER = new TextEncoder();

/**
 * 将 AI SDK fullStream 转换为统一 SSE 事件协议。
 *
 * fullStream 中的 chunk 包含 type 字段（text-delta / reasoning-delta / error 等），
 * 此处仅转发与文本生成相关的事件。
 */
function fullStreamToSSE(fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown; finishReason?: string }>): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async start(controller) {
            const emit = (data: Record<string, unknown>) =>
                controller.enqueue(SSE_ENCODER.encode(`data: ${JSON.stringify(data)}\n\n`));
            try {
                for await (const chunk of fullStream) {
                    if (chunk.type === 'text-delta') {
                        emit({ type: 'text-delta', delta: chunk.text });
                    } else if (chunk.type === 'reasoning-delta') {
                        emit({ type: 'reasoning-delta', delta: chunk.text });
                    } else if (chunk.type === 'error') {
                        // AI SDK fullStream 使用 chunk.error (unknown)，非 errorText
                        const errorMsg = typeof chunk.error === 'string'
                            ? chunk.error
                            : chunk.error instanceof Error ? chunk.error.message : '请求失败';
                        emit({ type: 'error', error: errorMsg });
                    } else if (chunk.type === 'finish' && (chunk.finishReason === 'error' || chunk.finishReason === 'content-filter')) {
                        emit({ type: 'error', error: chunk.finishReason === 'content-filter' ? '内容被安全过滤' : '模型返回错误' });
                    }
                }
                controller.enqueue(SSE_ENCODER.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        }
    });
}

// ===== API 调用函数 =====

export interface AICallOptions {
    abortSignal?: AbortSignal;
    beforeModelAttempt?: () => Promise<void>;
    reasoning?: boolean;  // 开启推理模式
    reasoningEffort?: import('@/types').AIReasoningEffort | null;
    temperature?: number;
    maxTokens?: number;
    imageBase64?: string;
    imageMimeType?: string;
    // 覆盖默认系统提示词（用于普通对话与各模块自定义提示）：发送时间写在用户消息开头，系统提示词不随分钟变化
    systemPromptOverride?: string;
    /** The conversation this call belongs to; its hash becomes prompt_cache_key when the model opts in. */
    conversationId?: string;
    /** The member this call belongs to; the key covers it, so one member never shares another's partition. */
    cacheScope?: string;
    /** Receives what the call used, for billing; absent when nobody pays for the call. */
    onUsage?: (report: AIUsageReport) => void | Promise<void>;
}

/** One platform call's usage, priced by the model that served it; `estimated` when the provider reported none. */
export type AIUsageReport = { model: AIModelConfig; usage: TokenUsage; estimated: boolean };

function usageSink(options: AICallOptions | undefined, model: AIModelConfig) {
    const onUsage = options?.onUsage;
    return onUsage ? { onUsage: (usage: TokenUsage, estimated: boolean) => onUsage({ model, usage, estimated }) } : {};
}

export interface AICallResult {
    content: string;
    reasoning?: string;
}

async function runWithSourceFallback<T>(
    config: AIModelConfig,
    run: (runtimeConfig: AIModelConfig) => Promise<T>
): Promise<T> {
    const sources = getOrderedModelSources(config);
    if (sources.length === 0) {
        throw new Error(`No AI sources configured for model: ${config.id}`);
    }

    let lastError: unknown = null;

    for (const source of sources.slice(0, 3)) {
        const runtimeConfig = applySourceToModel(config, source);

        if (!isModelAvailable(runtimeConfig)) {
            continue;
        }

        try {
            const result = await run(runtimeConfig);
            return result;
        } catch (error) {
            if ((error as { code?: string })?.code === 'MODEL_ATTEMPT_BLOCKED' || (error as Error)?.name === 'AbortError') throw error;
            console.warn(`[ai] source=${source.sourceKey} model=${config.id} failed:`, error instanceof Error ? error.message : error);
            lastError = error;
        }
    }

    throw lastError ?? new Error(`No available AI sources for model: ${config.id}`);
}

function buildSystemPrompt(
    chartContext: string,
    options?: AICallOptions
): string {
    return (options?.systemPromptOverride ?? BASE_SYSTEM_PROMPT)
        + chartContext;
}

async function resolveModelConfigForCall(
    modelId: string | undefined,
    options?: { requireVision?: boolean }
): Promise<AIModelConfig | undefined> {
    const requestedModelId = modelId?.trim() || '';
    if (requestedModelId) {
        return await getModelConfigAsync(requestedModelId);
    }
    return await getDefaultModelConfigAsync('chat', options);
}

/** One source's attempt: the resolved runtime config and what a request to it needs. */
type PreparedModelCall = {
    runtimeConfig: AIModelConfig;
    model: ReturnType<typeof createModelFromConfig>;
    coreMessages: ReturnType<typeof toCoreMessages>;
    systemPrompt: string;
    reasoning: boolean | undefined;
};

/**
 * Resolves the model and runs `run` against the first source that answers. Every call variant shares this, so the
 * reasoning flag and the request options mean the same on each path.
 */
async function withModelCall<T>(
    messages: AIRequestMessage[],
    modelId: string,
    chartContext: string,
    options: AICallOptions | undefined,
    run: (call: PreparedModelCall) => Promise<T>,
    resolution: { requireVision?: boolean; image?: { imageBase64?: string; imageMimeType?: string } } = {},
): Promise<T> {
    const config = await resolveModelConfigForCall(modelId, { requireVision: resolution.requireVision });
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        return await run({
            runtimeConfig, model, systemPrompt, reasoning,
            coreMessages: toCoreMessages(messages, resolution.image),
        });
    });
}

/**
 * 统一的 AI 调用接口（非流式）
 */
export async function callAI(
    messages: AIRequestMessage[],
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    return await withModelCall(messages, modelId, chartContext, options, async ({ runtimeConfig, model, coreMessages, systemPrompt, reasoning }) => {
        try { await options?.beforeModelAttempt?.(); } catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : '模型调用被阻止'), { code: 'MODEL_ATTEMPT_BLOCKED' }); }
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            abortSignal: options?.abortSignal,
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
            ...usageSink(options, runtimeConfig),
        });
        return result.text;
    });
}

/**
 * 流式调用 AI API
 *
 * 内部使用 AI SDK streamText()，输出转换为统一 SSE 事件协议
 */
async function callAIStream(
    messages: AIRequestMessage[],
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<ReadableStream<Uint8Array>> {
    return await withModelCall(messages, modelId, chartContext, options, async ({ runtimeConfig, model, coreMessages, systemPrompt, reasoning }) => {
        const result = await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            abortSignal: options?.abortSignal,
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
            ...usageSink(options, runtimeConfig),
        });
        return fullStreamToSSE(result.fullStream);
    });
}

/**
 * 直接返回 AI SDK stream result（主要用于 chat 路由）。
 */
export async function callAIUIMessageResult(
    messages: AIRequestMessage[],
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<Awaited<ReturnType<typeof streamWithAISDK>>> {
    return await withModelCall(messages, modelId, chartContext, options, async ({ runtimeConfig, model, coreMessages, systemPrompt, reasoning }) => {
        return await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            abortSignal: options?.abortSignal,
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
            ...usageSink(options, runtimeConfig),
        });
    });
}

export async function callAIVision(
    messages: AIRequestMessage[],
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    return await withModelCall(messages, modelId, chartContext, options, async ({ runtimeConfig, model, coreMessages, systemPrompt, reasoning }) => {
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
            ...usageSink(options, runtimeConfig),
        });
        return result.text;
    }, {
        requireVision: true,
        image: { imageBase64: options?.imageBase64, imageMimeType: options?.imageMimeType },
    });
}

/**
 * 从统一 SSE 流中读取完整内容。
 */
export async function readAIStream(stream: ReadableStream<Uint8Array>): Promise<AICallResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') continue;
            try {
                const parsed = JSON.parse(dataStr);
                if (parsed?.type === 'reasoning-delta' && typeof parsed.delta === 'string') {
                    reasoning += parsed.delta;
                }
                if (parsed?.type === 'text-delta' && typeof parsed.delta === 'string') {
                    content += parsed.delta;
                }
            } catch {
                // ignore malformed stream chunk
            }
        }
    }

    return { content, reasoning: reasoning || undefined };
}

/**
 * 统一的 AI 调用接口（返回推理过程）
 */
export async function callAIWithReasoning(
    messages: AIRequestMessage[],
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<AICallResult> {
    const config = await resolveModelConfigForCall(modelId);
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const shouldStream = !!options?.reasoning || !!config.isReasoningDefault;
    if (!shouldStream) {
        const content = await callAI(messages, modelId, chartContext, options);
        return { content };
    }

    const stream = await callAIStream(messages, chartContext, modelId, options);
    return await readAIStream(stream);
}
