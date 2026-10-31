import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../types';


const { ChatStreamManager } = require('../lib/chat/chat-stream-manager') as typeof import('../lib/chat/chat-stream-manager');
const { BrowserDirectProviderError } = require('../lib/ai/browser-direct-provider') as typeof import('../lib/ai/browser-direct-provider');

function createUserMessage(): ChatMessage {
    return {
        id: 'user-1',
        role: 'user',
        content: '你好',
        createdAt: new Date().toISOString(),
    };
}

function createAssistantMessage(id: string): ChatMessage {
    return {
        id,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        model: 'deepseek-chat',
    };
}

function waitFor(predicate: () => boolean, timeoutMs = 1200): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }
            if (Date.now() - start > timeoutMs) {
                reject(new Error('waitFor timeout'));
                return;
            }
            setTimeout(tick, 20);
        };
        tick();
    });
}

function createInfiniteContentResponse(signal?: AbortSignal): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"A"}\n\n'));
            const onAbort = () => {
                controller.error(new DOMException('aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

function createStalledResponse(signal?: AbortSignal): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const onAbort = () => {
                controller.error(new DOMException('aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            // Intentionally never emits or closes so the inactivity timeout is hit.
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

test('chat stream manager allows concurrent tasks across different conversations', async () => {
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => createInfiniteContentResponse(init?.signal as AbortSignal | undefined),
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const start1 = await manager.startTask({
        conversationId: 'conv-1',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-1'),
    });
    const start2 = await manager.startTask({
        conversationId: 'conv-2',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-2'),
    });

    assert.equal(start1.ok, true);
    assert.equal(start2.ok, true);
    assert.equal(manager.isConversationRunning('conv-1'), true);
    assert.equal(manager.isConversationRunning('conv-2'), true);

    manager.stopTask('conv-1');
    await waitFor(() => !manager.isConversationRunning('conv-1'));
    assert.equal(manager.isConversationRunning('conv-2'), true);

    manager.stopTask('conv-2');
    await waitFor(() => !manager.isConversationRunning('conv-2'));
});

test('chat stream manager blocks parallel tasks in the same conversation', async () => {
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => createInfiniteContentResponse(init?.signal as AbortSignal | undefined),
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const start1 = await manager.startTask({
        conversationId: 'conv-1',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-1'),
    });

    const start2 = await manager.startTask({
        conversationId: 'conv-1',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-2'),
    });

    assert.equal(start1.ok, true);
    assert.equal(start2.ok, false);
    assert.equal(start2.code, 'CONVERSATION_BUSY');

    manager.stopTask('conv-1');
    await waitFor(() => !manager.isConversationRunning('conv-1'));
});

test('chat stream manager saves partial output when stopped manually', async () => {
    const saved: Array<{ conversationId: string; messages: ChatMessage[] }> = [];
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => createInfiniteContentResponse(init?.signal as AbortSignal | undefined),
        saveConversation: async (conversationId, messages) => {
            saved.push({ conversationId, messages: messages as ChatMessage[] });
            return true;
        },
    });

    const baseMessages = [createUserMessage()];
    const started = await manager.startTask({
        conversationId: 'conv-stop',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-stop'),
    });

    assert.equal(started.ok, true);
    await waitFor(() => {
        const snapshot = manager.getTaskSnapshot('conv-stop');
        return Boolean(snapshot?.content && snapshot.content.length > 0);
    });

    manager.stopTask('conv-stop');
    await waitFor(() => !manager.isConversationRunning('conv-stop'));

    assert.equal(saved.length > 0, true);
    const latest = saved[saved.length - 1];
    assert.equal(latest.conversationId, 'conv-stop');
    const assistant = latest.messages[latest.messages.length - 1];
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.content.includes('A'), true);
});

test('chat stream manager maps HTTP 402 to insufficient balance even without a JSON payload', async () => {
    const manager = new ChatStreamManager({
        fetcher: async () => new Response('payment required', { status: 402 }),
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({ type: event.type, errorCode: event.errorCode });
    });

    const started = await manager.startTask({
        conversationId: 'conv-credits',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-credits'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'INSUFFICIENT_BALANCE');

    unsubscribe();
});

test('chat stream manager maps HTTP 401 to auth required with server error message', async () => {
    const manager = new ChatStreamManager({
        fetcher: async () => new Response(
            JSON.stringify({ error: '请先登录后再使用 AI 对话' }),
            {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            }
        ),
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-auth',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-auth'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'AUTH_REQUIRED');
    assert.equal(failedEvent?.errorMessage, '请先登录后再使用 AI 对话');

    unsubscribe();
});

test('chat stream manager does not treat upstream auth failures as login required', async () => {
    const manager = new ChatStreamManager({
        fetcher: async () => new Response(
            JSON.stringify({ code: 'AUTH_FAILED', error: '模型认证失败，请检查API Key 是否正确' }),
            {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            }
        ),
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-byok-auth',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-byok-auth'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'REQUEST_FAILED');
    assert.equal(failedEvent?.errorMessage, '模型认证失败，请检查API Key 是否正确');

    unsubscribe();
});

test('chat stream manager serializes circular request bodies without throwing', async () => {
    let capturedBody = '';
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => {
            capturedBody = String(init?.body ?? '');
            return new Response('payment required', { status: 402 });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const circularMessage: Record<string, unknown> = {
        id: 'circular-msg',
        role: 'user',
        content: '循环消息',
    };
    circularMessage.self = circularMessage;

    const started = await manager.startTask({
        conversationId: 'conv-circular',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: {
            messages: [circularMessage],
            stream: true,
        },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-circular'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => !manager.isConversationRunning('conv-circular'));
    assert.equal(capturedBody.includes('"messages"'), true);
    assert.equal(capturedBody.includes('"循环消息"'), true);
});

test('chat stream manager serializes bigint values to avoid request-time crashes', async () => {
    let capturedBody = '';
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => {
            capturedBody = String(init?.body ?? '');
            return new Response('payment required', { status: 402 });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const started = await manager.startTask({
        conversationId: 'conv-bigint',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: {
            messages: [{
                id: 'bigint-msg',
                role: 'user',
                content: 'bigint',
                tokens: BigInt(1),
            }],
            stream: true,
        },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-bigint'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => !manager.isConversationRunning('conv-bigint'));
    assert.equal(capturedBody.includes('"tokens":"1"'), true);
});

test('chat stream manager invokes fetch with global this binding to avoid illegal invocation', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = function (
            this: typeof globalThis,
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> {
            void input;
            void init;
            if (this !== globalThis) {
                throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
            }
            return Promise.resolve(new Response('payment required', { status: 402 }));
        } as typeof fetch;

        const manager = new ChatStreamManager({
            saveConversation: async () => true,
        });
        const baseMessages = [createUserMessage()];
        const events: Array<{ type: string; errorCode?: string }> = [];
        const unsubscribe = manager.subscribe((event) => {
            events.push({ type: event.type, errorCode: event.errorCode });
        });

        const started = await manager.startTask({
            conversationId: 'conv-bound-fetch',
            requestHeaders: { 'Content-Type': 'application/json' },
            requestBody: { messages: baseMessages, stream: true },
            baseMessages,
            assistantMessage: createAssistantMessage('assistant-bound-fetch'),
        });
        assert.equal(started.ok, true);

        await waitFor(() => events.some(e => e.type === 'task_failed'));
        const failedEvent = events.find(e => e.type === 'task_failed');
        assert.equal(failedEvent?.errorCode, 'INSUFFICIENT_BALANCE');

        unsubscribe();
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat stream manager handles SSE structured error event without throwing', async () => {
    const encoder = new TextEncoder();
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"partial"}\n\n'));
                    controller.enqueue(encoder.encode('data: {"type":"error","errorText":"积分不足"}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-sse-error',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-sse-error'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'REQUEST_FAILED');
    assert.equal(failedEvent?.errorMessage, '积分不足');

    unsubscribe();
});

test('chat stream manager updates metadata from AI SDK message-metadata chunks', async () => {
    const encoder = new TextEncoder();
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"message-metadata","messageMetadata":{"modelId":"deepseek-v3.2"}}\n\n'));
                    controller.enqueue(encoder.encode('data: {"type":"text-delta","id":"t1","delta":"hello"}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const started = await manager.startTask({
        conversationId: 'conv-meta',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-meta'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => manager.getTaskSnapshot('conv-meta')?.status === 'completed');
    const snapshot = manager.getTaskSnapshot('conv-meta');
    assert.equal(snapshot?.metadata?.modelId, 'deepseek-v3.2');
});

test('chat stream manager silently ignores unknown chunk types', async () => {
    const encoder = new TextEncoder();
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"hello"}\n\n'));
                    controller.enqueue(encoder.encode('data: {"type":"usage","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; content?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({ type: event.type, content: event.task.content });
    });

    const started = await manager.startTask({
        conversationId: 'conv-usage',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-usage'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_completed'));
    const completedEvent = events.find(e => e.type === 'task_completed');
    assert.equal(completedEvent?.content, 'hello');

    unsubscribe();
});

test('chat stream manager parses AI SDK textDelta format', async () => {
    const encoder = new TextEncoder();
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"text-delta","textDelta":"hello from AI SDK"}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; content?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({ type: event.type, content: event.task.content });
    });

    const started = await manager.startTask({
        conversationId: 'conv-ai-sdk',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-ai-sdk'),
    });
    assert.equal(started.ok, true);

    await new Promise(resolve => setTimeout(resolve, 100));
    unsubscribe();

    const completed = events.find(e => e.type === 'task_completed');
    assert.ok(completed, 'should complete');
    assert.equal(completed?.content, 'hello from AI SDK');
});

test('chat stream manager fails empty streams instead of synthesizing fallback replies', async () => {
    const encoder = new TextEncoder();
    const saved: Array<{ conversationId: string; messages: ChatMessage[] }> = [];
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async (conversationId, messages) => {
            saved.push({ conversationId, messages: messages as ChatMessage[] });
            return true;
        },
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-empty',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-empty'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'REQUEST_FAILED');
    assert.equal(failedEvent?.errorMessage, '流式响应为空');
    assert.equal(saved.length, 0);
    assert.deepEqual(manager.getTaskMessages('conv-empty'), baseMessages);

    unsubscribe();
});

test('chat stream manager reports timeout when stream stays idle too long', async () => {
    const manager = new ChatStreamManager({
        fetcher: async (_input, init) => createStalledResponse(init?.signal as AbortSignal | undefined),
        saveConversation: async () => true,
        streamInactivityTimeoutMs: 30,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-timeout',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-timeout'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'NETWORK_ERROR');
    assert.equal(failedEvent?.errorMessage, '流式响应超时，请重试');

    unsubscribe();
});

test('chat stream manager supports custom runners for browser-direct tasks', async () => {
    const saved: Array<{ conversationId: string; messages: ChatMessage[] }> = [];
    const manager = new ChatStreamManager({
        saveConversation: async (conversationId, messages) => {
            saved.push({ conversationId, messages: messages as ChatMessage[] });
            return true;
        },
    });

    const baseMessages = [createUserMessage()];
    const started = await manager.startTask({
        conversationId: 'conv-direct-runner',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-direct-runner'),
        runner: async ({ setMetadata, appendReasoningDelta, appendContentDelta }) => {
            setMetadata({
                sources: [],
                kbSearchEnabled: false,
                kbHitCount: 0,
            });
            appendReasoningDelta('思考中');
            appendContentDelta('直连成功');
        },
    });
    assert.equal(started.ok, true);

    await waitFor(() => manager.getTaskSnapshot('conv-direct-runner')?.status === 'completed');
    const snapshot = manager.getTaskSnapshot('conv-direct-runner');
    assert.equal(snapshot?.content, '直连成功');
    assert.equal(snapshot?.reasoning, '思考中');
    assert.equal(snapshot?.metadata?.kbHitCount, 0);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.messages[saved[0].messages.length - 1]?.content, '直连成功');
});

test('chat stream manager surfaces persist failure instead of reporting false completion', async () => {
    const manager = new ChatStreamManager({
        fetcher: async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"hello persist"}\n\n'));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        saveConversation: async () => false,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string; content?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
            content: event.task.content,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-persist-fail',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-persist-fail'),
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'PERSIST_FAILED');
    assert.equal(failedEvent?.errorMessage, '保存对话失败，请稍后重试');
    assert.equal(failedEvent?.content, 'hello persist');
    assert.equal(events.some(e => e.type === 'task_completed'), false);

    unsubscribe();
});

test('chat stream manager maps browser-direct prepare auth failures to AUTH_REQUIRED', async () => {
    const manager = new ChatStreamManager({
        saveConversation: async () => true,
    });

    const baseMessages = [createUserMessage()];
    const events: Array<{ type: string; errorCode?: string; errorMessage?: string }> = [];
    const unsubscribe = manager.subscribe((event) => {
        events.push({
            type: event.type,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
        });
    });

    const started = await manager.startTask({
        conversationId: 'conv-direct-auth',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: { messages: baseMessages, stream: true },
        baseMessages,
        assistantMessage: createAssistantMessage('assistant-direct-auth'),
        runner: async () => {
            throw new BrowserDirectProviderError('请先登录后再使用 AI 对话', {
                status: 401,
                code: 'PREPARE_FAILED',
            });
        },
    });
    assert.equal(started.ok, true);

    await waitFor(() => events.some(e => e.type === 'task_failed'));
    const failedEvent = events.find(e => e.type === 'task_failed');
    assert.equal(failedEvent?.errorCode, 'AUTH_REQUIRED');
    assert.equal(failedEvent?.errorMessage, '请先登录后再使用 AI 对话');

    unsubscribe();
});
