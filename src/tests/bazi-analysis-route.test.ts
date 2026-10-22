import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState } from './helpers/route-mock';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

beforeEach((t) => {
    assert.ok('mock' in t);
    let networkCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        networkCalls += 1;
        throw new Error('Unexpected network request');
    });
    t.after(() => assert.equal(networkCalls, 0, 'chart analysis tests must not attempt network access'));
});

function mockBaziUserContext(
    t: import('node:test').TestContext,
    scoped: unknown,
    route: 'bazi' | 'ziwei' = 'bazi',
) {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const routePath = require.resolve(route === 'bazi' ? '../app/api/bazi/analysis/route' : '../app/api/ziwei/analysis/route');
    const pipelinePath = require.resolve('../lib/api/divination-pipeline');
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetSystemAdminClient = apiUtils.getSystemAdminClient;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: scoped,
        accessToken: 'test-token',
    })) as unknown as typeof apiUtils.requireUserContext;

    apiUtils.getSystemAdminClient = (() => ({})) as unknown as typeof apiUtils.getSystemAdminClient;

    delete require.cache[routePath];
    delete require.cache[pipelinePath];

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getSystemAdminClient = originalGetSystemAdminClient;
        delete require.cache[routePath];
        delete require.cache[pipelinePath];
    });
}


const BASE_SETTINGS = {
    expression_style: 'direct',
    custom_instructions: '',
    user_profile: {},
    prompt_kb_ids: [],
    visualization_settings: {
        selectedDimensions: ['career', 'wealth'],
        dayunDisplayCount: 6,
        chartStyle: 'classic-chinese',
    },
};

function createAnalysisScoped(options: {
    profile?: Record<string, unknown> | null;
    events?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown> | null;
} = {}) {
    const chart = {
        id: '11111111-1111-1111-1111-111111111111',
        user_id: 'user-1',
        name: '张三',
        gender: 'male',
        birth_date: '1990-01-01',
        birth_time: '08:00',
        birth_place: '北京',
        calendar_type: 'solar',
        is_leap_month: false,
    };
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const query = {
                    select() { return query; },
                    where() { return query; },
                    orderBy() { return query; },
                    limit() { return query; },
                    async executeTakeFirst() {
                        if (table === 'bazi_charts') return chart;
                        if (table === 'bazi_case_profiles') return options.profile ?? undefined;
                        if (table === 'user_settings') {
                            return options.settings === undefined ? BASE_SETTINGS : options.settings ?? undefined;
                        }
                        return undefined;
                    },
                    async execute() {
                        return table === 'bazi_case_events' ? options.events ?? [] : [];
                    },
                };
                return query;
            },
        } as never),
    });
}

function setupChartAdmission(t: import('node:test').TestContext, route: 'bazi' | 'ziwei') {
    mockAIFeatureState(t);
    const events: string[] = [];
    const control = { ownsChart: true, memberAllowed: true, hasCredits: true, debitOk: true, limitAllowed: true };
    const chart = {
        id: '11111111-1111-1111-1111-111111111111', user_id: 'user-1', name: 'Chart',
        gender: 'male', birth_date: '1990-01-01', birth_time: '08:00', calendar_type: 'solar', is_leap_month: false,
        timezone: undefined as string | undefined,
        disambiguation: undefined as 'later' | undefined,
    };
    const reconstructedInputs: Array<{ timezone?: string; disambiguation?: string }> = [];
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.ok(table === `${route}_charts` || table === 'user_settings');
                let columns: string[] = [];
                const query = {
                    select(selection: string | readonly string[]) {
                        columns = Array.isArray(selection)
                            ? [...selection]
                            : String(selection).split(',').map((column) => column.trim());
                        if (table === `${route}_charts`) {
                            assert.ok(columns.includes('timezone'));
                            assert.ok(columns.includes('disambiguation'));
                        }
                        return query;
                    },
                    where() { return query; },
                    orderBy() { return query; },
                    limit() { return query; },
                    async executeTakeFirst() {
                        if (table === `${route}_charts`) {
                            events.push('ownership');
                            return control.ownsChart ? chart : undefined;
                        }
                        return undefined;
                    },
                    async execute() { return []; },
                };
                return query;
            },
        } as never),
    });
    mockBaziUserContext(t, scoped, route);
    const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
    const access = require('../lib/ai/ai-access') as typeof import('../lib/ai/ai-access');
    const ai = require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    const persistence = require('../lib/ai/ai-analysis') as typeof import('../lib/ai/ai-analysis');
    const limits = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
    const detail = require('../lib/ai/chart-prompt-detail') as typeof import('../lib/ai/chart-prompt-detail');
    const analysis = require('../lib/server/analysis') as typeof import('../lib/server/analysis');
    t.mock.method(detail, 'loadResolvedChartPromptDetailLevel', async () => 'full');
    if (route === 'bazi') {
        t.mock.method(require('../lib/server/bazi-case-profile'), 'getBaziCaseProfileByChartId', async () => null);
        t.mock.method(require('../lib/bazi-prompt'), 'formatBaziPromptText', (input: { timezone?: string; disambiguation?: string }) => {
            reconstructedInputs.push(input);
            return 'authorized chart';
        });
    } else {
        const ziwei = require('../lib/divination/ziwei');
        t.mock.method(ziwei, 'calculateZiweiChartBundle', (input: { timezone?: string; disambiguation?: string }) => {
            reconstructedInputs.push(input);
            return { output: {}, astrolabe: {} };
        });
        t.mock.method(ziwei, 'generateZiweiChartText', () => 'authorized chart');
    }
    t.mock.method(credits, 'getUserAuthInfo', async () => {
        events.push('account');
        return { effectiveMembership: 'free', hasCredits: control.hasCredits, credits: control.hasCredits ? 1 : 0 };
    });
    t.mock.method(access, 'resolveModelAccessAsync', async () => {
        events.push('membership');
        return control.memberAllowed ? { modelId: 'test-model', reasoningEnabled: false } : { error: 'membership denied', status: 403 };
    });
    t.mock.method(credits, 'attemptCreditUse', async () => {
        events.push('debit');
        return control.debitOk ? { ok: true, remaining: 0 } : { ok: false, reason: 'deduction_failed' };
    });
    t.mock.method(limits, 'checkRateLimit', async (identifier: string, endpoint: string, config: unknown) => {
        events.push('limit');
        assert.equal(identifier, '198.51.100.10');
        assert.equal(endpoint, `/api/${route}/analysis`);
        assert.deepEqual(config, { maxRequests: 10, windowMs: 60_000 });
        return { allowed: control.limitAllowed, remaining: 0, resetAt: new Date() };
    });
    t.mock.method(credits, 'refundCreditsOrLog', async () => { events.push('refund'); return true; });
    const originalPrepare = analysis.prepareAnalysis;
    t.mock.method(analysis, 'prepareAnalysis', async (...args: Parameters<typeof originalPrepare>) => {
        events.push('prompt');
        return originalPrepare(...args);
    });
    t.mock.method(ai, 'callAIWithReasoning', async () => { events.push('infer'); return { content: 'analysis', reasoning: null }; });
    t.mock.method(persistence, 'createAIAnalysisConversation', async () => { events.push('save'); return 'conversation-1'; });
    const modulePath = route === 'bazi' ? '../app/api/bazi/analysis/route' : '../app/api/ziwei/analysis/route';
    const { POST } = require(modulePath) as { POST: (request: NextRequest) => Promise<Response> };
    return {
        events, control, chart, reconstructedInputs,
        request: (body: Record<string, unknown> = {}) => POST(new NextRequest(`http://localhost/api/${route}/analysis`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
            body: JSON.stringify({ chartId: chart.id, type: 'wuxing', modelId: 'test-model', ...body }),
        })),
    };
}

for (const route of ['bazi', 'ziwei'] as const) {
    for (const result of ['allowed', 'limited', 'membership', 'balance', 'debit', 'ownership'] as const) {
        test(`${route} ${result} preserves IP 10/min policy and ownership/member/debit/limit ordering`, async (t) => {
            const state = setupChartAdmission(t, route);
            state.control.ownsChart = result !== 'ownership';
            state.control.memberAllowed = result !== 'membership';
            state.control.hasCredits = result !== 'balance' && result !== 'membership';
            state.control.debitOk = result !== 'debit';
            state.control.limitAllowed = result !== 'limited';
            const response = await state.request();
            assert.equal(response.status, { allowed: 200, limited: 429, membership: 403, balance: 402, debit: 500, ownership: 404 }[result]);
            const expected = ['ownership'];
            if (result !== 'ownership') expected.push('account', 'membership');
            if (['debit', 'limited', 'allowed'].includes(result)) expected.push('debit');
            if (['limited', 'allowed'].includes(result)) expected.push('limit');
            if (result === 'limited') expected.push('refund');
            if (result === 'allowed') expected.push('prompt', 'infer', 'save');
            assert.deepEqual(state.events, expected);
        });
    }
}

for (const route of ['bazi', 'ziwei'] as const) {
    test(`${route} analysis reconstructs saved time options and ignores client overrides`, async (t) => {
        const state = setupChartAdmission(t, route);
        state.chart.timezone = 'America/New_York';
        state.chart.disambiguation = 'later';
        const response = await state.request({ timezone: 'Asia/Shanghai', disambiguation: 'earlier' });
        assert.equal(response.status, 200);
        assert.equal(state.reconstructedInputs.length, 1);
        assert.equal(state.reconstructedInputs[0].timezone, 'America/New_York');
        assert.equal(state.reconstructedInputs[0].disambiguation, 'later');
    });

    test(`${route} analysis remains compatible with charts lacking saved time options`, async (t) => {
        const state = setupChartAdmission(t, route);
        const response = await state.request();
        assert.equal(response.status, 200);
        assert.equal(state.reconstructedInputs.length, 1);
        assert.equal(state.reconstructedInputs[0].timezone, route === 'ziwei' ? 'Asia/Shanghai' : undefined);
        assert.equal(state.reconstructedInputs[0].disambiguation, route === 'ziwei' ? 'reject' : undefined);
    });
}

test('ziwei analysis rejects malformed saved birth time instead of reinterpreting it', async (t) => {
    const state = setupChartAdmission(t, 'ziwei');
    state.chart.birth_time = '8:0';
    const response = await state.request();
    assert.equal(response.status, 400);
    assert.equal(state.reconstructedInputs.length, 0);
});

for (const limited of [false, true]) {
    test(`bazi direct prepare ${limited ? 'denied' : 'allowed'} retains IP quota after account and never debits`, async (t) => {
        const state = setupChartAdmission(t, 'bazi');
        state.control.hasCredits = false;
        state.control.memberAllowed = false;
        state.control.limitAllowed = !limited;
        const response = await state.request({ action: 'direct_prepare' });
        assert.equal(response.status, limited ? 429 : 200);
        assert.deepEqual(state.events, ['ownership', 'account', 'limit', ...(!limited ? ['prompt'] : [])]);
        state.events.length = 0;
        const saved = await state.request({ action: 'direct_persist', content: 'browser analysis', customModelId: 'private-model' });
        assert.equal(saved.status, 200);
        assert.deepEqual(state.events, ['ownership', 'save']);
    });
}

test('bazi analysis route builds prompt from server chart context instead of client chartSummary', async (t) => {
  mockAIFeatureState(t);
    const creditsModule = require('../lib/user/credits') as any;
    const aiAccessModule = require('../lib/ai/ai-access') as any;
    const aiModule = require('../lib/ai/ai') as any;
    const rateLimitModule = require('../lib/rate-limit') as any;
    const aiAnalysisModule = require('../lib/ai/ai-analysis') as any;

    const originalGetUserAuthInfo = creditsModule.getUserAuthInfo;
    const originalAttemptCreditUse = creditsModule.attemptCreditUse;
    const originalRefundCreditsOrLog = creditsModule.refundCreditsOrLog;
    const originalResolveModelAccessAsync = aiAccessModule.resolveModelAccessAsync;
    const originalCallAIWithReasoning = aiModule.callAIWithReasoning;
    const originalCheckRateLimit = rateLimitModule.checkRateLimit;
    const originalGetClientIP = rateLimitModule.getClientIP;
    const originalCreateAIAnalysisConversation = aiAnalysisModule.createAIAnalysisConversation;

    let capturedUserPrompt = '';
    let capturedSystemPrompt = '';
    let capturedSourceData: Record<string, unknown> | null = null;
    const scoped = createAnalysisScoped({
        profile: {
            id: 'profile-1',
            user_id: 'user-1',
            bazi_chart_id: '11111111-1111-1111-1111-111111111111',
            master_review: {
                strengthLevel: '偏强',
                patterns: ['财格'],
                yongShen: { basic: ['水'], advanced: ['壬'] },
                xiShen: { basic: ['金'], advanced: [] },
                jiShen: { basic: ['火'], advanced: [] },
                xianShen: { basic: ['土'], advanced: [] },
                summary: '财可生官。',
            },
            owner_feedback: {
                occupation: '上班族',
                education: '本科',
                wealthLevel: '小康',
                marriageStatus: '已婚',
                healthStatus: '健康稳定',
                familyStatusTags: ['父母助力'],
                temperamentTags: ['务实'],
                summary: '近年工作稳定。',
            },
            created_at: '2026-03-20T00:00:00.000Z',
            updated_at: '2026-03-20T00:00:00.000Z',
        },
        events: [{
            id: 'event-1',
            profile_id: 'profile-1',
            user_id: 'user-1',
            bazi_chart_id: '11111111-1111-1111-1111-111111111111',
            event_date: '2024-06-01',
            category: '事业',
            title: '晋升',
            detail: '升任主管',
            created_at: '2026-03-20T00:00:00.000Z',
            updated_at: '2026-03-20T00:00:00.000Z',
        }],
    });
    mockBaziUserContext(t, scoped);

    creditsModule.getUserAuthInfo = async () => ({
        effectiveMembership: 'free',
        hasCredits: true,
    });
    creditsModule.attemptCreditUse = async () => ({ ok: true, remaining: 0 });
    creditsModule.refundCreditsOrLog = async () => true;
    aiAccessModule.resolveModelAccessAsync = async () => ({
        modelId: 'deepseek-v3.2',
        reasoningEnabled: false,
    });
    aiModule.callAIWithReasoning = async (messages: Array<{ content: string }>, _personality: string, _modelId: string, systemPrompt: string) => {
        capturedUserPrompt = messages[0]?.content || '';
        capturedSystemPrompt = systemPrompt;
        return {
            content: '分析结果',
            reasoning: null,
        };
    };
    rateLimitModule.checkRateLimit = async () => ({ allowed: true });
    rateLimitModule.getClientIP = () => '127.0.0.1';
    aiAnalysisModule.createAIAnalysisConversation = async (args: { sourceData: Record<string, unknown> }) => {
        capturedSourceData = args.sourceData;
        return 'conversation-1';
    };

    t.after(() => {
        creditsModule.getUserAuthInfo = originalGetUserAuthInfo;
        creditsModule.attemptCreditUse = originalAttemptCreditUse;
        creditsModule.refundCreditsOrLog = originalRefundCreditsOrLog;
        aiAccessModule.resolveModelAccessAsync = originalResolveModelAccessAsync;
        aiModule.callAIWithReasoning = originalCallAIWithReasoning;
        rateLimitModule.checkRateLimit = originalCheckRateLimit;
        rateLimitModule.getClientIP = originalGetClientIP;
        aiAnalysisModule.createAIAnalysisConversation = originalCreateAIAnalysisConversation;
    });

    const { POST } = await import('../app/api/bazi/analysis/route');
    const request = new NextRequest('http://localhost/api/bazi/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '11111111-1111-1111-1111-111111111111',
            type: 'wuxing',
            modelId: 'deepseek-v3.2',
            reasoning: false,
            stream: false,
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.match(capturedUserPrompt, /断事笔记/u);
    assert.match(capturedUserPrompt, /岗位晋升|晋升/u);
    assert.match(capturedSystemPrompt, /```chart/u);
    assert.match(capturedSystemPrompt, /chartType、title、data/u);
    assert.match(capturedSystemPrompt, /事业\/学业/u);
    assert.match(capturedSystemPrompt, /财富/u);
    assert.match(capturedSystemPrompt, /6 个大运周期/u);
    assert.match(capturedSystemPrompt, /古典中文图表风格/u);
    assert.match(capturedSystemPrompt, /wuxing_energy/u);
    assert.match(capturedSystemPrompt, /fortune_radar/u);
    assert.match(capturedSystemPrompt, /fortune_calendar/u);
    assert.equal(capturedSourceData?.['case_profile_id'], 'profile-1');
    assert.match(String(capturedSourceData?.['case_prompt_snapshot'] || ''), /命主反馈/u);
});

test('bazi analysis route surfaces SSE error when stream persistence returns null after content generation', async (t) => {
  mockAIFeatureState(t);
    const creditsModule = require('../lib/user/credits') as any;
    const aiAccessModule = require('../lib/ai/ai-access') as any;
    const aiModule = require('../lib/ai/ai') as any;
    const rateLimitModule = require('../lib/rate-limit') as any;
    const aiAnalysisModule = require('../lib/ai/ai-analysis') as any;

    const originalGetUserAuthInfo = creditsModule.getUserAuthInfo;
    const originalAttemptCreditUse = creditsModule.attemptCreditUse;
    const originalRefundCreditsOrLog = creditsModule.refundCreditsOrLog;
    const originalResolveModelAccessAsync = aiAccessModule.resolveModelAccessAsync;
    const originalCallAIUIMessageResult = aiModule.callAIUIMessageResult;
    const originalCheckRateLimit = rateLimitModule.checkRateLimit;
    const originalGetClientIP = rateLimitModule.getClientIP;
    const originalCreateAIAnalysisConversation = aiAnalysisModule.createAIAnalysisConversation;
    const originalConsoleError = console.error;

    let refundCalls = 0;
    const scoped = createAnalysisScoped({
        profile: null,
        events: [],
        settings: {
            expression_style: 'direct',
            custom_instructions: '',
            user_profile: {},
            prompt_kb_ids: [],
            visualization_settings: null,
        },
    });
    mockBaziUserContext(t, scoped);

    creditsModule.getUserAuthInfo = async () => ({
        effectiveMembership: 'free',
        hasCredits: true,
    });
    creditsModule.attemptCreditUse = async () => ({ ok: true, remaining: 0 });
    creditsModule.refundCreditsOrLog = async () => {
        refundCalls += 1;
        return true;
    };
    aiAccessModule.resolveModelAccessAsync = async () => ({
        modelId: 'deepseek-v3.2',
        reasoningEnabled: false,
    });
    aiModule.callAIUIMessageResult = async () => ({
        toUIMessageStream(options?: {
            onFinish?: (event: {
                responseMessage: { parts: Array<Record<string, unknown>> };
                finishReason?: string;
                isAborted: boolean;
                isContinuation: boolean;
                messages: Array<{ parts: Array<Record<string, unknown>> }>;
            }) => PromiseLike<void> | void;
        }) {
            const stream = new ReadableStream<Record<string, unknown>>({
                start(controller) {
                    controller.enqueue({ type: 'reasoning-start', id: 'reasoning-1' });
                    controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-1', delta: 'reason' });
                    controller.enqueue({ type: 'reasoning-end', id: 'reasoning-1' });
                    controller.enqueue({ type: 'text-start', id: 'text-1' });
                    controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'analysis' });
                    controller.enqueue({ type: 'text-end', id: 'text-1' });
                    controller.close();
                },
            });
            queueMicrotask(() => {
                void options?.onFinish?.({
                    responseMessage: {
                        parts: [
                            { type: 'reasoning', text: 'reason', state: 'done' },
                            { type: 'text', text: 'analysis', state: 'done' },
                        ],
                    },
                    finishReason: 'stop',
                    isAborted: false,
                    isContinuation: false,
                    messages: [],
                });
            });
            return stream;
        },
    });
    rateLimitModule.checkRateLimit = async () => ({ allowed: true });
    rateLimitModule.getClientIP = () => '127.0.0.1';
    aiAnalysisModule.createAIAnalysisConversation = async () => null;
    console.error = () => {};

    t.after(() => {
        creditsModule.getUserAuthInfo = originalGetUserAuthInfo;
        creditsModule.attemptCreditUse = originalAttemptCreditUse;
        creditsModule.refundCreditsOrLog = originalRefundCreditsOrLog;
        aiAccessModule.resolveModelAccessAsync = originalResolveModelAccessAsync;
        aiModule.callAIUIMessageResult = originalCallAIUIMessageResult;
        rateLimitModule.checkRateLimit = originalCheckRateLimit;
        rateLimitModule.getClientIP = originalGetClientIP;
        aiAnalysisModule.createAIAnalysisConversation = originalCreateAIAnalysisConversation;
        console.error = originalConsoleError;
    });

    const { POST } = await import('../app/api/bazi/analysis/route');
    const request = new NextRequest('http://localhost/api/bazi/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '11111111-1111-1111-1111-111111111111',
            type: 'wuxing',
            modelId: 'deepseek-v3.2',
            reasoning: false,
            stream: true,
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
