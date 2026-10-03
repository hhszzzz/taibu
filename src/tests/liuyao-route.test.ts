import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { ensureRouteTestEnv, mockAIFeatureState, mockAIRateLimit, mockRouteUserContext, blockRouteNetwork } from './helpers/route-mock';
import { createMockSupabaseClient } from './helpers/supabase-mock';
import { createMockUIMessageResult } from './helpers/ui-message-result';
import type { CreateAIAnalysisParams } from '../lib/ai/ai-analysis';

ensureRouteTestEnv();

// The CommonJS test loader keeps imported function lookups live; no cache eviction is needed.
beforeEach((t) => {
    assert.ok('mock' in t);
    blockRouteNetwork(t);
});

const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
const aiAnalysisModule = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
const aiModule = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
const liuyaoModule = require('../lib/divination/liuyao') as typeof import('../lib/divination/liuyao');
const aiAccessModule = require('../lib/ai/ai-access') as typeof import('../lib/ai/ai-access');
const chartPromptDetailModule = require('../lib/ai/chart-prompt-detail') as typeof import('../lib/ai/chart-prompt-detail');

function readingClient(data: Record<string, unknown>, captureUpdate?: (payload: unknown) => void) {
    const client = createMockSupabaseClient({ tables: { liuyao_divinations: { data, captureUpdate } } });
    return {
        from(table: string) {
            assert.equal(table, 'liuyao_divinations');
            return client.from(table);
        },
    };
}

test('liuyao route uses divination created_at for analysis date', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    const originalCalculateLiuyaoBundle = liuyaoModule.calculateLiuyaoBundle;

    const createdAt = new Date('2024-01-02T03:04:05.000Z');
    let capturedDate: Date | undefined;
    const authClient = readingClient({ created_at: createdAt.toISOString() });

    mockRouteUserContext(t, authClient);
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 5 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async () => 'conv-1');
    t.mock.method(aiModule, 'callAIWithReasoning', async () => ({ content: 'analysis' }));
    t.mock.method(liuyaoModule, 'calculateLiuyaoBundle', (...args: Parameters<typeof originalCalculateLiuyaoBundle>) => {
        capturedDate = args[0].date;
        return originalCalculateLiuyaoBundle(...args);
    });

    const { POST } = await import('../app/api/liuyao/route');

    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            divinationId: 'divination-1',
            question: '测试问题',
            yongShenTargets: ['官鬼'],
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);

    assert.equal(response.status, 200);
    assert.ok(capturedDate);
    assert.equal(capturedDate?.toISOString(), createdAt.toISOString());
});

test('liuyao route only marks 用神 when position and liuqin both match', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    const calculate = liuyaoModule.calculateLiuyaoBundle;

    let capturedPrompt = '';

    mockRouteUserContext(t, {
        from() {
            throw new Error('liuyao prompt test should not query tables directly');
        },
        rpc() {
            throw new Error('liuyao prompt test should not call rpc directly');
        },
    });
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(aiModule, 'callAIWithReasoning', async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content ?? '';
        return { content: 'analysis', reasoning: null };
    });
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async () => 'conv-1');
    t.mock.method(aiAnalysisModule, 'generateLiuyaoTitle', () => 'title');
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');
    const mismatchedYongShen = t.mock.method(liuyaoModule, 'calculateLiuyaoBundle', (...args: Parameters<typeof calculate>) => {
        const bundle = calculate(...args);
        const firstYao = bundle.output.fullYaos?.[0];
        const firstGroup = bundle.output.yongShen?.[0];
        assert.ok(firstYao);
        assert.ok(firstGroup?.selected);
        const fallbackLiuQin = firstYao.liuQin === '父母' ? '官鬼' : '父母';
        return {
            ...bundle,
            output: {
                ...bundle.output,
                yongShen: [{
                    ...firstGroup,
                    targetLiuQin: fallbackLiuQin,
                    selected: { ...firstGroup.selected, position: 1, liuQin: fallbackLiuQin },
                }],
            },
        };
    });

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            question: '测试问题',
            yongShenTargets: ['父母'],
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    assert.equal(response.status, 200);

    const firstLine = capturedPrompt.match(/\| 初[九六] \|[^\n]*/u)?.[0] ?? '';
    assert.ok(firstLine.length > 0, 'should include first yao row in prompt');
    assert.equal(capturedPrompt.includes('【用神】'), false, 'fallback liuqin mismatch should not mark 用神');
    assert.equal(mismatchedYongShen.mock.callCount(), 1, 'the mismatch fixture must reach the active chart builder');
});

test('liuyao route persists analysis after streaming completes', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    const createCalls: CreateAIAnalysisParams[] = [];
    const authClient = readingClient({ created_at: new Date().toISOString() });

    mockRouteUserContext(t, authClient);
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(aiModule, 'callAIUIMessageResult', async () => createMockUIMessageResult());
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async (params: CreateAIAnalysisParams) => {
        createCalls.push(params);
        return 'conv-1';
    });
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');

    const { POST } = await import('../app/api/liuyao/route');

    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            divinationId: 'divination-1',
            question: '测试问题',
            yongShenTargets: ['官鬼'],
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const createArgs = createCalls.at(-1);
    assert.ok(createArgs);
    assert.equal(createArgs.sourceType, 'liuyao');
    assert.equal(createArgs.historyBinding?.type, 'liuyao');
    assert.equal(createArgs.historyBinding?.payload.divination_id, 'divination-1');
});

test('liuyao route surfaces SSE error when stream persistence fails after content generation', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    let refundCalls = 0;
    const authClient = readingClient({ created_at: new Date().toISOString() });

    mockRouteUserContext(t, authClient);
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 9 }));
    t.mock.method(aiAccessModule, 'resolveModelAccessAsync', async () => ({ modelId: 'test-model', reasoningEnabled: false }));
    t.mock.method(credits, 'addCredits', async () => { refundCalls += 1; });
    t.mock.method(aiModule, 'callAIUIMessageResult', async () => createMockUIMessageResult());
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async () => {
        throw new Error('persist failed');
    });
    t.mock.method(chartPromptDetailModule, 'loadResolvedChartPromptDetailLevel', async () => 'default');
    t.mock.method(console, 'error', () => {});

    const { POST } = await import('../app/api/liuyao/route');

    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            divinationId: 'divination-1',
            question: '测试问题',
            yongShenTargets: ['官鬼'],
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    assert.match(body, /"type":"text-delta","id":"text-1","delta":"analysis"/u);
    assert.match(body, /"type":"error","errorText":"保存结果失败，请稍后重试"/u);
    assert.match(body, /\[DONE\]/u);
    assert.equal(refundCalls, 1);
});

test('liuyao route save returns 400 when question is provided but yongShenTargets is missing', async () => {

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '测试问题',
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '请至少选择一个分析目标');
});

test('liuyao route save returns 400 when question is not string', async () => {
    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: 123,
            yongShenTargets: [],
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '问题格式错误');
});

test('liuyao route interpret returns 400 when question is provided but yongShenTargets is missing', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    mockRouteUserContext(t, {
        from: () => assert.fail('invalid targets must fail before database queries'),
    });

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            question: '测试问题',
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '请至少选择一个分析目标');
});

test('liuyao route interpret enforces targets when persisted question exists but request question is empty', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);
    const authClient = readingClient({ created_at: new Date().toISOString(), question: '这次考试是否顺利', yongshen_targets: null });

    mockRouteUserContext(t, authClient);
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 0, effectiveMembership: 'pro', hasCredits: false }));

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            divinationId: 'divination-1',
            question: '',
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, '请至少选择一个分析目标');
});

test('liuyao route save allows missing yongShenTargets when question is empty', async (t) => {
    const authClient = {
        from: () => ({
            insert: () => ({
                select: () => ({
                    single: async () => ({ data: { id: 'divination-1' }, error: null }),
                }),
            }),
        }),
    };

    mockRouteUserContext(t, authClient);

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '',
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
});

test('liuyao route rejects interpret when question is empty and persisted question is missing', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);

    let updated: unknown = null;
    const authClient = readingClient({ created_at: new Date().toISOString() }, (payload) => { updated = payload; });

    mockRouteUserContext(t, authClient);
    t.mock.method(credits, 'getUserAuthInfo', async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true }));
    t.mock.method(credits, 'attemptCreditUse', async () => ({ ok: true, remaining: 5 }));
    t.mock.method(aiModule, 'callAIWithReasoning', async () => ({ content: 'analysis', reasoning: null }));
    t.mock.method(aiAnalysisModule, 'createAIAnalysisConversation', async () => 'conv-1');

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            question: '',
            divinationId: 'divination-1',
            hexagram: {
                name: '乾为天',
                code: '111111',
                upperTrigram: '乾',
                lowerTrigram: '乾',
                element: '金',
                nature: '刚健',
            },
            yaos: [
                { type: 1, change: 'stable', position: 1 },
                { type: 1, change: 'stable', position: 2 },
                { type: 1, change: 'stable', position: 3 },
                { type: 1, change: 'stable', position: 4 },
                { type: 1, change: 'stable', position: 5 },
                { type: 1, change: 'stable', position: 6 },
            ],
            changedLines: [],
        }),
    });

    const response = await POST(request);
    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.error, '请先明确问题后再解卦');
    assert.equal(updated, null);
});

test('liuyao route update returns 404 when no record is updated', async (t) => {
    const authClient = {
        from: () => {
            const builder: Record<string, unknown> = {};
            builder.eq = () => builder;
            builder.select = async () => ({ data: [], error: null });
            builder.update = () => builder;
            return builder;
        },
    };

    mockRouteUserContext(t, authClient);

    const { POST } = await import('../app/api/liuyao/route');
    const request = new NextRequest('http://localhost/api/liuyao', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'update',
            divinationId: 'missing-id',
            yongShenTargets: ['官鬼'],
        }),
    });

    const response = await POST(request);
    assert.equal(response.status, 404);
});
