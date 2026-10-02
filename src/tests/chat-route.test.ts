import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/supabase-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';
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
    authInfoCalls: number;
    useCreditCalls: number;
    addCreditCalls: number;
    aiUiCalls: number;
    rateLimitCalls: number;
    rateLimitEndpoint: string | null;
}

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
    streamBody: ReadableStream<unknown>
): MockState {
    const routeModulePath = require.resolve('../app/api/chat/route');
    const directPrepareRouteModulePath = require.resolve('../app/api/chat/direct/prepare/route');
    const requestModulePath = require.resolve('../lib/server/chat/request');
    const aiModule = require('../lib/ai/ai') as any;
    const creditsModule = require('../lib/user/credits') as any;
    const aiConfigServerModule = require('../lib/server/ai-config') as any;
    const aiAccessModule = require('../lib/ai/ai-access') as any;
    const promptBuilderModule = require('../lib/ai/prompt-builder') as any;
    const supabaseServerModule = require('../lib/supabase-server') as any;
    const apiUtilsModule = require('../lib/api-utils') as any;
    const rateLimitModule = require('../lib/rate-limit') as any;

    const originalCallAIStream = aiModule.callAIStream;
    const originalCallAIUIMessageResult = aiModule.callAIUIMessageResult;
    const originalGetUserAuthInfo = creditsModule.getUserAuthInfo;
    const originalAttemptCreditUse = creditsModule.attemptCreditUse;
    const originalUseCredit = creditsModule.useCredit;
    const originalRefundCreditsOrLog = creditsModule.refundCreditsOrLog;
    const originalAddCredits = creditsModule.addCredits;
    const originalGetModelConfigAsync = aiConfigServerModule.getModelConfigAsync;
    const originalGetDefaultModelConfigAsync = aiConfigServerModule.getDefaultModelConfigAsync;
    const originalIsModelAllowedForMembership = aiAccessModule.isModelAllowedForMembership;
    const originalIsReasoningAllowedForMembership = aiAccessModule.isReasoningAllowedForMembership;
    const originalBuildPromptWithSources = promptBuilderModule.buildPromptWithSources;
    const originalBuildMinimalChatSystemPrompt = promptBuilderModule.buildMinimalChatSystemPrompt;
    const originalGetPromptBudget = promptBuilderModule.calculatePromptBudget;
    const originalResolvePersonalities = promptBuilderModule.resolvePersonalities;
    const originalGetServiceClient = supabaseServerModule.getSystemAdminClient;
    const originalRequireUserContext = apiUtilsModule.requireUserContext;
    const originalCheckRateLimit = rateLimitModule.checkRateLimit;

    const state: MockState = {
        events: [],
        promptCalls: 0,
        authInfoCalls: 0,
        useCreditCalls: 0,
        addCreditCalls: 0,
        aiUiCalls: 0,
        rateLimitCalls: 0,
        rateLimitEndpoint: null,
    };

    aiModule.callAIStream = async () => createUIChunkStream([]);
    aiModule.callAIUIMessageResult = async () => {
        state.aiUiCalls += 1;
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
    creditsModule.getUserAuthInfo = async () => {
        state.events.push('account');
        state.authInfoCalls += 1;
        return {
            credits: 1,
            effectiveMembership: 'free',
            hasCredits: true,
        };
    };
    creditsModule.useCredit = async () => {
        state.useCreditCalls += 1;
        return 0;
    };
    creditsModule.attemptCreditUse = async () => {
        state.events.push('debit');
        state.useCreditCalls += 1;
        return {
            ok: true,
            remaining: 0,
        };
    };
    creditsModule.addCredits = async () => {
        state.addCreditCalls += 1;
        return 1;
    };
    creditsModule.refundCreditsOrLog = async () => {
        state.events.push('refund');
        state.addCreditCalls += 1;
        return true;
    };

    const mockModelConfig = {
        id: 'deepseek-chat',
        modelKey: 'deepseek-chat',
        vendor: 'deepseek',
        supportsReasoning: true,
        supportsVision: false,
        requiredTier: 'free',
    };
    aiConfigServerModule.getModelConfigAsync = async () => mockModelConfig;
    aiConfigServerModule.getDefaultModelConfigAsync = async () => mockModelConfig;
    aiAccessModule.isModelAllowedForMembership = () => true;
    aiAccessModule.isReasoningAllowedForMembership = () => true;

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
        supabase: {
            auth: {
                getSession: async () => ({ data: { session: null } }),
            },
        },
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

    supabaseServerModule.getSystemAdminClient = () => ({
        auth: {
            getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        },
        rpc: async () => ({
            data: {
                allowed: true,
                remaining: 19,
                reset_at: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
        }),
        from: (table: string) => {
            if (table === 'user_settings') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({ data: null, error: null }),
                        }),
                    }),
                };
            }
            if (table === 'knowledge_bases') {
                return {
                    select: () => ({
                        eq: () => ({
                            in: async () => ({ data: [], error: null }),
                        }),
                    }),
                };
            }
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                    }),
                }),
            };
        },
    });

    delete require.cache[routeModulePath];
    delete require.cache[directPrepareRouteModulePath];
    delete require.cache[requestModulePath];

    t.after(() => {
        aiModule.callAIStream = originalCallAIStream;
        aiModule.callAIUIMessageResult = originalCallAIUIMessageResult;
        creditsModule.getUserAuthInfo = originalGetUserAuthInfo;
        creditsModule.attemptCreditUse = originalAttemptCreditUse;
        creditsModule.useCredit = originalUseCredit;
        creditsModule.refundCreditsOrLog = originalRefundCreditsOrLog;
        creditsModule.addCredits = originalAddCredits;
        aiConfigServerModule.getModelConfigAsync = originalGetModelConfigAsync;
        aiConfigServerModule.getDefaultModelConfigAsync = originalGetDefaultModelConfigAsync;
        aiAccessModule.isModelAllowedForMembership = originalIsModelAllowedForMembership;
        aiAccessModule.isReasoningAllowedForMembership = originalIsReasoningAllowedForMembership;
        promptBuilderModule.buildPromptWithSources = originalBuildPromptWithSources;
        promptBuilderModule.buildMinimalChatSystemPrompt = originalBuildMinimalChatSystemPrompt;
        promptBuilderModule.calculatePromptBudget = originalGetPromptBudget;
        promptBuilderModule.resolvePersonalities = originalResolvePersonalities;
        supabaseServerModule.getSystemAdminClient = originalGetServiceClient;
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        rateLimitModule.checkRateLimit = originalCheckRateLimit;
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

function createByokChatRequest() {
    return new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
            stream: true,
            customProvider: {
                apiUrl: 'https://8.8.8.8/v1',
                apiKey: 'sk-test',
                modelId: 'gpt-4.1-mini',
            },
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

test('chat route does not charge when stream ends before visible content', async (t) => {
    const streamBody = createUIChunkStream([
        { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
    ]);
    const state = setupRouteMocks(t, streamBody);
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    await response.text();
    await waitForMicrotask();

    assert.equal(state.authInfoCalls, 1);
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 1);
});

test('chat route blocks before deduction when combined auth info reports no credits', async (t) => {
    const streamBody = createUIChunkStream([
        { type: 'text-delta', id: 't1', delta: '你好' },
    ]);
    const state = setupRouteMocks(t, streamBody);
    const creditsModule = require('../lib/user/credits') as any;
    creditsModule.getUserAuthInfo = async () => {
        state.events.push('account');
        state.authInfoCalls += 1;
        return {
            credits: 0,
            effectiveMembership: 'free',
            hasCredits: false,
        };
    };

    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    const payload = await response.json();

    assert.equal(response.status, 402);
    assert.equal(payload.code, 'INSUFFICIENT_CREDITS');
    assert.equal(state.authInfoCalls, 1);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route rejects streamed requests when upfront credit deduction fails', async (t) => {
    const streamBody = createUIChunkStream([
        { type: 'text-delta', id: 't1', delta: '你好' },
    ]);
    const state = setupRouteMocks(t, streamBody);
    const creditsModule = require('../lib/user/credits') as any;
    creditsModule.attemptCreditUse = async () => {
        state.events.push('debit');
        state.useCreditCalls += 1;
        return {
            ok: false,
            reason: 'deduction_failed',
        };
    };

    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.code, 'CREDIT_DEDUCTION_FAILED');
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route keeps upfront charge when stream produces visible content', async (t) => {
    const streamBody = createUIChunkStream([
        { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
        { type: 'text-delta', id: 't1', delta: '你' },
        { type: 'text-delta', id: 't1', delta: '好' },
    ]);
    const state = setupRouteMocks(t, streamBody);
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    await response.text();
    await waitForMicrotask();

    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 0);
});

test('chat route keeps charge and does not refund when stream fails after visible content', async (t) => {
    const failingStream = createUIChunkStream([
        { type: 'text-delta', id: 't1', delta: 'partial' },
        { type: 'error', errorText: 'stream read failed' },
    ]);

    const state = setupRouteMocks(t, failingStream);
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    await response.text().catch(() => undefined);
    await waitForMicrotask();

    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 0);
});

test('chat route no longer uses the legacy BYOK server proxy path', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([
        { type: 'text-delta', id: 't1', delta: 'ok' },
    ]));
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createByokChatRequest());
    await response.text();
    await waitForMicrotask();

    assert.equal(response.status, 200);
    assert.equal(state.authInfoCalls, 1);
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 0);
    assert.equal(state.aiUiCalls, 1);
});

test('chat route returns 400 for invalid JSON bodies', async (t) => {
    setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createInvalidJsonRequest('http://localhost/api/chat'));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '请求体不是合法 JSON');
});

test('chat direct prepare builds prompt context without deducting credits', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/direct/prepare/route');

    const response = await POST(createDirectPrepareRequest());
    const payload = await response.json() as {
        systemPrompt?: string;
        sanitizedMessages?: Array<{ content: string }>;
        metadata?: Record<string, unknown>;
        requestedModelId?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(state.authInfoCalls, 1);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.addCreditCalls, 0);
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
    assert.equal(state.rateLimitCalls, 1);
    assert.equal(state.rateLimitEndpoint, '/api/chat/direct/prepare');
    assert.equal(state.authInfoCalls, 1);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.addCreditCalls, 0);
    assert.equal(state.promptCalls, 0);
    assert.deepEqual(state.events, ['account', 'rate-limit']);
});

test('managed chat uses the shared limit after debit and before prompt assembly', async (t) => {
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
    assert.deepEqual(state.events, ['account', 'debit', 'rate-limit', 'prompt']);
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 0);
    assert.equal(state.aiUiCalls, 1);
});

// chat-use-case.test.ts owns the complete limiter × refund matrix. The route
// checks each distinct HTTP mapping and both false-return/throw refund adapters.
for (const [limiter, refund] of [
    ['deny', 'success'], ['throw', 'success'], ['deny', 'failure'], ['throw', 'throw'],
] as const) {
    test(`managed route limiter ${limiter}, refund ${refund}: controlled outcome without AI execution`, async (t) => {
        const state = setupRouteMocks(t, createUIChunkStream([]));
        const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
        const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
        t.mock.method(limits, 'checkRateLimit', async () => {
            state.events.push('rate-limit');
            state.rateLimitCalls += 1;
            if (limiter === 'throw') throw new Error('limiter infrastructure failed');
            return { allowed: false, remaining: 0, resetAt: new Date() };
        });
        t.mock.method(credits, 'refundCreditsOrLog', async (userId: string, amount: number, context: string) => {
            state.events.push('refund');
            state.addCreditCalls += 1;
            assert.equal(userId, 'user-1');
            assert.equal(amount, 1);
            assert.equal(context, 'chat rate-limit admission');
            if (refund === 'throw') throw new Error('refund infrastructure failed');
            return refund === 'success';
        });
        const { POST } = await import('../app/api/chat/route');
        const response = await POST(createChatRequest());
        const payload = await response.json();
        if (refund !== 'success') {
            assert.equal(response.status, 500);
            assert.equal(payload.code, 'CREDIT_REFUND_FAILED');
            assert.equal(payload.refundFailed, true);
        } else if (limiter === 'throw') {
            assert.equal(response.status, 500);
            assert.equal(payload.code, 'RATE_LIMIT_FAILED');
        } else {
            assert.equal(response.status, 429);
            assert.equal(payload.error, '请求过于频繁，请稍后再试');
        }
        assert.deepEqual(state.events, ['account', 'debit', 'rate-limit', 'refund']);
        assert.equal(state.useCreditCalls, 1);
        assert.equal(state.rateLimitCalls, 1);
        assert.equal(state.addCreditCalls, 1);
        assert.equal(state.promptCalls, 0);
        assert.equal(state.aiUiCalls, 0);
    });
}

test('direct account validation failure does not consume a rate slot or debit', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
    t.mock.method(credits, 'getUserAuthInfo', async () => {
        state.events.push('account');
        throw new credits.UserStateResolutionError('account unavailable', 'USER_QUERY_FAILED');
    });
    const { POST } = await import('../app/api/chat/direct/prepare/route');
    const response = await POST(createDirectPrepareRequest());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'USER_QUERY_FAILED');
    assert.deepEqual(state.events, ['account']);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.addCreditCalls, 0);
    assert.equal(state.promptCalls, 0);
});

test('chat route refuses a member-only model without debit or AI execution', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const access = require('../lib/ai/ai-access') as typeof import('../lib/ai/ai-access');
    t.mock.method(access, 'isModelAllowedForMembership', () => false);
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, '当前会员等级无法使用该模型');
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route refunds prompt assembly failure once, without a second route refund', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const promptBuilder = require('../lib/ai/prompt-builder') as typeof import('../lib/ai/prompt-builder');
    t.mock.method(promptBuilder, 'buildPromptWithSources', async () => { throw new Error('prompt assembly failed'); });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    assert.equal(response.status, 500);
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.addCreditCalls, 1);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route maps account infrastructure errors without debit', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
    t.mock.method(credits, 'getUserAuthInfo', async () => {
        throw new credits.UserStateResolutionError('account unavailable', 'USER_QUERY_FAILED');
    });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest());
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.code, 'USER_QUERY_FAILED');
    assert.equal(payload.error, 'account unavailable');
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route rejects untrusted bypass flags when authentication fails', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    t.mock.method(api, 'getAuthContext', async () => { throw new Error('Untrusted caller reached optional auth'); });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({ skipCreditCheck: true, internalSecret: 'wrong-secret' }));
    assert.equal(response.status, 401);
    assert.equal(state.authInfoCalls, 0);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.aiUiCalls, 0);
});

test('chat route keeps normal-user debit and strips authorization fields before the use case', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const useCase = require('../lib/server/chat/use-case') as typeof import('../lib/server/chat/use-case');
    const original = useCase.prepareManagedChat;
    let observed = false;
    t.mock.method(useCase, 'prepareManagedChat', async (...args: Parameters<typeof original>) => {
        observed = true;
        assert.equal(args[0].creditPolicy, 'charge');
        assert.equal('skipCreditCheck' in args[1], false);
        assert.equal('internalSecret' in args[1], false);
        assert.equal('accessTokenForKB' in args[1], false);
        assert.equal('customProvider' in args[1], false);
        return original(...args);
    });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({
        skipCreditCheck: true,
        internalSecret: 'wrong-secret',
        accessTokenForKB: 'untrusted-token',
        customProvider: { apiKey: 'must-not-enter-use-case' },
    }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(observed, true);
    assert.equal(state.useCreditCalls, 1);
    assert.equal(state.aiUiCalls, 1);
});

test('chat route grants secret-validated bypass without leaking credentials into provider arguments', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'ok' }]));
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'getAuthContext', async () => ({ user: null, authError: null, supabase: null }));
    t.mock.method(api, 'requireUserContext', async () => { throw new Error('Trusted bypass reached required auth'); });
    const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    const original = ai.callAIUIMessageResult;
    t.mock.method(ai, 'callAIUIMessageResult', async (...args: Parameters<typeof original>) => {
        assert.doesNotMatch(JSON.stringify(args), /internal-secret|test-token|accessTokenForKB|skipCreditCheck/);
        return original(...args);
    });
    const { POST } = await import('../app/api/chat/route');

    const response = await POST(createChatRequest({ skipCreditCheck: true, internalSecret: 'internal-secret' }));
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(state.authInfoCalls, 0);
    assert.equal(state.useCreditCalls, 0);
    assert.equal(state.addCreditCalls, 0);
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.aiUiCalls, 1);
});

for (const mode of ['managed', 'trusted', 'direct', 'preview'] as const) {
    for (const expiredAccessCookie of [true, false]) {
        test(`${mode} KB search uses refreshed identity with ${expiredAccessCookie ? 'stale access' : 'refresh-only'} cookies`, async (t) => {
            const state = setupRouteMocks(t, createUIChunkStream([{ type: 'text-delta', id: 't1', delta: 'answer' }]));
            const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
            const sessionModule = require('../lib/auth-session') as typeof import('../lib/auth-session');
            const promptContext = require('../lib/server/chat/prompt-context') as typeof import('../lib/server/chat/prompt-context');
            const membership = require('../lib/user/membership-server') as typeof import('../lib/user/membership-server');
            const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
            const search = require('../lib/knowledge-base/search') as typeof import('../lib/knowledge-base/search');
            const resolveAuth = api.getAuthContext;
            const refreshedToken = 'refreshed-access-token';
            const caller = createMockAuthContext({}, `caller-${mode}-${expiredAccessCookie}`);
            const searchTokens: string[] = [];
            const searchCalls: string[] = [];
            const cookieWrites: string[] = [];
            let refreshCalls = 0;
            let hitCount = 0;
            const clientForToken = (token: string) => createMockAuthContext({
                rpc: async (name: string) => {
                    searchCalls.push(name);
                    if (token !== refreshedToken) return { data: null, error: { message: 'JWT expired' } };
                    return {
                        data: name === 'search_knowledge_fts'
                            ? [{ id: 'entry-1', kb_id: 'kb-1', content: 'caller knowledge', rank: 0.3, metadata: {} }]
                            : [],
                        error: null,
                    };
                },
                from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ id: 'kb-1', weight: 'normal' }] }) }) }) }),
            }, caller.user.id).db;
            const authResolverClient = {
                auth: {
                    async getUser(token: string) {
                        assert.equal(token, 'expired-access-token');
                        return { data: { user: null }, error: { message: 'JWT expired' } };
                    },
                    async refreshSession(tokens: { refresh_token: string }) {
                        assert.equal(tokens.refresh_token, 'valid-refresh-token');
                        refreshCalls += 1;
                        return { data: { session: {
                            access_token: refreshedToken, refresh_token: 'next-refresh-token',
                            token_type: 'bearer', expires_in: 3600, user: caller.user,
                        } }, error: null };
                    },
                },
            } satisfies Parameters<typeof sessionModule.resolveSessionFromTokens>[0];
            const resolveRequestAuth = (request: NextRequest) => resolveAuth(request, {
                authResolverClient: authResolverClient as unknown as ReturnType<typeof api.createAnonClient>,
                authedClientFactory: (token) => {
                    assert.equal(token, refreshedToken);
                    return clientForToken(token);
                },
                cookieStore: {
                    set: (_name, value) => { cookieWrites.push(value); },
                    delete: () => assert.fail('successful refresh must not delete cookies'),
                },
            });
            t.mock.method(api, 'getAuthContext', resolveRequestAuth);
            t.mock.method(api, 'requireUserContext', async (request: NextRequest) => {
                const auth = await resolveRequestAuth(request);
                assert.ok(auth.user);
                return { ...auth, user: auth.user };
            });
            t.mock.method(api, 'createAuthedClient', (token: string) => {
                searchTokens.push(token);
                return clientForToken(token);
            });
            t.mock.method(membership, 'getEffectiveMembershipType', async () => 'plus' as const);
            t.mock.method(settings, 'isFeatureModuleEnabled', async () => true);
            // Keep the real P6 search/persistence chain; replace only prompt assembly.
            t.mock.method(promptContext, 'buildChatPromptContext', async (resolved: Parameters<typeof promptContext.buildChatPromptContext>[0]) => {
                const hits = await search.searchKnowledge('question', {
                    membershipType: 'plus', userId: resolved.userId ?? undefined,
                    accessToken: resolved.accessTokenForKB ?? undefined, kbIds: ['kb-1'],
                });
                hitCount = hits.length;
                return {
                    sanitizedMessages: resolved.body.messages, fallbackPersonality: 'general' as const,
                    systemPrompt: hits.map(hit => hit.content).join('\n'),
                    promptKnowledgeBases: [{ id: 'kb-1', name: 'Caller KB' }],
                    metadata: { kbSearchEnabled: true, kbHitCount: hits.length,
                        promptDiagnostics: { modelId: resolved.requestedModelId, layers: [], totalTokens: 1, budgetTotal: 1024, userMessageTokens: 1 } },
                };
            });
            const request = new NextRequest(`http://localhost/api/chat/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', cookie: [
                    ...(expiredAccessCookie ? [`${sessionModule.ACCESS_COOKIE}=expired-access-token`] : []),
                    `${sessionModule.REFRESH_COOKIE}=valid-refresh-token`,
                ].join('; ') },
                body: JSON.stringify({
                    stream: true,
                    ...(mode === 'trusted' ? { skipCreditCheck: true, internalSecret: 'internal-secret' } : {}),
                    messages: [{ id: 'm1', role: 'user', content: 'question', createdAt: '2026-01-01' }],
                }),
            });
            const route = mode === 'preview' ? await import('../app/api/chat/preview/route')
                : mode === 'direct' ? await import('../app/api/chat/direct/prepare/route')
                    : await import('../app/api/chat/route');
            const response = await route.POST(request);
            const body = await response.text();
            assert.equal(response.status, 200, body);
            assert.doesNotMatch(body, /refreshed-access-token|valid-refresh-token|next-refresh-token/);
            assert.equal(hitCount, 1, 'successful authentication must not silently lose KB results');
            assert.deepEqual(searchTokens, [refreshedToken, refreshedToken]);
            assert.deepEqual(searchCalls, ['search_knowledge_fts', 'search_knowledge_trigram']);
            assert.equal(refreshCalls, 1);
            assert.deepEqual(cookieWrites, [refreshedToken, 'next-refresh-token']);
            assert.equal(request.cookies.get(sessionModule.ACCESS_COOKIE)?.value, expiredAccessCookie ? 'expired-access-token' : undefined);
            assert.equal(state.useCreditCalls, mode === 'managed' ? 1 : 0);
            assert.equal(state.addCreditCalls, 0);
            assert.equal(state.aiUiCalls, mode === 'managed' || mode === 'trusted' ? 1 : 0);
        });
    }
}

test('KB token propagation does not enable cookie refresh for Bearer-only authentication', async (t) => {
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const { REFRESH_COOKIE } = await import('../lib/auth-session');
    const refresh = t.mock.fn(async () => assert.fail('Bearer-only authentication must not refresh cookies'));
    const result = await api.requireBearerUser(new NextRequest('http://localhost/api/test', {
        headers: { authorization: 'Bearer expired-token', cookie: `${REFRESH_COOKIE}=valid-refresh-token` },
    }), {
        authResolverClient: {
            auth: {
                getUser: async (token: string) => {
                    assert.equal(token, 'expired-token');
                    return { data: { user: null }, error: { message: 'JWT expired' } };
                },
                refreshSession: refresh,
            },
        } satisfies Parameters<typeof import('../lib/auth-session').resolveSessionFromTokens>[0] as unknown as ReturnType<typeof api.createAnonClient>,
        authedClientFactory: () => assert.fail('rejected Bearer must not construct a request DB client'),
    });
    assert.deepEqual(result, { error: { message: '认证失败', status: 401 } });
    assert.equal(refresh.mock.callCount(), 0);
});

test('chat direct prepare returns 400 for invalid JSON bodies', async (t) => {
    const state = setupRouteMocks(t, createUIChunkStream([]));
    const { POST } = await import('../app/api/chat/direct/prepare/route');

    const response = await POST(createInvalidJsonRequest('http://localhost/api/chat/direct/prepare'));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '请求体不是合法 JSON');
    assert.equal(state.rateLimitCalls, 0);
    assert.equal(state.authInfoCalls, 0);
    assert.equal(state.useCreditCalls, 0);
});
