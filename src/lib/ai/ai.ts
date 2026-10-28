/**
 * AI API 调用封装
 *
 * 基于 Vercel AI SDK（ai v6 + @ai-sdk/openai v3）
 * 服务端组件：保护 API 密钥不暴露给客户端
 */
import 'server-only';

import type { AIPersonality, AIPersonalityConfig, AIModelConfig } from '@/types';
import { AI_PERSONALITY_META } from './personality-meta';
import { METHOD_PRINCIPLES, renderMethodPersona } from 'taibu-core/mcp';
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
import { formatUserTime } from './prompt-time';
import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';
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

// ===== 时间辅助函数 =====

/**
 * 人格提示词前的当前时间，按北京时间写出（服务器时区通常是 UTC）。
 * 格式：当前时间：2026-01-22 21:30 星期四，Asia/Shanghai（UTC+08:00）
 */
function getCurrentTimePrefix(): string {
    return `当前时间：${formatUserTime(new Date(), DEFAULT_DIVINATION_TIMEZONE)}\n\n`;
}

// ===== AI 人格配置 =====

/** 所有人格共享的安全红线，拼接在每个 systemPrompt 末尾 */
const SHARED_SAFETY_RULES = `

## 安全红线
- 信息不足时明确告知「条件不足，无法准确判断」，不编造数据
- 命理/术数仅供参考，强调积极正向的人生观
- 不做恐吓性、绝对化的吉凶判定（如"必死""必离"等）
- 回答须基于提供的数据与理论依据，不凭空臆断`;

/**
 * 有方法卡的人格取卡中的角色、断法与输出要求（不含工具流程，盘面由对话上下文给出），精简版只留角色与输出要求；
 * 完整版附解读通则（证据引用、应期表述、把握度与前后一致）；精简版只留角色与输出规则，给小预算让出盘面空间。
 * 与 Agent、MCP 共用同一来源。
 * 通用、MBTI 与合盘没有方法卡，保留各自的提示词。
 */
const READING_PRINCIPLES = `\n\n## 解读通则\n\n${METHOD_PRINCIPLES}`;
function cardPersonality(personality: AIPersonality, card: string): AIPersonalityConfig {
    return {
        ...AI_PERSONALITY_META[personality],
        systemPrompt: renderMethodPersona(card) + READING_PRINCIPLES + SHARED_SAFETY_RULES,
        // The brief form exists to leave room for the chart at the smallest budgets, so it stays lean.
        briefPrompt: renderMethodPersona(card, true) + SHARED_SAFETY_RULES,
    };
}

export const AI_PERSONALITIES: Record<AIPersonality, AIPersonalityConfig> = {
    bazi: cardPersonality('bazi', 'bazi'),
    ziwei: cardPersonality('ziwei', 'ziwei'),
    dream: cardPersonality('dream', 'dream'),
    mangpai: cardPersonality('mangpai', 'bazi-mangpai'),
    general: {
        ...AI_PERSONALITY_META.general,
        systemPrompt: `你是一位精通多种命理体系的综合分析师，涵盖八字、紫微斗数、六爻、塔罗、奇门遁甲、大六壬等。

## 核心能力
- 根据数据类型自动匹配最佳分析方法
- 多体系交叉验证，寻找共性结论
- 不同体系视角互补，形成立体判断
- 整合多源数据给出统一建议

## 分析框架
1. 识别用户提供的数据类型，选择对应分析方法
2. 分别从各体系角度给出独立结论
3. 交叉验证：标注各体系结论的一致性与差异点
4. 综合权衡，给出最终建议

## 回答风格
- 清晰说明使用了哪些分析方法
- 指出不同方法的结论是否一致
- 差异处给出原因说明
- 给出整合后的可执行建议` + SHARED_SAFETY_RULES,
    },
    tarot: cardPersonality('tarot', 'tarot'),
    liuyao: cardPersonality('liuyao', 'liuyao'),
    mbti: {
        ...AI_PERSONALITY_META.mbti,
        systemPrompt: `你是一位专业的心理学家和 MBTI 性格分析专家，基于迈尔斯-布里格斯类型指标（MBTI）理论体系，融合荣格心理类型学说。

## 核心能力
- 四维度（E/I、S/N、T/F、J/P）的深度解读与百分比分析
- 认知功能栈（主导、辅助、第三、劣势功能）的行为模式推演
- 类型间的互动模式与兼容性分析
- 职业匹配、人际关系与个人成长的专业建议

## 分析框架
1. 类型概述：该类型的核心特征与认知功能栈
2. 维度分析：结合百分比数据的个性化偏好解读
3. 优势与盲点：认知功能带来的天赋与发展空间
4. 职业发展、人际关系与个人成长建议

## 回答风格
- 专业但易懂，避免过多术语堆砌
- 具有鼓励性和建设性，强调每种类型的独特价值
- 注重个体差异，不做刻板归类
- 先给核心洞察，后展开细节` + SHARED_SAFETY_RULES,
    },
    hepan: {
        ...AI_PERSONALITY_META.hepan,
        systemPrompt: `你是一位资深的命理学家和关系咨询师，精通八字合盘分析，熟悉五行生克、十神互映、日主关系等合盘技法。

## 核心能力
- 双方日主五行关系与相生相克判定
- 十神互映：彼此在对方命局中的角色定位
- 合盘维度分析：性格契合、价值观、沟通模式、情感深度
- 冲突预警与化解方案设计

## 分析框架
1. 整体契合度概览与核心关系定位
2. 各维度详细分析：优势互补与潜在摩擦
3. 冲突点识别与化解方法
4. 针对具体关系类型（情侣/商业/亲子）的实用建议
5. 未来发展展望与经营方向

## 回答风格
- 语言温和、建设性，避免过于绝对的论断
- 先给结论，后展开论据
- 注重实用性与可执行性
- 双方视角兼顾，不偏袒一方` + SHARED_SAFETY_RULES,
    },
    qimen: cardPersonality('qimen', 'qimen'),
    daliuren: cardPersonality('daliuren', 'daliuren'),
    meihua: cardPersonality('meihua', 'meihua'),
    xiaoliuren: cardPersonality('xiaoliuren', 'xiaoliuren'),
};

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
    // 覆盖默认人格提示词与时间行（用于各模块自定义系统提示）：对话在用户消息开头写发送时间，系统提示词不随分钟变化
    systemPromptOverride?: string;
    /** The conversation this call belongs to; its hash becomes prompt_cache_key when the model opts in. */
    conversationId?: string;
    /** The member this call belongs to; the key covers it, so one member never shares another's partition. */
    cacheScope?: string;
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
    personality: AIPersonality,
    chartContext: string,
    options?: AICallOptions
): string {
    const personalityConfig = AI_PERSONALITIES[personality];
    return (options?.systemPromptOverride ?? getCurrentTimePrefix() + personalityConfig.systemPrompt)
        + chartContext;
}

async function resolveModelConfigForCall(
    modelId: string | undefined,
    usageType: 'chat' | 'vision'
): Promise<AIModelConfig | undefined> {
    const requestedModelId = modelId?.trim() || '';
    if (requestedModelId) {
        return await getModelConfigAsync(requestedModelId);
    }
    return await getDefaultModelConfigAsync(usageType);
}

/**
 * 统一的 AI 调用接口（非流式）
 */
export async function callAI(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        try { await options?.beforeModelAttempt?.(); } catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : '模型调用被阻止'), { code: 'MODEL_ATTEMPT_BLOCKED' }); }
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            abortSignal: options?.abortSignal,
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
        });
        return result.text;
    });
}

/**
 * 流式调用 AI API
 *
 * 内部使用 AI SDK streamText()，输出转换为统一 SSE 事件协议
 */
export async function callAIStream(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<ReadableStream<Uint8Array>> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        const result = await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
        });
        return fullStreamToSSE(result.fullStream);
    });
}

/**
 * 直接返回 AI SDK stream result（主要用于 chat 路由）。
 */
export async function callAIUIMessageResult(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    chartContext: string = '',
    modelId: string = DEFAULT_MODEL_ID,
    options?: AICallOptions
): Promise<Awaited<ReturnType<typeof streamWithAISDK>>> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);
    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages);
        const result = await streamWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
        });
        return result;
    });
}

export async function callAIVision(
    messages: AIRequestMessage[],
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<string> {
    const config = await resolveModelConfigForCall(modelId, 'vision');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }
    const systemPrompt = buildSystemPrompt(personality, chartContext, options);

    return await runWithSourceFallback(config, async (runtimeConfig) => {
        const reasoning = runtimeConfig.isReasoningDefault || options?.reasoning;
        const model = createModelFromConfig(runtimeConfig, { reasoning, reasoningEffort: options?.reasoningEffort ?? undefined });
        const coreMessages = toCoreMessages(messages, {
            imageBase64: options?.imageBase64,
            imageMimeType: options?.imageMimeType,
        });
        const result = await callWithAISDK(model, coreMessages, systemPrompt, runtimeConfig, {
            reasoning,
            reasoningEffort: options?.reasoningEffort ?? undefined,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            conversationId: options?.conversationId, cacheScope: options?.cacheScope,
        });
        return result.text;
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
    personality: AIPersonality = 'general',
    modelId: string = DEFAULT_MODEL_ID,
    chartContext: string = '',
    options?: AICallOptions
): Promise<AICallResult> {
    const config = await resolveModelConfigForCall(modelId, 'chat');
    if (!config) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const shouldStream = !!options?.reasoning || !!config.isReasoningDefault;
    if (!shouldStream) {
        const content = await callAI(messages, personality, modelId, chartContext, options);
        return { content };
    }

    const stream = await callAIStream(messages, personality, chartContext, modelId, options);
    return await readAIStream(stream);
}
