import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { ensureRouteTestEnv, mockAIFeatureState, mockAIRateLimit, mockRouteUserContext, blockRouteNetwork } from './helpers/route-mock';
import { createMockUIMessageResult } from './helpers/ui-message-result';
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

test('qimen route persists analysis after streaming completes', async (t) => {
  mockAIFeatureState(t);
    mockAIRateLimit(t);

    const createCalls: CreateAIAnalysisParams[] = [];

    mockRouteUserContext(t, {
        from() {
            throw new Error('qimen history test should not query tables directly');
        },
        rpc() {
            throw new Error('qimen history test should not call rpc directly');
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

    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            chartId: 'chart-1',
            question: '测试问题',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            timezone: 'Asia/Shanghai',
            panType: 'zhuan',
            juMethod: 'chaibu',
            zhiFuJiGong: 'jiLiuYi',
        }),
    });

    const response = await POST(request);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    const createArgs = createCalls.at(-1);
    assert.ok(createArgs);
    assert.equal(createArgs.sourceType, 'qimen');
    assert.equal(createArgs.historyBinding?.type, 'qimen');
    assert.equal(createArgs.historyBinding?.payload.chart_id, 'chart-1');
});

test('qimen route surfaces SSE error when stream persistence fails after content generation', async (t) => {
  mockAIFeatureState(t);
    mockAIRateLimit(t);
    const refundCalls: Array<Parameters<typeof import('../lib/user/credits').addCredits>> = [];

    mockRouteUserContext(t, {
        from() {
            throw new Error('qimen history test should not query tables directly');
        },
        rpc() {
            throw new Error('qimen history test should not call rpc directly');
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

    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'interpret',
            stream: true,
            chartId: 'chart-1',
            question: '测试问题',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            timezone: 'Asia/Shanghai',
            panType: 'zhuan',
            juMethod: 'chaibu',
            zhiFuJiGong: 'jiLiuYi',
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

test('qimen save persists base inputs instead of chart_data', async (t) => {
    const insertCalls: Record<string, unknown>[] = [];
    const authClient = {
        from: (table: string) => {
            assert.equal(table, 'qimen_charts');
            return {
                insert: (payload: Record<string, unknown>) => {
                    insertCalls.push(payload);
                    return {
                        select: () => ({
                            single: async () => ({
                                data: { id: 'chart-1' },
                                error: null,
                            }),
                        }),
                    };
                },
            };
        },
    };

    mockRouteUserContext(t, authClient);

    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '测试问题',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            timezone: 'Asia/Shanghai',
            panType: 'zhuan',
            juMethod: 'chaibu',
            zhiFuJiGong: 'jiLiuYi',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.chartId, 'chart-1');
    const insertedRecord = insertCalls.at(-1);
    assert.ok(insertedRecord);
    assert.equal(insertedRecord.question, '测试问题');
    assert.equal(insertedRecord.year, 2025);
    assert.equal(insertedRecord.month, 1);
    assert.equal(insertedRecord.day, 15);
    assert.equal(insertedRecord.hour, 10);
    assert.equal(insertedRecord.minute, 30);
    assert.equal(insertedRecord.timezone, 'Asia/Shanghai');
    assert.equal(insertedRecord.pan_type, 'zhuan');
    assert.equal(insertedRecord.ju_method, 'chaibu');
    assert.equal(insertedRecord.zhi_fu_ji_gong, 'ji_liuyi');
    assert.equal(typeof insertedRecord.chart_time, 'string');
    assert.ok(!('chart_data' in insertedRecord));
});

test('qimen route rejects unsupported juMethod before auth', async () => {
    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'calculate',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            juMethod: 'zhirun',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '定局法无效');
});

test('qimen route rejects unsupported zhiFuJiGong before auth', async () => {
    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'calculate',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            zhiFuJiGong: 'invalid-value',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '直符寄宫配置无效');
});
