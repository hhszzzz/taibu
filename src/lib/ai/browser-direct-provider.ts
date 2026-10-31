import type { CustomProviderRequest } from '@/types';
import { buildCustomProviderChatCompletionsUrl } from '@/lib/ai/custom-provider-url';

export type BrowserDirectContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

export interface BrowserDirectMessage {
    role: 'system' | 'user' | 'assistant';
    /** 纯文本，或 OpenAI 兼容的图文分段（图片为 data URL）。 */
    content: string | BrowserDirectContentPart[];
}

export interface BrowserDirectResult {
    content: string;
    reasoning: string | null;
}

export interface BrowserDirectStreamOptions {
    provider: CustomProviderRequest;
    messages: BrowserDirectMessage[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onContentDelta?: (delta: string) => void;
    onReasoningDelta?: (delta: string) => void;
}

export class BrowserDirectProviderError extends Error {
    status: number;
    code: string;

    constructor(message: string, options?: { status?: number; code?: string }) {
        super(message);
        this.name = 'BrowserDirectProviderError';
        this.status = options?.status ?? 500;
        this.code = options?.code ?? 'DIRECT_PROVIDER_ERROR';
    }
}

function readTextLike(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }
                if (!item || typeof item !== 'object') {
                    return '';
                }
                const block = item as { text?: unknown; content?: unknown };
                if (typeof block.text === 'string') {
                    return block.text;
                }
                if (typeof block.content === 'string') {
                    return block.content;
                }
                return '';
            })
            .join('');
    }

    if (value && typeof value === 'object') {
        const block = value as { text?: unknown; content?: unknown };
        if (typeof block.text === 'string') {
            return block.text;
        }
        if (typeof block.content === 'string') {
            return block.content;
        }
    }

    return '';
}

function extractChoiceData(payload: unknown): { contentDelta: string; reasoningDelta: string; finishReason?: string | null } {
    if (!payload || typeof payload !== 'object') {
        return { contentDelta: '', reasoningDelta: '' };
    }

    const parsed = payload as {
        choices?: Array<{
            delta?: Record<string, unknown>;
            message?: Record<string, unknown>;
            finish_reason?: string | null;
            text?: unknown;
        }>;
        error?: { message?: unknown; code?: unknown } | string;
    };

    if (parsed.error) {
        const message = typeof parsed.error === 'string'
            ? parsed.error
            : (typeof parsed.error.message === 'string' ? parsed.error.message : '自定义模型服务返回错误');
        const code = typeof parsed.error === 'object' && parsed.error && typeof parsed.error.code === 'string'
            ? parsed.error.code
            : 'DIRECT_PROVIDER_ERROR';
        throw new BrowserDirectProviderError(message, { code });
    }

    const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
    if (!firstChoice) {
        return { contentDelta: '', reasoningDelta: '' };
    }

    const delta = firstChoice.delta ?? firstChoice.message ?? {};
    const contentDelta = readTextLike(
        delta.content
        ?? firstChoice.text,
    );
    const reasoningDelta = readTextLike(
        delta.reasoning_content
        ?? delta.reasoning
        ?? delta.reasoningContent
        ?? delta.reasoning_text,
    );

    return {
        contentDelta,
        reasoningDelta,
        finishReason: firstChoice.finish_reason,
    };
}

async function toProviderError(response: Response): Promise<BrowserDirectProviderError> {
    let payloadMessage = '';

    try {
        const data = await response.clone().json() as {
            error?: { message?: unknown } | string;
            message?: unknown;
        };
        if (typeof data.error === 'string') {
            payloadMessage = data.error;
        } else if (data.error && typeof data.error.message === 'string') {
            payloadMessage = data.error.message;
        } else if (typeof data.message === 'string') {
            payloadMessage = data.message;
        }
    } catch {
        try {
            payloadMessage = (await response.text()).trim();
        } catch {
            payloadMessage = '';
        }
    }

    if (response.status === 401) {
        return new BrowserDirectProviderError('模型认证失败，请检查 API Key 是否正确', {
            status: 401,
            code: 'AUTH_FAILED',
        });
    }

    if (response.status === 429) {
        return new BrowserDirectProviderError('模型请求过于频繁，请稍后重试', {
            status: 429,
            code: 'RATE_LIMITED',
        });
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
        return new BrowserDirectProviderError('当前模型服务暂时不可用，请稍后重试', {
            status: response.status,
            code: 'UPSTREAM_UNAVAILABLE',
        });
    }

    return new BrowserDirectProviderError(
        payloadMessage || `自定义模型服务请求失败（${response.status}）`,
        { status: response.status, code: 'REQUEST_FAILED' },
    );
}

export function normalizeBrowserDirectError(error: unknown): BrowserDirectProviderError {
    if (error instanceof BrowserDirectProviderError) {
        return error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
        return new BrowserDirectProviderError('请求已取消', {
            status: 499,
            code: 'ABORTED',
        });
    }

    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            return new BrowserDirectProviderError('请求已取消', {
                status: 499,
                code: 'ABORTED',
            });
        }

        if (
            error instanceof TypeError
            || /Failed to fetch|Load failed|NetworkError|fetch/i.test(error.message)
        ) {
            return new BrowserDirectProviderError(
                '直连请求失败，请确认目标地址可访问且已开启浏览器跨域访问（CORS）',
                { status: 0, code: 'CORS_OR_NETWORK' },
            );
        }

        return new BrowserDirectProviderError(error.message || '自定义模型服务请求失败', {
            code: 'REQUEST_FAILED',
        });
    }

    return new BrowserDirectProviderError('自定义模型服务请求失败', {
        code: 'REQUEST_FAILED',
    });
}

export function buildBrowserDirectMessages(
    systemPrompt: string,
    messages: Array<Pick<BrowserDirectMessage, 'role' | 'content'>>,
): BrowserDirectMessage[] {
    const normalizedMessages = messages
        .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
            role: message.role as BrowserDirectMessage['role'],
            content: message.content,
        }));

    return systemPrompt.trim().length > 0
        ? [{ role: 'system', content: systemPrompt }, ...normalizedMessages]
        : normalizedMessages;
}

export async function streamBrowserDirectProvider(
    options: BrowserDirectStreamOptions,
): Promise<BrowserDirectResult> {
    const { provider, messages, temperature = 0.7, maxTokens, signal, onContentDelta, onReasoningDelta } = options;
    const response = await fetch(buildCustomProviderChatCompletionsUrl(provider.apiUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream, application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
            model: provider.modelId,
            messages,
            stream: true,
            temperature,
            ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
        }),
        signal,
    });

    if (!response.ok) {
        throw await toProviderError(response);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const payload = await response.json();
        const { contentDelta, reasoningDelta } = extractChoiceData(payload);
        if (contentDelta) {
            onContentDelta?.(contentDelta);
        }
        if (reasoningDelta) {
            onReasoningDelta?.(reasoningDelta);
        }
        return {
            content: contentDelta,
            reasoning: reasoningDelta || null,
        };
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new BrowserDirectProviderError('无法读取自定义模型响应流', {
            code: 'INVALID_RESPONSE',
        });
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) {
                    continue;
                }

                const data = trimmed.replace(/^data:\s*/, '');
                if (!data || data === '[DONE]') {
                    continue;
                }

                const parsed = JSON.parse(data) as unknown;
                const { contentDelta, reasoningDelta } = extractChoiceData(parsed);
                if (reasoningDelta) {
                    reasoning += reasoningDelta;
                    onReasoningDelta?.(reasoningDelta);
                }
                if (contentDelta) {
                    content += contentDelta;
                    onContentDelta?.(contentDelta);
                }
            }
        }

        const tail = decoder.decode();
        if (tail) {
            buffer += tail;
        }
        if (buffer.trim().startsWith('data:')) {
            const data = buffer.trim().replace(/^data:\s*/, '');
            if (data && data !== '[DONE]') {
                const parsed = JSON.parse(data) as unknown;
                const { contentDelta, reasoningDelta } = extractChoiceData(parsed);
                if (reasoningDelta) {
                    reasoning += reasoningDelta;
                    onReasoningDelta?.(reasoningDelta);
                }
                if (contentDelta) {
                    content += contentDelta;
                    onContentDelta?.(contentDelta);
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        content,
        reasoning: reasoning || null,
    };
}
