/** SSE 流式响应解析（客户端与单测共用）。 */
'use client';

interface ParsedSSEData {
    type?: string;
    delta?: string;
    error?: string;
    errorText?: string;
    conversationId?: string | null;
    metadata?: Record<string, unknown>;
    messageMetadata?: Record<string, unknown>;
}

interface ParsedStreamingSSEFrame {
    contentDelta?: string;
    reasoningDelta?: string;
    error?: string;
    conversationId?: string | null;
    done: boolean;
}

export function parseStreamingSSEData(data: string): ParsedStreamingSSEFrame {
    if (data === '[DONE]') {
        return { done: true };
    }

    try {
        const parsed: ParsedSSEData = JSON.parse(data);
        return {
            contentDelta: parsed.type === 'text-delta' ? parsed.delta : undefined,
            reasoningDelta: parsed.type === 'reasoning-delta' ? parsed.delta : undefined,
            error: typeof parsed.errorText === 'string'
                ? parsed.errorText
                : (typeof parsed.error === 'string' ? parsed.error : undefined),
            conversationId: typeof parsed.conversationId === 'string' ? parsed.conversationId : null,
            done: false,
        };
    } catch {
        return { done: false };
    }
}

/**
 * 检查错误是否为积分不足
 */
export function isCreditsError(error: string | null): boolean {
    if (!error) return false;
    return error.includes('积分不足') || error.includes('充值') || error.includes('获取积分');
}
