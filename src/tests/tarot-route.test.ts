import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { captureConsoleErrors, ensureRouteTestEnv, mockAIFeatureState, mockAIRateLimit, mockRouteUserContext, blockRouteNetwork } from './helpers/route-mock';
import { createMockUIMessageResult } from './helpers/ui-message-result';
import { createMockAuthContext } from './helpers/supabase-mock';
import type { CreateAIAnalysisParams } from '../lib/ai/ai-analysis';

ensureRouteTestEnv();

// The CommonJS test loader keeps imported function lookups live; no cache eviction is needed.
beforeEach((t) => {
    assert.ok('mock' in t);
    blockRouteNetwork(t);
});

const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
const aiAccessModule = require('../lib/ai/ai-access') as typeof import('../lib/ai/ai-access');
const aiModule = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
const aiAnalysisModule = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
const chartPromptDetailModule = require('../lib/ai/chart-prompt-detail') as typeof import('../lib/ai/chart-prompt-detail');
const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');

test('tarot route uses schema column names when inserting history', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);
    const consoleCapture = captureConsoleErrors();

    const createCalls: CreateAIAnalysisParams[] = [];

    mockRouteUserContext(t, {
        from() {
            throw new Error('tarot interpret test should not query tables directly');
        },
        rpc() {
            throw new Error('tarot interpret test should not call rpc directly');
        },
    });
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'free', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(aiModule, 'callAIWithReasoning', async () => ({
        content: 'analysis',
        reasoning: null,
    }));
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async (params: CreateAIAnalysisParams) => {
        createCalls.push(params);
        return 'conv-1';
    });
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');

    t.after(() => consoleCapture.restore());

    const { POST } = await import('../app/api/tarot/route');

    const request = new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            spreadId: 'single',
            cards: [
                {
                    card: {
                        nameChinese: '测试牌',
                        keywords: ['关键词'],
                        uprightMeaning: '正位',
                        reversedMeaning: '逆位',
                    },
                    orientation: 'upright',
                },
            ],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    const hasMembershipWarning = consoleCapture.errors.some((line) =>
        line.includes('[membership] Failed') ||
        line.includes('[supabase-server] Missing Supabase service configuration')
    );
    assert.equal(hasMembershipWarning, false);
    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    const createArgs = createCalls.at(-1);
    assert.ok(createArgs);
    assert.equal(createArgs.sourceType, 'tarot');
    assert.equal(createArgs.historyBinding?.type, 'tarot');
    assert.equal(createArgs.historyBinding?.payload.spread_id, 'single');
    assert.equal('interpretation' in (createArgs.historyBinding?.payload ?? {}), false);
    assert.equal('spread_type' in (createArgs.historyBinding?.payload ?? {}), false);
    assert.equal('ai_interpretation' in (createArgs.historyBinding?.payload ?? {}), false);
});

test('tarot route persists analysis after streaming completes', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    const createCalls: CreateAIAnalysisParams[] = [];

    mockRouteUserContext(t, {
        from() {
            throw new Error('tarot stream test should not query tables directly');
        },
        rpc() {
            throw new Error('tarot stream test should not call rpc directly');
        },
    });
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(aiModule, 'callAIUIMessageResult', async () => createMockUIMessageResult());
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async (params: CreateAIAnalysisParams) => {
        createCalls.push(params);
        return 'conv-1';
    });
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');

    const { POST } = await import('../app/api/tarot/route');

    const request = new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            readingId: 'reading-1',
            cards: [
                {
                    card: {
                        nameChinese: '测试牌',
                        keywords: ['关键词'],
                        uprightMeaning: '正位',
                        reversedMeaning: '逆位',
                    },
                    orientation: 'upright',
                },
            ],
        }),
    });

    const response = await POST(request);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    const createArgs = createCalls.at(-1);
    assert.ok(createArgs);
    assert.equal(createArgs.sourceType, 'tarot');
    assert.equal(createArgs.historyBinding?.type, 'tarot');
    assert.equal(createArgs.historyBinding?.payload.reading_id, 'reading-1');
});

test('tarot route surfaces SSE error when stream persistence fails after content generation', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);
    const refundCalls: Array<Parameters<typeof import('../lib/user/credits').addCredits>> = [];

    mockRouteUserContext(t, {
        from() {
            throw new Error('tarot stream test should not query tables directly');
        },
        rpc() {
            throw new Error('tarot stream test should not call rpc directly');
        },
    });
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(aiModule, 'callAIUIMessageResult', async () => createMockUIMessageResult());
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async () => {
        throw new Error('persist failed');
    });
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');
    t.mock.method(credits, 'addCredits', async (...args: Parameters<typeof import('../lib/user/credits').addCredits>) => {
        refundCalls.push(args);
        return 10;
    });
    t.mock.method(console, 'error', () => {});

    const { POST } = await import('../app/api/tarot/route');
    const request = new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            readingId: 'reading-1',
            cards: [
                {
                    card: {
                        nameChinese: '测试牌',
                        keywords: ['关键词'],
                        uprightMeaning: '正位',
                        reversedMeaning: '逆位',
                    },
                    orientation: 'upright',
                },
            ],
        }),
    });

    const response = await POST(request);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    assert.match(body, /"type":"text-delta","id":"text-1","delta":"analysis"/u);
    assert.match(body, /"type":"error","errorText":"保存结果失败，请稍后重试"/u);
    assert.deepEqual(refundCalls, [['user-1', 1]]);
});

test('tarot route returns 400 for invalid timezone on GET daily requests', async () => {
    const { GET } = await import('../app/api/tarot/route');

    const request = new NextRequest('http://localhost/api/tarot?action=daily&timezone=Bad/Timezone');
    const response = await GET(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error, 'timezone 无效');
});

test('tarot route returns numerology on draw-only and persists birth metadata on save', async (t) => {

    const insertCalls: Record<string, unknown>[] = [];
    const saveClient = {
        from(table: string) {
            assert.equal(table, 'tarot_readings');
            return {
                insert(payload: Record<string, unknown>) {
                    insertCalls.push(payload);
                    return {
                        select() {
                            return {
                                single: async () => ({
                                    data: { id: 'reading-1' },
                                    error: null,
                                }),
                            };
                        },
                    };
                },
            };
        },
    };

    t.mock.method(apiUtilsModule, 'getAuthContext', async () =>
        createMockAuthContext({}, null));

    t.mock.method(apiUtilsModule, 'requireUserContext', async () =>
        createMockAuthContext(saveClient, 'user-1'));

    const { POST } = await import('../app/api/tarot/route');

    const drawOnlyResponse = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'draw-only',
            spreadId: 'single',
            birthDate: '1990-01-01',
        }),
    }));
    const drawOnlyPayload = await drawOnlyResponse.json();

    assert.equal(drawOnlyResponse.status, 200);
    assert.equal(drawOnlyPayload.success, true);
    assert.ok(drawOnlyPayload.data?.numerology);
    assert.equal(typeof drawOnlyPayload.data?.numerology?.personalityCard?.nameChinese, 'string');

    const saveResponse = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            spreadId: 'single',
            question: '今天如何',
            birthDate: '1990-01-01',
            numerology: drawOnlyPayload.data?.numerology,
            cards: drawOnlyPayload.data?.cards,
        }),
    }));
    const savePayload = await saveResponse.json();

    assert.equal(saveResponse.status, 200);
    assert.equal(savePayload.success, true);
    const inserted = insertCalls.at(-1);
    assert.ok(inserted);
    assert.deepEqual(inserted.metadata, {
        birthDate: '1990-01-01',
        numerology: drawOnlyPayload.data?.numerology,
    });
});

test('tarot save should fail fast when metadata column is missing', async (t) => {

    const inserted: Record<string, unknown>[] = [];
    let insertAttempts = 0;
    const saveClient = {
        from(table: string) {
            assert.equal(table, 'tarot_readings');
            return {
                insert(payload: Record<string, unknown>) {
                    insertAttempts += 1;
                    inserted.push(payload);
                    return {
                        select() {
                            return {
                                single: async () => ({
                                    data: 'metadata' in payload ? null : { id: 'reading-2' },
                                    error: 'metadata' in payload
                                        ? {
                                            message: 'column \"metadata\" of relation \"tarot_readings\" does not exist',
                                            code: 'PGRST204',
                                        }
                                        : null,
                                }),
                            };
                        },
                    };
                },
            };
        },
    };

    t.mock.method(apiUtilsModule, 'requireUserContext', async () =>
        createMockAuthContext(saveClient, 'user-1'));

    const { POST } = await import('../app/api/tarot/route');

    const response = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            spreadId: 'single',
            question: '今天如何',
            birthDate: '1990-01-01',
            numerology: {
                personalityCard: { number: 1, name: 'The Magician', nameChinese: '魔术师' },
                soulCard: { number: 2, name: 'The High Priestess', nameChinese: '女祭司' },
                yearlyCard: { number: 19, name: 'The Sun', nameChinese: '太阳', year: 2026 },
            },
            cards: [
                {
                    card: { nameChinese: '测试牌', keywords: ['关键词'], uprightMeaning: '正位', reversedMeaning: '逆位' },
                    orientation: 'upright',
                },
            ],
        }),
    }));

    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '保存记录失败');
    assert.equal(insertAttempts, 1);
    assert.ok('metadata' in inserted[0]);
});

test('tarot spread persists reading for cookie-authenticated users without bearer header', async (t) => {

    const insertCalls: Record<string, unknown>[] = [];
    const persistClient = {
        from(table: string) {
            assert.equal(table, 'tarot_readings');
            return {
                insert(payload: Record<string, unknown>) {
                    insertCalls.push(payload);
                    return {
                        select() {
                            return {
                                single: async () => ({
                                    data: { id: 'reading-cookie' },
                                    error: null,
                                }),
                            };
                        },
                    };
                },
            };
        },
    };

    t.mock.method(apiUtilsModule, 'getAuthContext', async () =>
        createMockAuthContext(persistClient, 'user-cookie'));

    const { POST } = await import('../app/api/tarot/route');
    const response = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'spread',
            spreadId: 'single',
            question: '今天如何',
        }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data?.readingId, 'reading-cookie');
    const inserted = insertCalls.at(-1);
    assert.ok(inserted);
    assert.equal(inserted.user_id, 'user-cookie');
});

test('tarot pilot draws, saves and prepares BYOK before independently authenticated atomic persistence', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    const analysis = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
    const chartDetail = require('../lib/ai/chart-prompt-detail') as typeof import('../lib/ai/chart-prompt-detail');
    const writes: CreateAIAnalysisParams[] = [];
    let contextLoads = 0;
    let authCalls = 0;
    const saveClient = {
        from(table: string) {
            assert.equal(table, 'tarot_readings');
            return { insert: (payload: Record<string, unknown>) => {
                assert.equal(payload.user_id, 'user-1');
                return { select: () => ({ single: async () => ({ data: { id: 'reading-pilot' }, error: null }) }) };
            } };
        },
    };
    mockRouteUserContext(t, saveClient);
    const authenticate = apiUtils.requireUserContext;
    t.mock.method(apiUtils, 'requireUserContext', async (...args: Parameters<typeof authenticate>) => {
        authCalls += 1;
        return authenticate(...args);
    });
    t.mock.method(apiUtils, 'getAuthContext', async () => createMockAuthContext({}, null));
    const account = t.mock.method(credits, 'getUserAuthInfo', async () => ({
        credits: 0, effectiveMembership: 'free', hasCredits: false,
    }));
    t.mock.method(require('../lib/ai/ai-access'), 'resolveModelAccessAsync', async () => { assert.fail('BYOK must not require a platform model'); });
    t.mock.method(credits, 'attemptCreditUse', async () => { assert.fail('BYOK must not charge'); });
    t.mock.method(ai, 'callAIWithReasoning', async () => { assert.fail('BYOK inference belongs to browser'); });
    t.mock.method(ai, 'callAIUIMessageResult', async () => { assert.fail('BYOK inference belongs to browser'); });
    t.mock.method(chartDetail, 'loadResolvedChartPromptDetailLevel', async (userId: string) => {
        assert.equal(userId, 'user-1');
        contextLoads += 1;
        return 'default';
    });
    t.mock.method(analysis, 'createAIAnalysisConversation', async (params: CreateAIAnalysisParams) => {
        writes.push(params);
        return 'conversation-pilot';
    });
    const { POST } = await import('../app/api/tarot/route');
    const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const draw = await post({ action: 'draw-only', spreadId: 'single', seed: 'pilot' });
    const drawn = await draw.json() as { data: { cards: unknown[]; seed: string } };
    assert.equal(draw.status, 200);
    assert.equal(drawn.data.cards.length, 1);
    const input = { spreadId: 'single', cards: drawn.data.cards, seed: drawn.data.seed, question: '今天如何' };
    const saved = await post({ ...input, action: 'save' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).data.readingId, 'reading-pilot');
    const prepare = await post({ ...input, readingId: 'reading-pilot', action: 'interpret_prepare' });
    const prepared = await prepare.json();
    assert.equal(prepare.status, 200);
    assert.equal(typeof prepared.data.systemPrompt, 'string');
    assert.equal(typeof prepared.data.userPrompt, 'string');
    assert.equal(writes.length, 0);
    const persist = await post({
        ...input, readingId: 'reading-pilot', action: 'interpret_persist',
        content: 'browser analysis', reasoningText: 'browser reasoning', customModelId: ' custom-model ',
    });
    assert.equal(persist.status, 200);
    assert.deepEqual(await persist.json(), { success: true, data: { conversationId: 'conversation-pilot' } });
    assert.equal(authCalls, 3, 'save, prepare and persist must each authenticate');
    assert.equal(account.mock.callCount(), 1, 'only BYOK prepare validates account membership');
    assert.equal(contextLoads, 2, 'persist must reload server context independently');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].userId, 'user-1');
    assert.equal(writes[0].sourceType, 'tarot');
    assert.equal(writes[0].aiResponse, 'browser analysis');
    assert.equal(writes[0].sourceData.model_id, 'custom:custom-model');
    assert.equal(writes[0].sourceData.custom_provider, true);
    assert.equal(writes[0].sourceData.reasoning_text, 'browser reasoning');
    assert.equal(writes[0].historyBinding?.type, 'tarot');
    assert.equal(writes[0].historyBinding?.payload.reading_id, 'reading-pilot');

    t.mock.method(apiUtils, 'requireUserContext', async () => ({ error: { message: '请先登录', status: 401 } }));
    const denied = await post({ ...input, action: 'interpret_persist', content: 'untrusted' });
    assert.equal(denied.status, 401);
    assert.equal(contextLoads, 2);
    assert.equal(writes.length, 1, 'a prior prepare never authorizes a later persist request');
});
