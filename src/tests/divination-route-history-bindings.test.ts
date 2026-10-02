import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { ensureRouteTestEnv, mockAIFeatureState, mockAIRateLimit } from './helpers/route-mock';
import { createMockUIMessageResult } from './helpers/ui-message-result';
import { createMockAuthContext } from './helpers/supabase-mock';
import type { CreateAIAnalysisParams } from '../lib/ai/ai-analysis';

ensureRouteTestEnv();

type RouteBindingSpec = {
    name: string;
    routeModulePath: string;
    url: string;
    buildBody: () => Record<string, unknown>;
    assertCreateArgs: (createArgs: CreateAIAnalysisParams) => void;
};

async function runRouteHistoryBindingTest(t: TestContext, spec: RouteBindingSpec) {
  mockAIFeatureState(t);
    mockAIRateLimit(t);
    const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const credits = require('../lib/user/credits') as any;
    const aiAccessModule = require('../lib/ai/ai-access') as any;
    const aiModule = require('../lib/ai/ai') as any;
    const aiAnalysisModule = require('../lib/ai/ai-analysis') as any;
    const chartPromptDetailModule = require('../lib/ai/chart-prompt-detail') as any;

    const originalRequireUserContext = apiUtilsModule.requireUserContext;
    const originalGetUserAuthInfo = credits.getUserAuthInfo;
    const originalAttemptCreditUse = credits.attemptCreditUse;
    const originalResolveModelAccessAsync = aiAccessModule.resolveModelAccessAsync;
    const originalCallAIUIMessageResult = aiModule.callAIUIMessageResult;
    const originalCreateConversation = aiAnalysisModule.createAIAnalysisConversation;
    const originalLoadResolvedChartPromptDetailLevel = chartPromptDetailModule.loadResolvedChartPromptDetailLevel;
    const routePath = require.resolve(spec.routeModulePath);

    const createCalls: CreateAIAnalysisParams[] = [];
    const mockDb = {
        from() {
            throw new Error('db.from should not be called in history binding route tests');
        },
        rpc() {
            throw new Error('db.rpc should not be called in history binding route tests');
        },
    };

    apiUtilsModule.requireUserContext = async () => createMockAuthContext(mockDb);
    credits.getUserAuthInfo = async () => ({ credits: 10, effectiveMembership: 'pro', hasCredits: true });
    credits.attemptCreditUse = async () => ({ ok: true, remaining: 9 });
    aiAccessModule.resolveModelAccessAsync = async () => ({
        modelId: 'test-model',
        modelConfig: {
            id: 'test-model',
            modelKey: 'test-model',
            vendor: 'test',
            usageType: 'chat',
            supportsReasoning: true,
            supportsVision: false,
            requiredTier: 'free',
        },
        reasoningEnabled: false,
    });
    aiModule.callAIUIMessageResult = async () => createMockUIMessageResult();
    aiAnalysisModule.createAIAnalysisConversation = async (params: CreateAIAnalysisParams) => {
        createCalls.push(params);
        return 'conv-1';
    };
    chartPromptDetailModule.loadResolvedChartPromptDetailLevel = async () => 'default';
    delete require.cache[routePath];

    t.after(() => {
        apiUtilsModule.requireUserContext = originalRequireUserContext;
        credits.getUserAuthInfo = originalGetUserAuthInfo;
        credits.attemptCreditUse = originalAttemptCreditUse;
        aiAccessModule.resolveModelAccessAsync = originalResolveModelAccessAsync;
        aiModule.callAIUIMessageResult = originalCallAIUIMessageResult;
        aiAnalysisModule.createAIAnalysisConversation = originalCreateConversation;
        chartPromptDetailModule.loadResolvedChartPromptDetailLevel = originalLoadResolvedChartPromptDetailLevel;
        delete require.cache[routePath];
    });

    const { POST } = require(spec.routeModulePath) as { POST: (request: NextRequest) => Promise<Response> };
    const response = await POST(new NextRequest(spec.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify(spec.buildBody()),
    }));

    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    const createArgs = createCalls.at(-1);
    assert.ok(createArgs, `${spec.name} route should create a conversation`);
    spec.assertCreateArgs(createArgs);
}

const routeSpecs: RouteBindingSpec[] = [
    {
        name: 'mbti',
        routeModulePath: '../app/api/mbti/route',
        url: 'http://localhost/api/mbti',
        buildBody: () => ({
            action: 'analyze',
            stream: true,
            readingId: 'reading-1',
            type: 'INTJ',
            scores: { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 },
            percentages: {
                EI: { E: 50, I: 50 },
                SN: { S: 50, N: 50 },
                TF: { T: 50, F: 50 },
                JP: { J: 50, P: 50 },
            },
        }),
        assertCreateArgs: (createArgs) => {
            const historyBinding = createArgs.historyBinding;
            assert.equal(createArgs.sourceType, 'mbti');
            assert.equal(historyBinding?.type, 'mbti');
            assert.equal(historyBinding?.payload?.reading_id, 'reading-1');
        },
    },
    {
        name: 'hepan',
        routeModulePath: '../app/api/hepan/route',
        url: 'http://localhost/api/hepan',
        buildBody: () => ({
            action: 'analyze',
            stream: true,
            chartId: 'chart-1',
            result: {
                type: 'love',
                person1: { name: 'A', year: 1990, month: 1, day: 1, hour: 1 },
                person2: { name: 'B', year: 1991, month: 2, day: 2, hour: 2 },
                overallScore: 80,
                dimensions: [{ name: '测试', score: 80, description: 'ok' }],
                conflicts: [],
                createdAt: new Date(),
            },
        }),
        assertCreateArgs: (createArgs) => {
            const historyBinding = createArgs.historyBinding;
            assert.equal(createArgs.sourceType, 'hepan');
            assert.equal(historyBinding?.type, 'hepan');
            assert.equal(historyBinding?.payload?.chart_id, 'chart-1');
        },
    },
    {
        name: 'daliuren',
        routeModulePath: '../app/api/daliuren/route',
        url: 'http://localhost/api/daliuren',
        buildBody: () => {
            const { calculateDaliuren } = require('taibu-core') as typeof import('taibu-core');
            return {
                action: 'interpret',
                stream: true,
                divinationId: 'divination-1',
                question: '测试问题',
                resultData: calculateDaliuren({
                    date: '2025-01-15',
                    hour: 10,
                    minute: 30,
                    timezone: 'Asia/Shanghai',
                    question: '测试问题',
                }),
            };
        },
        assertCreateArgs: (createArgs) => {
            const historyBinding = createArgs.historyBinding;
            assert.equal(createArgs.sourceType, 'daliuren');
            assert.equal(historyBinding?.type, 'daliuren');
            assert.equal(historyBinding?.payload?.divination_id, 'divination-1');
        },
    },
    {
        name: 'meihua',
        routeModulePath: '../app/api/meihua/route',
        url: 'http://localhost/api/meihua',
        buildBody: () => {
            const { calculateMeihuaBundle } = require('../lib/divination/meihua') as typeof import('../lib/divination/meihua');
            const resultData = calculateMeihuaBundle({
                question: '梅花解读测试',
                date: '2026-04-04T10:30',
                method: 'number_pair',
                numbers: [2, 7],
            });
            resultData.result.mainHexagram.name = '客户端伪造卦名';
            return {
                action: 'interpret',
                stream: true,
                divinationId: 'meihua-1',
                resultData,
            };
        },
        assertCreateArgs: (createArgs) => {
            const sourceData = createArgs.sourceData as Record<string, unknown> | undefined;
            const historyBinding = createArgs.historyBinding;
            assert.equal(createArgs.sourceType, 'meihua');
            assert.notEqual(sourceData?.main_hexagram, '客户端伪造卦名');
            assert.equal(historyBinding?.type, 'meihua');
            assert.equal(historyBinding?.payload?.divination_id, 'meihua-1');
        },
    },
    {
        name: 'xiaoliuren',
        routeModulePath: '../app/api/xiaoliuren/route',
        url: 'http://localhost/api/xiaoliuren',
        buildBody: () => {
            const { calculateXiaoliurenBundle } = require('../lib/divination/xiaoliuren') as typeof import('../lib/divination/xiaoliuren');
            const resultData = calculateXiaoliurenBundle({
                date: '2025-08-01T01:00',
                question: '小六壬解读测试',
            });
            resultData.result.hourStatus = '客户端伪造落宫' as never;
            return {
                action: 'interpret',
                stream: true,
                divinationId: 'xiaoliuren-1',
                resultData,
            };
        },
        assertCreateArgs: (createArgs) => {
            const sourceData = createArgs.sourceData as Record<string, unknown> | undefined;
            const historyBinding = createArgs.historyBinding;
            assert.equal(createArgs.sourceType, 'xiaoliuren');
            assert.notEqual(sourceData?.final_status, '客户端伪造落宫');
            assert.equal(sourceData?.shichen, '丑时');
            assert.equal(historyBinding?.type, 'xiaoliuren');
            assert.equal(historyBinding?.payload?.divination_id, 'xiaoliuren-1');
        },
    },
];

for (const spec of routeSpecs) {
    test(`${spec.name} route persists analysis after streaming completes`, async (t) => {
        await runRouteHistoryBindingTest(t, spec);
    });
}
