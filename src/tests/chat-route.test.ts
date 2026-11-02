import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { createMockAuthContext } from './helpers/auth-mock';

process.env.INTERNAL_API_SECRET = 'internal-secret';

beforeEach((t) => {
    assert.ok('mock' in t);
    let networkCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        networkCalls += 1;
        throw new Error('Unexpected network request');
    });
    t.after(() => assert.equal(networkCalls, 0, 'chat tests must not attempt network access'));
    const featureGuard = require('../lib/api/ai-feature-guard') as typeof import('../lib/api/ai-feature-guard');
    const appSettings = require('../lib/app-settings') as typeof import('../lib/app-settings');
    t.mock.method(featureGuard, 'getGlobalAIFeatureGuardResponse', async () => null);
    t.mock.method(appSettings, 'isFeatureModuleEnabled', async () => false);
});

const waitForMicrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

interface MockState {
    events: string[];
    promptCalls: number;
    balanceCalls: number;
    aiUiCalls: number;
    rateLimitCalls: number;
    rateLimitEndpoint: string | null;
    balance: number | Error;
    /** One entry per biller the route created: who pays, for which source and reference. */
    billers: Array<{ userId: string; source: string; reference?: { type: string; id: string } }>;
    charges: unknown[];
    /** The options of the last model call. */
    aiOptions: Record<string, unknown> | null;
}

const PRICED = { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null };

function createUIChunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<Record<string, unknown>> {
    return new ReadableStream<Record<string, unknown>>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk);
            }
            controller.close();
        },
    });
}

function createMockUIMessageResult(
    chunks: Array<Record<string, unknown>>,
    responseMessage: { parts: Array<Record<string, unknown>> },
    finishReason: string = 'stop',
) {
    return {
        toUIMessageStreamResponse(options?: {
            headers?: Record<string, string>;
            messageMetadata?: (input: { part: { type: string } }) => unknown;
            onFinish?: (event: {
                responseMessage: { parts: Array<Record<string, unknown>> };
                finishReason?: string;
                isAborted: boolean;
                isContinuation: boolean;
                messages: Array<{ parts: Array<Record<string, unknown>> }>;
            }) => PromiseLike<void> | void;
        }) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    const metadata = options?.messageMetadata?.({ part: { type: 'start' } });
                    if (metadata) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', messageMetadata: metadata })}\n\n`));
                    }
                    for (const chunk of chunks) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                    }
                    await options?.onFinish?.({
                        responseMessage,
                        finishReason,
                        isAborted: false,
                        isContinuation: false,
                        messages: [responseMessage],
                    });
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'x-vercel-ai-ui-message-stream': 'v1',
                    ...(options?.headers || {}),
                },
            });
        },
    };
}

function setupRouteMocks(
    t: { after: (fn: () => void) => void },
    streamBody: ReadableStream<unknown>,
    model: Record<string, unknown> = {},
): MockState {
    const routeModulePath = require.resolve('../app/api/chat/route');
    const directPrepareRouteModulePath = require.resolve('../app/api/chat/direct/prepare/route');
    const requestModulePath = require.resolve('../lib/server/chat/request');
    const aiModule = require('../lib/ai/ai') as any;
    const billingModule = require('../lib/billing/account.server') as any;
    const aiConfigServerModule = require('../lib/server/ai-config') as any;
    const promptBuilderModule = require('../lib/ai/prompt-builder') as any;
    const contextModule = require('../lib/db/context.server') as any;
    const apiUtilsModule = require('../lib/api-utils') as any;
    const rateLimitModule = require('../lib/rate-limit') as any;

    const originals = {
        callAIStream: aiModule.callAIStream,
        callAIUIMessageResult: aiModule.callAIUIMessageResult,
        getSpendableMicros: billingModule.getSpendableMicros,
        usageBiller: billingModule.usageBiller,
        getModelConfigAsync: aiConfigServerModule.getModelConfigAsync,
        getDefaultModelConfigAsync: aiConfigServerModule.getDefaultModelConfigAsync,
        buildPromptWithSources: promptBuilderModule.buildPromptWithSources,
        buildMinimalChatSystemPrompt: promptBuilderModule.buildMinimalChatSystemPrompt,
        calculatePromptBudget: promptBuilderModule.calculatePromptBudget,
        resolvePersonalities: promptBuilderModule.resolvePersonalities,
        systemDb: contextModule.systemDb,
        requireUserContext: apiUtilsModule.requireUserContext,
        checkRateLimit: rateLimitModule.checkRateLimit,
    };

    const state: MockState = {
        events: [],
        promptCalls: 0,
        balanceCalls: 0,
        aiUiCalls: 0,
        rateLimitCalls: 0,
        rateLimitEndpoint: null,
        balance: 1_000_000,
        billers: [],
        charges: [],
        aiOptions: null,
    };

    aiModule.callAIStream = async () => createUIChunkStream([]);
    aiModule.callAIUIMessageResult = async (...args: unknown[]) => {
        state.aiUiCalls += 1;
        state.aiOptions = (args[4] ?? null) as Record<string, unknown> | null;
        const chunks: Array<Record<string, unknown>> = [];
        const reader = streamBody.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as Record<string, unknown>);
        }
        reader.releaseLock();

        const text = chunks
            .filter((chunk) => chunk.type === 'text-delta' && typeof chunk.delta === 'string')
            .map((chunk) => String(chunk.delta))
            .join('');
        const reasoning = chunks
            .filter((chunk) => chunk.type === 'reasoning-delta' && typeof chunk.delta === 'string')
            .map((chunk) => String(chunk.delta))
            .join('');
        const responseParts: Array<Record<string, unknown>> = [];
        if (text) {
            responseParts.push({ type: 'text', text, state: 'done' });
        }
        if (reasoning) {
            responseParts.push({ type: 'reasoning', text: reasoning, state: 'done' });
        }

        return createMockUIMessageResult(chunks, { parts: responseParts });
    };
    billingModule.getSpendableMicros = async () => {
        state.events.push('balance');
        state.balanceCalls += 1;
        if (state.balance instanceof Error) throw state.balance;
        return state.balance;
    };
    billingModule.usageBiller = (userId: string, source: string, reference?: { type: string; id: string }) => {
        state.billers.push({ userId, source, ...(reference ? { reference } : {}) });
        return async (report: unknown) => { state.charges.push(report); };
    };

    const mockModelConfig = {
        id: 'deepseek-chat',
        modelKey: 'deepseek-chat',
        vendor: 'deepseek',
        supportsReasoning: true,
        supportsVision: false,
        pricing: PRICED,
        ...model,
    };
    aiConfigServerModule.getModelConfigAsync = async () => mockModelConfig;
    aiConfigServerModule.getDefaultModelConfigAsync = async () => mockModelConfig;

    promptBuilderModule.calculatePromptBudget = async () => 1024;
    promptBuilderModule.resolvePersonalities = () => ({ personalities: ['general'] });
    promptBuilderModule.buildMinimalChatSystemPrompt = () => ({
        systemPrompt: '',
        personalities: ['general'],
    });
    promptBuilderModule.buildPromptWithSources = async () => {
        state.events.push('prompt');
        state.promptCalls += 1;
        return {
            userMessagePrefix: '',
            sources: [],
            diagnostics: [],
            totalTokens: 0,
            budgetTotal: 0,
            userMessageTokens: 0,
            systemPrompt: '',
        };
    };
    apiUtilsModule.requireUserContext = async () => ({
        user: { id: 'user-1' },
        db: createMockScopedDb({}),
    });
    rateLimitModule.checkRateLimit = async (_identifier: string, endpoint: string) => {
        state.events.push('rate-limit');
        state.rateLimitCalls += 1;
        state.rateLimitEndpoint = endpoint;
        return {
            allowed: true,
            remaining: 19,
            resetAt: new Date(Date.now() + 60_000),
        };
    };

    contextModule.systemDb = () => createMockScopedDb({
        tx: async (work) => work({
            selectFrom: () => ({
                select: () => ({
                    where: () => ({
                        where: () => ({ execute: async () => [] }),
                        execute: async () => [],
                        executeTakeFirst: async () => null,
                    }),
                    executeTakeFirst: async () => null,
                }),
                executeTakeFirst: async () => null,
            }),
        } as never),
    });

    delete require.cache[routeModulePath];
    delete require.cache[directPrepareRouteModulePath];
    delete require.cache[requestModulePath];

    t.after(() => {
        aiModule.callAIStream = originals.callAIStream;
        aiModule.callAIUIMessageResult = originals.callAIUIMessageResult;
        billingModule.getSpendableMicros = originals.getSpendableMicros;
        billingModule.usageBiller = originals.usageBiller;
        aiConfigServerModule.getModelConfigAsync = originals.getModelConfigAsync;
        aiConfigServerModule.getDefaultModelConfigAsync = originals.getDefaultModelConfigAsync;
        promptBuilderModule.buildPromptWithSources = originals.buildPromptWithSources;
        promptBuilderModule.buildMinimalChatSystemPrompt = originals.buildMinimalChatSystemPrompt;
        promptBuilderModule.calculatePromptBudget = originals.calculatePromptBudget;
        promptBuilderModule.resolvePersonalities = originals.resolvePersonalities;
        contextModule.systemDb = originals.systemDb;
        apiUtilsModule.requireUserContext = originals.requireUserContext;
        rateLimitModule.checkRateLimit = originals.checkRateLimit;
        delete require.cache[routeModulePath];
        delete require.cache[directPrepareRouteModulePath];
        delete require.cache[requestModulePath];
    });

    return state;
}

function createChatRequest(overrides: Record<string, unknown> = {}) {
    return new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
            ...overrides,
            stream: true,
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    content: '你好',
                    createdAt: new Date().toISOString(),
                },
            ],
        }),
    });
}

function createDirectPrepareRequest() {
    return new NextRequest('http://localhost/api/chat/direct/prepare', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    content: '你好',
                    createdAt: new Date().toISOString(),
                },
            ],
            model: 'gpt-4.1-mini',
            reasoning: false,
            stream: true,
        }),
    });
}

function createInvalidJsonRequest(url: string) {
    return new NextRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
        },
        body: '{invalid-json',
    });
}

test('chat route meters the member: the model call carries their biller, which charges what the provider reports', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: '你好' }]));
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({ conversationId: 'conversation-a' }));
    await response.text();
    await waitForMicrotask();

    assert.equal(response.status, 200);
    assert.deepEqual(state.events, ['balance', 'rate-limit', 'prompt']);
    assert.deepEqual(state.billers, [{ userId: 'user-1', source: 'chat', reference: { type: 'conversation', id: 'conversation-a' } }]);
    const onUsage = state.aiOptions?.onUsage as ((report: unknown) => Promise<void>) | undefined;
    assert.equal(typeof onUsage, 'function');
    const report = { model: { id: 'deepseek-chat', pricing: PRICED }, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } };
    await onUsage!(report);
    assert.deepEqual(state.charges, [report]);
});

test('chat route refuses an empty balance with 402 before the rate limit, the prompt and the model', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: '你好' }]));
    state.balance = 0;
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    const payload = await response.json();

    assert.equal(response.status, 402);
    assert.equal(payload.code, 'INSUFFICIENT_BALANCE');
    assert.equal(payload.error, '余额不足，请充值、兑换或订阅后再试');
    assert.deepEqual(state.events, ['balance']);
    assert.equal(state.aiUiCalls, 0);
    assert.deepEqual(state.billers, []);
});

test('a free model runs on an empty balance without reading it, and is still metered for the usage log', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]), {
        pricing: { ...PRICED, input: 0, output: 0 },
    });
    state.balance = 0;
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(state.events, ['rate-limit', 'prompt']);
    assert.equal(state.billers.length, 1);
});

test('an unreadable balance fails closed with 500 and never reaches the model', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    state.balance = new Error('database down');
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'BALANCE_UNAVAILABLE');
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route refuses an unpriced model with 403 before the balance is read', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]), { pricing: { ...PRICED, output: null } });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'MODEL_UNPRICED');
    assert.equal(state.balanceCalls, 0);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route returns 400 for invalid JSON bodies', async (t) => {
    setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createInvalidJsonRequest('http://localhost/api/chat'));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '请求体不是合法 JSON');
});

test('chat direct prepare builds prompt context without reading the balance', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    state.balance = 0;
    const { POST } = await import('../app/api/chat/direct/prepare/route');

    const response = await POST(createDirectPrepareRequest());
    const payload = await response.json() as {
        systemPrompt?: string;
        sanitizedMessages?: Array<{ content: string }>;
        metadata?: Record<string, unknown>;
        requestedModelId?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(state.balanceCalls, 0);
    assert.deepEqual(state.billers, []);
    assert.equal(state.rateLimitCalls, 1);
    assert.equal(state.rateLimitEndpoint, '/api/chat/direct/prepare');
    assert.equal(payload.requestedModelId, 'gpt-4.1-mini');
    assert.equal(Array.isArray(payload.sanitizedMessages), true);
    assert.equal(payload.sanitizedMessages?.[0]?.content, '你好');
    assert.equal(typeof payload.metadata, 'object');
});

test('chat direct prepare returns 429 when BYOK rate limit is exhausted', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const rateLimitModule = require('../lib/rate-limit') as any;
    rateLimitModule.checkRateLimit = async (_identifier: string, endpoint: string) => {
        state.events.push('rate-limit');
        state.rateLimitCalls += 1;
        state.rateLimitEndpoint = endpoint;
        return {
            allowed: false,
            remaining: 0,
            resetAt: new Date(Date.now() + 60_000),
        };
    };

    const { POST } = await import('../app/api/chat/direct/prepare/route');
    const response = await POST(createDirectPrepareRequest());
    const payload = await response.json();

    assert.equal(response.status, 429);
    assert.equal(payload.error, '请求过于频繁，请稍后再试');
    assert.equal(state.rateLimitEndpoint, '/api/chat/direct/prepare');
    assert.equal(state.promptCalls, 0);
    assert.deepEqual(state.events, ['rate-limit']);
});

test('managed chat uses the shared limit after the balance check and before prompt assembly', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
    const original = limits.checkRateLimit;
    t.mock.method(limits, 'checkRateLimit', async (...args: Parameters<typeof original>) => {
        assert.equal(args[0], 'user-1');
        assert.equal(args[1], '/api/chat');
        assert.equal(args[2], limits.AI_RATE_LIMIT_CONFIG);
        assert.deepEqual(args[2], { maxRequests: 20, windowMs: 60_000 });
        return original(...args);
    });
    const { POST } = await import('../app/api/chat/route');
    const response = await POST(createChatRequest());
    await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(state.events, ['balance', 'rate-limit', 'prompt']);
    assert.equal(state.aiUiCalls, 1);
});

for (const limiter of ['deny', 'throw'] as const) {
    test(`managed route limiter ${limiter}: controlled outcome without prompt or AI execution`, async (t) => {
        const state = setupRouteMocks(t, createUIChunkStream([]));
        const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
        t.mock.method(limits, 'checkRateLimit', async () => {
            state.events.push('rate-limit');
            state.rateLimitCalls += 1;
            if (limiter === 'throw') throw new Error('limiter infrastructure failed');
            return { allowed: false, remaining: 0, resetAt: new Date() };
        });
        const { POST } = await import('../app/api/chat/route');
        const response = await POST(createChatRequest());
        const payload = await response.json();
        if (limiter === 'throw') {
            assert.equal(response.status, 500);
            assert.equal(payload.code, 'RATE_LIMIT_FAILED');
        } else {
            assert.equal(response.status, 429);
            assert.equal(payload.error, '请求过于频繁，请稍后再试');
        }
        assert.deepEqual(state.events, ['balance', 'rate-limit']);
        assert.equal(state.promptCalls, 0);
        assert.equal(state.aiUiCalls, 0);
    });
}

test('chat route validates the carried document and search flag, and admits search for every member', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const webSearch = require('../lib/ai/web-search.server') as typeof import('../lib/ai/web-search.server');
    const searched: string[] = [];
    t.mock.method(webSearch, 'searchChatWeb', async (query: string) => {
        searched.push(query);
        return { status: 'unavailable' as const, query };
    });
    const { POST } = await import('../app/api/chat/route');

    for (const [overrides, error] of [
        [{ attachment: { name: '命书.md', text: ' ' } }, '附件内容无效'],
        [{ attachment: '正文' }, '附件内容无效'],
        [{ webSearch: 'yes' }, '联网搜索参数无效'],
    ] as const) {
        const response = await POST(createChatRequest(overrides));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, error);
    }
    assert.equal(state.balanceCalls, 0);
    const admitted = await POST(createChatRequest({ webSearch: true, attachment: { name: '命书.md', text: '正文' } }));
    await admitted.text();
    assert.equal(admitted.status, 200);
    assert.deepEqual(searched, ['你好']);
});

test('chat route reports prompt assembly failure as 500 without reaching the model or billing', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const promptBuilder = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
    t.mock.method(promptBuilder, 'buildPromptWithSources', async () => { throw new Error('prompt assembly failed'); });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    assert.equal(response.status, 500);
    assert.equal(state.aiUiCalls, 0);
    assert.deepEqual(state.billers, []);
});

test('chat route rejects untrusted bypass flags when authentication fails', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    t.mock.method(api, 'getAuthContext', async () => { throw new Error('Untrusted caller reached optional auth'); });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({ skipBilling: true, internalSecret: 'wrong-secret' }));
    assert.equal(response.status, 401);
    assert.equal(state.balanceCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route meters a normal user and strips authorization fields before the use case', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const useCase = require('../lib/server/chat/use-case') as typeof import('../lib/server/chat/use-case');
    const original = useCase.prepareManagedChat;
    let observed = false;
    t.mock.method(useCase, 'prepareManagedChat', async (...args: Parameters<typeof original>) => {
        observed = true;
        assert.equal(args[0].billing, 'metered');
        assert.equal('skipBilling' in args[1], false);
        assert.equal('internalSecret' in args[1], false);
        assert.equal('accessTokenForKB' in args[1], false);
        return original(...args);
    });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({
        skipBilling: true,
        internalSecret: 'wrong-secret',
        accessTokenForKB: 'untrusted-token',
    }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(observed, true);
    assert.equal(state.balanceCalls, 1);
    assert.equal(state.billers.length, 1);
    assert.equal(state.aiUiCalls, 1);
});

test('chat route grants secret-validated bypass without metering or leaking credentials into provider arguments', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'getAuthContext', async () => createMockAuthContext(null));
    t.mock.method(api, 'requireUserContext', async () => { throw new Error('Trusted bypass reached required auth'); });
    const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    const original = ai.callAIUIMessageResult;
    t.mock.method(ai, 'callAIUIMessageResult', async (...args: Parameters<typeof original>) => {
        assert.doesNotMatch(JSON.stringify(args), /internal-secret|test-token|accessTokenForKB|skipBilling/);
        return original(...args);
    });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({ skipBilling: true, internalSecret: 'internal-secret' }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(state.balanceCalls, 0);
    assert.equal(state.rateLimitCalls, 0);
    assert.deepEqual(state.billers, []);
    assert.equal(state.aiOptions?.onUsage, undefined);
    assert.equal(state.aiUiCalls, 1);
});

test('chat forwards the selected conversation reasoning level on a model that reasons', async t => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const { POST } = await import('../app/api/chat/route');
    const response = await POST(createChatRequest({ reasoning: true, reasoningEffort: 'xhigh' }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(state.aiOptions?.reasoning, true);
    assert.equal(state.aiOptions?.reasoningEffort, 'xhigh');
});

test('chat clears a requested reasoning level when the model cannot reason', async t => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]), { supportsReasoning: false });
    const { POST } = await import('../app/api/chat/route');
    const response = await POST(createChatRequest({ reasoning: true, reasoningEffort: 'max' }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(state.aiOptions?.reasoning, false);
    assert.equal(state.aiOptions?.reasoningEffort, null);
});

test('invalid conversation reasoning levels fail before the balance check or model execution', async t => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/route');
    const response = await POST(createChatRequest({ reasoning: true, reasoningEffort: 'extreme' }));
    assert.equal(response.status, 400);
    assert.equal(state.balanceCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat forwards the conversation id and its owner so the prompt cache key stays stable, and rejects a malformed one', async t => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const { POST } = await import('../app/api/chat/route');
    const response = await POST(createChatRequest({ conversationId: 'conversation-a' }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(state.aiOptions?.conversationId, 'conversation-a');
    assert.equal(state.aiOptions?.cacheScope, 'user-1', 'the key is scoped to the member whose request it is');

    for (const conversationId of ['', 'x'.repeat(129), 42]) {
        const rejected = await POST(createChatRequest({ conversationId }));
        assert.equal(rejected.status, 400, String(conversationId));
    }
    assert.equal(state.billers.length, 1, 'only the accepted request is metered');
});

test('chat direct prepare returns 400 for invalid JSON bodies', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/direct/prepare/route');

    const response = await POST(createInvalidJsonRequest('http://localhost/api/chat/direct/prepare'));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '请求体不是合法 JSON');
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.balanceCalls, 0);
});

for (const failure of ['prompt', 'inference', 'empty-stream'] as const) {
    test(`chat ${failure} logs exactly one safe terminal`, async t => {
        setupRouteMocks(t, createUIChunkStream([]));
        const logs: unknown[][] = [];
        for (const method of ['info', 'warn', 'error', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
        if (failure === 'prompt') {
            const prompts = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
            t.mock.method(prompts, 'buildPromptWithSources', async () => { throw new Error('PRIVATE_PROMPT'); });
        }
        if (failure === 'inference') {
            const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
            t.mock.method(ai, 'callAIUIMessageResult', async () => { throw new Error('PRIVATE_PROVIDER'); });
        }
        const { POST } = await import('../app/api/chat/route');
        const response = await POST(createChatRequest({ mentions: [{ type: 'knowledge_base', name: 'PRIVATE_PROFILE', id: 'kb' }] }));
        await response.text();
        const events = logs.filter(log => log[0] === '[ai-request]').map(log => log[1] as import('../lib/server/analysis').RequestObservationEvent);
        const terminal = events.filter(event => event.phase === 'terminal');
        assert.equal(terminal.length, 1);
        assert.equal(terminal[0].failure, failure === 'empty-stream' ? 'none' : failure);
        assert.equal(terminal[0].generation, failure === 'prompt' ? 'not-started' : failure === 'inference' ? 'failed' : 'empty');
        assert.equal(terminal[0].billing, failure === 'prompt' ? 'not-applicable' : 'metered');
        assert.ok(events.every(event => event.requestId === terminal[0].requestId));
        assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
    });
}

for (const scenario of ['success', 'prompt', 'admission'] as const) {
  test(`direct chat ${scenario} has a bounded preparation diagnostic`, async t => {
    setupRouteMocks(t, createUIChunkStream([]));
    const events: import('../lib/server/analysis').RequestObservationEvent[] = [];
    t.mock.method(console, 'info', (_label: string, event: import('../lib/server/analysis').RequestObservationEvent) => { events.push(event); });
    if (scenario === 'prompt') {
      const prompts = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
      t.mock.method(prompts, 'buildPromptWithSources', async () => { throw new Error('PRIVATE_PROMPT'); });
    }
    if (scenario === 'admission') {
      const rate = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
      t.mock.method(rate, 'checkRateLimit', async () => ({ allowed: false, remaining: 0, resetAt: new Date() }));
    }
    const route = await import('../app/api/chat/direct/prepare/route');
    const response = await route.POST(createChatRequest({}));
    assert.equal(response.status, scenario === 'success' ? 200 : scenario === 'prompt' ? 500 : 429);
    const terminal = events.filter(event => event.phase === 'terminal');
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].failure, scenario === 'success' ? 'none' : scenario);
    assert.equal(terminal[0].billing, 'not-applicable');
    assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  });
}
