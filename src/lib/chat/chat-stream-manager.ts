import type { AIMessageMetadata, ChatMessage } from '@/types';
import { saveConversation } from './conversation';

export type ChatStreamTaskStatus = 'running' | 'completed' | 'stopped' | 'failed';

export type ChatStreamTaskErrorCode =
    | 'CONVERSATION_BUSY'
    | 'INSUFFICIENT_BALANCE'
    | 'AUTH_REQUIRED'
    | 'PERSIST_FAILED'
    | 'REQUEST_FAILED'
    | 'NETWORK_ERROR';

export interface ChatStreamTaskSnapshot {
    conversationId: string;
    status: ChatStreamTaskStatus;
    messages: ChatMessage[];
    content: string;
    reasoning: string;
    metadata?: AIMessageMetadata;
    startedAt: number;
    updatedAt: number;
    hasVisibleToken: boolean;
    /** The model the reply was asked of, also when it failed before any text arrived. */
    model?: string;
    modelName?: string;
}

export type ChatStreamEventType =
    | 'task_started'
    | 'task_updated'
    | 'task_completed'
    | 'task_stopped'
    | 'task_failed';

export interface ChatStreamEvent {
    type: ChatStreamEventType;
    task: ChatStreamTaskSnapshot;
    errorCode?: ChatStreamTaskErrorCode;
    errorMessage?: string;
}

export type ChatStreamListener = (event: ChatStreamEvent) => void;

/** 保存前的钩子，可修改最终消息列表（如插入版本历史） */
export type BeforeSaveHook = (finalMessages: ChatMessage[], assistantContent: string) => ChatMessage[];

export interface StartChatStreamTaskParams {
    conversationId: string;
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown>;
    baseMessages: ChatMessage[];
    assistantMessage: ChatMessage;
    /** 保存前的钩子，可修改最终消息列表 */
    onBeforeSave?: BeforeSaveHook;
    runner?: ChatStreamTaskRunner;
}

export type ChatStreamStartResult =
    | { ok: true }
    | { ok: false; code: ChatStreamTaskErrorCode; message: string };

type SaveConversationFn = (conversationId: string, messages: ChatMessage[]) => Promise<boolean>;

type FetcherFn = typeof fetch;

export interface ChatStreamTaskRunnerContext {
    requestHeaders: Record<string, string>;
    requestBody: Record<string, unknown>;
    signal: AbortSignal;
    fetcher: FetcherFn;
    appendContentDelta: (delta: string) => void;
    appendReasoningDelta: (delta: string) => void;
    setMetadata: (metadata: AIMessageMetadata) => void;
}

export type ChatStreamTaskRunner = (context: ChatStreamTaskRunnerContext) => Promise<void>;

/** A runner's failure with the site's HTTP status; its message is what the reader sees. */
export class ChatRunnerError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'ChatRunnerError';
    }
}

interface ChatStreamTaskInternal {
    conversationId: string;
    status: ChatStreamTaskStatus;
    controller: AbortController;
    baseMessages: ChatMessage[];
    assistantMessage: ChatMessage;
    content: string;
    reasoning: string;
    metadata?: AIMessageMetadata;
    reasoningStartTime?: number;
    startedAt: number;
    updatedAt: number;
    hasVisibleToken: boolean;
    cleanupTimer: ReturnType<typeof setTimeout> | null;
    stopRequested: boolean;
    onBeforeSave?: BeforeSaveHook;
    /** 由 handleSseLine 设置，当收到后端结构化错误事件时记录错误信息 */
    sseError?: { code: ChatStreamTaskErrorCode; message: string };
}

interface ChatStreamManagerDeps {
    fetcher?: FetcherFn;
    saveConversation?: SaveConversationFn;
    streamInactivityTimeoutMs?: number;
}

const FINISHED_TASK_TTL_MS = 60 * 1000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;

function stringifyRequestBody(body: Record<string, unknown>): string {
    const seen = new WeakSet<object>();
    try {
        const json = JSON.stringify(body, (_key, value: unknown) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            if (typeof value === 'function' || typeof value === 'symbol') {
                return undefined;
            }
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return undefined;
                }
                seen.add(value);
            }
            return value;
        });
        return json ?? '{}';
    } catch {
        return '{}';
    }
}

export interface ClassifiedApiError {
    code: ChatStreamTaskErrorCode;
    message: string;
}

export function classifyApiError(
    status: number,
    data?: { code?: string; error?: string } | null
): ClassifiedApiError {
    if (status === 402 || data?.code === 'INSUFFICIENT_BALANCE') {
        return {
            code: 'INSUFFICIENT_BALANCE',
            message: data?.error || '余额不足，请充值、兑换或订阅后再试',
        };
    }

    const isAuthRequired = data?.code === 'AUTH_REQUIRED'
        || data?.error?.includes('请先登录') === true
        || data?.error?.includes('登录后再使用') === true;
    if (isAuthRequired) {
        return {
            code: 'AUTH_REQUIRED',
            message: data?.error || '请先登录后再使用 AI 对话',
        };
    }

    return {
        code: 'REQUEST_FAILED',
        message: data?.error || '请求失败',
    };
}

function isAbortError(error: unknown): boolean {
    if (error instanceof DOMException) {
        return error.name === 'AbortError';
    }
    if (error instanceof Error) {
        return error.name === 'AbortError';
    }
    return false;
}

function buildAssistantFromTask(task: ChatStreamTaskInternal, contentOverride?: string): ChatMessage {
    const reasoningDuration = task.reasoningStartTime
        ? Math.max(0, Math.floor((Date.now() - task.reasoningStartTime) / 1000))
        : undefined;

    return {
        ...task.assistantMessage,
        content: contentOverride ?? task.content,
        reasoning: task.reasoning || undefined,
        reasoningStartTime: task.reasoningStartTime,
        reasoningDuration,
        metadata: task.metadata,
    };
}

export class ChatStreamManager {
    private readonly tasks = new Map<string, ChatStreamTaskInternal>();

    private readonly listeners = new Set<ChatStreamListener>();

    private readonly fetcher: FetcherFn;

    private readonly saveConversationFn: SaveConversationFn;

    private readonly streamInactivityTimeoutMs: number;

    constructor(deps: ChatStreamManagerDeps = {}) {
        this.fetcher = deps.fetcher ?? fetch;
        this.saveConversationFn = deps.saveConversation ?? saveConversation;
        this.streamInactivityTimeoutMs = deps.streamInactivityTimeoutMs ?? DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS;
    }

    subscribe(listener: ChatStreamListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    isConversationRunning(conversationId: string): boolean {
        const task = this.tasks.get(conversationId);
        return task?.status === 'running';
    }

    getTaskSnapshot(conversationId: string): ChatStreamTaskSnapshot | null {
        const task = this.tasks.get(conversationId);
        if (!task) return null;
        return this.buildSnapshot(task);
    }

    getTaskMessages(conversationId: string): ChatMessage[] | null {
        return this.getTaskSnapshot(conversationId)?.messages ?? null;
    }

    async startTask(params: StartChatStreamTaskParams): Promise<ChatStreamStartResult> {
        const existing = this.tasks.get(params.conversationId);
        if (existing?.status === 'running') {
            return {
                ok: false,
                code: 'CONVERSATION_BUSY',
                message: '当前会话正在生成中，请稍后再试',
            };
        }

        if (existing?.cleanupTimer) {
            clearTimeout(existing.cleanupTimer);
        }

        const now = Date.now();
        const task: ChatStreamTaskInternal = {
            conversationId: params.conversationId,
            status: 'running',
            controller: new AbortController(),
            baseMessages: [...params.baseMessages],
            assistantMessage: { ...params.assistantMessage },
            content: '',
            reasoning: '',
            metadata: undefined,
            reasoningStartTime: undefined,
            startedAt: now,
            updatedAt: now,
            hasVisibleToken: false,
            cleanupTimer: null,
            stopRequested: false,
            onBeforeSave: params.onBeforeSave,
        };

        this.tasks.set(params.conversationId, task);
        this.emit({ type: 'task_started', task: this.buildSnapshot(task) });

        void this.runTask(task, params);

        return { ok: true };
    }

    stopTask(conversationId: string): void {
        const task = this.tasks.get(conversationId);
        if (!task || task.status !== 'running') return;
        task.stopRequested = true;
        task.controller.abort();
    }

    private async runTask(task: ChatStreamTaskInternal, params: StartChatStreamTaskParams): Promise<void> {
        if (params.runner) {
            try {
                await params.runner({
                    requestHeaders: params.requestHeaders,
                    requestBody: params.requestBody,
                    signal: task.controller.signal,
                    fetcher: this.fetcher,
                    appendContentDelta: (delta) => this.appendContentDelta(task, delta),
                    appendReasoningDelta: (delta) => this.appendReasoningDelta(task, delta),
                    setMetadata: (metadata) => this.setMetadata(task, metadata),
                });

                if (task.sseError) {
                    await this.finishWithStatus(task, 'failed', task.sseError);
                } else {
                    await this.finishCompleted(task);
                }
                return;
            } catch (error) {
                if (isAbortError(error) || task.stopRequested) {
                    await this.finishWithStatus(task, 'stopped');
                    return;
                }
                const classified = this.classifyRunnerError(error);
                await this.finishWithStatus(task, 'failed', classified);
                return;
            }
        }

        const serializedRequest = stringifyRequestBody(params.requestBody);

        let response: Response;
        try {
            response = await this.fetcher.call(globalThis, '/api/chat', {
                method: 'POST',
                headers: params.requestHeaders,
                body: serializedRequest,
                signal: task.controller.signal,
            });
        } catch (error) {
            if (isAbortError(error) || task.stopRequested) {
                await this.finishWithStatus(task, 'stopped');
                return;
            }
            await this.finishWithStatus(task, 'failed', { code: 'NETWORK_ERROR', message: '请求失败，请稍后再试' });
            return;
        }

        if (!response.ok) {
            let data: { code?: string; error?: string } | null = null;
            try {
                data = await response.json() as { code?: string; error?: string };
            } catch {
                // ignore parse errors
            }
            const classified = classifyApiError(response.status, data);
            await this.finishWithStatus(task, 'failed', classified);
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            await this.finishWithStatus(task, 'failed', { code: 'REQUEST_FAILED', message: '服务响应异常' });
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                // 超时保护：连续 N 秒没有收到任何数据，主动中止流
                const readResult = await Promise.race([
                    reader.read(),
                    new Promise<{ done: true; value: undefined }>((_, reject) =>
                        setTimeout(() => reject(new Error('STREAM_TIMEOUT')), this.streamInactivityTimeoutMs)
                    ),
                ]);
                const { done, value } = readResult;
                if (done) break;
                if (!value) continue;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                let shouldBreak = false;
                for (const line of lines) {
                    const signal = this.handleSseLine(task, line);
                    if (signal === 'break') {
                        shouldBreak = true;
                        break;
                    }
                }
                if (shouldBreak) break;
            }

            // 处理尾部残留
            const tail = decoder.decode();
            if (tail) {
                buffer += tail;
            }
            if (buffer.trim().length > 0) {
                this.handleSseLine(task, buffer.trim());
            }

            // 流正常结束前如果收到了结构化错误事件，走失败路径
            if (task.sseError) {
                await this.finishWithStatus(task, 'failed', task.sseError);
            } else {
                await this.finishCompleted(task);
            }
        } catch (error) {
            if (isAbortError(error) || task.stopRequested) {
                await this.finishWithStatus(task, 'stopped');
            } else if (task.sseError) {
                // 后端发送了结构化错误事件，使用其错误码，不覆盖为通用网络错误
                await this.finishWithStatus(task, 'failed', task.sseError);
            } else if (error instanceof Error && error.message === 'STREAM_TIMEOUT') {
                task.controller.abort();
                await this.finishWithStatus(task, 'failed', { code: 'NETWORK_ERROR', message: '流式响应超时，请重试' });
            } else {
                await this.finishWithStatus(task, 'failed', { code: 'NETWORK_ERROR', message: '流式响应中断' });
            }
        } finally {
            reader.releaseLock();
        }
    }

    private handleSseLine(task: ChatStreamTaskInternal, rawLine: string): 'break' | void {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const payload = line.replace(/^data:\s*/, '');
        if (!payload || payload === '[DONE]') return;

        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch {
            return;
        }

        const metadataType = (parsed as { type?: string }).type;
        if (metadataType === 'meta' || metadataType === 'message-metadata' || metadataType === 'start' || metadataType === 'finish') {
            const nextMetadata = (parsed as { metadata?: AIMessageMetadata; messageMetadata?: AIMessageMetadata }).metadata
                ?? (parsed as { messageMetadata?: AIMessageMetadata }).messageMetadata;
            if (nextMetadata) {
                task.metadata = nextMetadata;
                task.updatedAt = Date.now();
                this.emit({ type: 'task_updated', task: this.buildSnapshot(task) });
            }
            return;
        }

        // 处理后端发送的结构化错误事件（如流式扣费失败）
        // 将错误信息存到 task 上，返回 'break' 信号通知 runTask 退出读取循环
        if ((parsed as { type?: string }).type === 'error') {
            const errorData = parsed as { code?: string; error?: string; errorText?: string };
            const message = errorData.errorText || errorData.error || '请求失败';
            task.sseError = {
                code: errorData.code === 'INSUFFICIENT_BALANCE' ? 'INSUFFICIENT_BALANCE' : 'REQUEST_FAILED',
                message,
            };
            return 'break';
        }

        // AI SDK abort 事件（安全过滤等）
        if ((parsed as { type?: string }).type === 'abort') {
            const reason = (parsed as { reason?: string }).reason;
            task.sseError = {
                code: 'REQUEST_FAILED',
                message: reason || '请求被中断',
            };
            return 'break';
        }

        const delta = parsed as { type?: unknown; delta?: unknown; textDelta?: unknown };

        let hasChanges = false;
        if (delta.type === 'reasoning-delta' && typeof delta.delta === 'string' && delta.delta.length > 0) {
            this.appendReasoningDelta(task, delta.delta);
            hasChanges = false;
        }

        // AI SDK toUIMessageStreamResponse 使用 textDelta，自定义 SSE 使用 delta
        const textChunk = typeof delta.textDelta === 'string' ? delta.textDelta
            : typeof delta.delta === 'string' ? delta.delta : '';
        if (delta.type === 'text-delta' && textChunk.length > 0) {
            this.appendContentDelta(task, textChunk);
            hasChanges = false;
        }

        if (hasChanges) {
            task.updatedAt = Date.now();
            this.emit({ type: 'task_updated', task: this.buildSnapshot(task) });
        }
    }

    private appendReasoningDelta(task: ChatStreamTaskInternal, delta: string): void {
        if (!delta) return;
        if (!task.reasoningStartTime) {
            task.reasoningStartTime = Date.now();
        }
        task.reasoning += delta;
        task.updatedAt = Date.now();
        this.emit({ type: 'task_updated', task: this.buildSnapshot(task) });
    }

    private appendContentDelta(task: ChatStreamTaskInternal, delta: string): void {
        if (!delta) return;
        task.content += delta;
        task.hasVisibleToken = true;
        task.updatedAt = Date.now();
        this.emit({ type: 'task_updated', task: this.buildSnapshot(task) });
    }

    private setMetadata(task: ChatStreamTaskInternal, metadata: AIMessageMetadata): void {
        task.metadata = metadata;
        task.updatedAt = Date.now();
        this.emit({ type: 'task_updated', task: this.buildSnapshot(task) });
    }

    private classifyRunnerError(error: unknown): { code: ChatStreamTaskErrorCode; message: string } {
        if (error instanceof ChatRunnerError && error.status === 401) return { code: 'AUTH_REQUIRED', message: error.message };
        // A provider's own failure arrives as ByokRequestError, already written for the reader.
        return { code: 'REQUEST_FAILED', message: error instanceof Error && error.message ? error.message : '请求失败，请稍后再试' };
    }

    private async finishCompleted(task: ChatStreamTaskInternal): Promise<void> {
        if (task.content.trim().length === 0 && task.reasoning.trim().length === 0) {
            await this.finishWithStatus(task, 'failed', {
                code: 'REQUEST_FAILED',
                message: '流式响应为空',
            });
            return;
        }

        task.status = 'completed';
        task.updatedAt = Date.now();

        let finalMessages = [...task.baseMessages, buildAssistantFromTask(task, task.content)];
        if (task.onBeforeSave) {
            finalMessages = task.onBeforeSave(finalMessages, task.content);
            // 将 onBeforeSave 处理后的 baseMessages 存回 task，
            // 使后续 getTaskSnapshot 能返回包含完整版本信息的消息
            task.baseMessages = finalMessages.slice(0, -1);
        }
        const saved = await this.saveConversationFn(task.conversationId, finalMessages);
        if (!saved) {
            task.status = 'failed';
            task.updatedAt = Date.now();
            this.emit({
                type: 'task_failed',
                task: this.buildSnapshot(task, finalMessages, task.content),
                errorCode: 'PERSIST_FAILED',
                errorMessage: '保存对话失败，请稍后重试',
            });
            this.scheduleCleanup(task.conversationId);
            return;
        }

        this.emit({ type: 'task_completed', task: this.buildSnapshot(task, finalMessages, task.content) });
        this.scheduleCleanup(task.conversationId);
    }

    private async finishWithStatus(
        task: ChatStreamTaskInternal,
        status: 'stopped' | 'failed',
        errorInfo?: { code: ChatStreamTaskErrorCode; message: string }
    ): Promise<void> {
        task.status = status;
        task.updatedAt = Date.now();

        // metadata 单独存在不算有效输出（meta 事件总是最先到达），
        // 只有实际的 content 或 reasoning 才值得持久化
        const hasPartialOutput = task.content.trim().length > 0
            || task.reasoning.trim().length > 0;

        let finalMessages = [...task.baseMessages];
        if (hasPartialOutput) {
            finalMessages = [...task.baseMessages, buildAssistantFromTask(task)];
            if (task.onBeforeSave) {
                finalMessages = task.onBeforeSave(finalMessages, task.content);
                // 将 onBeforeSave 处理后的 baseMessages 存回 task
                task.baseMessages = finalMessages.slice(0, -1);
            }
            const saved = await this.saveConversationFn(task.conversationId, finalMessages);
            if (!saved) {
                this.emit({
                    type: 'task_failed',
                    task: this.buildSnapshot(task, finalMessages, task.content),
                    errorCode: 'PERSIST_FAILED',
                    errorMessage: '保存对话失败，请稍后重试',
                });
                this.scheduleCleanup(task.conversationId);
                return;
            }
        }

        const eventType: ChatStreamEventType = status === 'stopped' ? 'task_stopped' : 'task_failed';
        this.emit({
            type: eventType,
            task: this.buildSnapshot(task, finalMessages, task.content),
            errorCode: errorInfo?.code,
            errorMessage: errorInfo?.message,
        });
        this.scheduleCleanup(task.conversationId);
    }

    private scheduleCleanup(conversationId: string): void {
        const task = this.tasks.get(conversationId);
        if (!task) return;

        if (task.cleanupTimer) {
            clearTimeout(task.cleanupTimer);
        }

        const timer = setTimeout(() => {
            const current = this.tasks.get(conversationId);
            if (current?.cleanupTimer) {
                clearTimeout(current.cleanupTimer);
            }
            this.tasks.delete(conversationId);
        }, FINISHED_TASK_TTL_MS);
        if (typeof (timer as { unref?: () => void }).unref === 'function') {
            (timer as { unref: () => void }).unref();
        }
        task.cleanupTimer = timer;
    }

    private buildSnapshot(
        task: ChatStreamTaskInternal,
        messagesOverride?: ChatMessage[],
        contentOverride?: string
    ): ChatStreamTaskSnapshot {
        const content = contentOverride ?? task.content;
        let messages = messagesOverride;

        if (!messages) {
            if (task.status === 'running') {
                messages = [...task.baseMessages, buildAssistantFromTask(task, content)];
            } else if (task.status === 'completed') {
                messages = [...task.baseMessages, buildAssistantFromTask(task, content)];
            } else if (content.trim().length > 0 || task.reasoning.trim().length > 0) {
                messages = [...task.baseMessages, buildAssistantFromTask(task, content)];
            } else {
                messages = [...task.baseMessages];
            }
        }

        return {
            conversationId: task.conversationId,
            status: task.status,
            messages,
            content,
            reasoning: task.reasoning,
            metadata: task.metadata,
            startedAt: task.startedAt,
            updatedAt: task.updatedAt,
            hasVisibleToken: task.hasVisibleToken,
            model: task.assistantMessage.model,
            modelName: task.assistantMessage.modelName,
        };
    }

    private emit(event: ChatStreamEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

export const chatStreamManager = new ChatStreamManager();
