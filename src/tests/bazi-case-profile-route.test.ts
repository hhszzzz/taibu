import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

const CHART_ID = '11111111-1111-1111-1111-111111111111';
const CHART_ID_PATH = `?chartId=${CHART_ID}`;

type ProfileOptions = {
    chartExists?: boolean;
    profile?: Record<string, unknown> | null;
    events?: Array<Record<string, unknown>>;
    saveResult?: unknown;
    saveCalls?: Array<{ fn: string; args: Record<string, unknown> }>;
    rpc?: () => unknown;
};

function createCaseProfileScoped(options: ProfileOptions = {}) {
    const profile = options.profile === undefined ? {
        id: 'profile-1',
        user_id: 'user-1',
        bazi_chart_id: CHART_ID,
        master_review: {
            strengthLevel: '偏强',
            patterns: ['财格'],
            yongShen: { basic: ['水'], advanced: ['壬'] },
            xiShen: { basic: [], advanced: [] },
            jiShen: { basic: [], advanced: [] },
            xianShen: { basic: [], advanced: [] },
            summary: '测试',
        },
        owner_feedback: {
            occupation: '上班族',
            education: '本科',
            wealthLevel: '小康',
            marriageStatus: '已婚',
            healthStatus: '健康稳定',
            familyStatusTags: ['父母助力'],
            temperamentTags: ['务实'],
            summary: '稳定',
        },
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-20T00:00:00.000Z',
    } : options.profile;
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const query = {
                    select() { return query; },
                    where() { return query; },
                    orderBy() { return query; },
                    limit() { return query; },
                    async executeTakeFirst() {
                        if (table === 'bazi_charts') {
                            return options.chartExists === false ? undefined : { id: CHART_ID };
                        }
                        if (table === 'bazi_case_profiles') return profile ?? undefined;
                        return undefined;
                    },
                    async execute() {
                        return table === 'bazi_case_events' ? options.events ?? [] : [];
                    },
                };
                return query;
            },
        } as never),
        rpc: async (fn: string, args: Record<string, unknown>) => {
            options.saveCalls?.push({ fn, args });
            if (options.rpc) return options.rpc();
            return options.saveResult ?? { status: 'ok', profile_id: 'profile-1' };
        },
    });
}

function mockCaseProfileContext(t: import('node:test').TestContext, options: ProfileOptions = {}) {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const contextModule = require('../lib/db/context.server') as { systemDb: typeof import('../lib/db/context.server').systemDb };
    const scoped = createCaseProfileScoped(options);
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalSystemDb = contextModule.systemDb;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: scoped,
        accessToken: null,
    })) as unknown as typeof apiUtils.requireUserContext;
    contextModule.systemDb = (() => scoped) as typeof contextModule.systemDb;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        contextModule.systemDb = originalSystemDb;
    });
    return scoped;
}

test('bazi case profile GET returns current profile with events for owned chart', async (t) => {
    mockCaseProfileContext(t, {
        events: [{
            id: 'event-1',
            profile_id: 'profile-1',
            user_id: 'user-1',
            bazi_chart_id: CHART_ID,
            event_date: '2025-01-01',
            category: '事业',
            title: '岗位晋升',
            detail: '细节',
            created_at: '2026-03-20T00:00:00.000Z',
            updated_at: '2026-03-20T00:00:00.000Z',
        }],
    });

    const { GET } = await import('../app/api/bazi/case-profile/route');
    const response = await GET(new NextRequest(`http://localhost/api/bazi/case-profile${CHART_ID_PATH}`));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.profile.id, 'profile-1');
    assert.equal(payload.profile.masterReview.strengthLevel, '偏强');
    assert.equal(payload.profile.events.length, 1);
    assert.equal(payload.profile.events[0].category, '事业');
});

test('bazi case profile PUT rejects invalid enumerated values like strengthLevel', async (t) => {
    const saveCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    mockCaseProfileContext(t, { saveCalls });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: CHART_ID,
            masterReview: {
                strengthLevel: '随便写',
                patterns: ['财格'],
                yongShen: { basic: ['水'], advanced: [] },
                xiShen: { basic: [], advanced: [] },
                jiShen: { basic: [], advanced: [] },
                xianShen: { basic: [], advanced: [] },
                summary: '',
            },
            ownerFeedback: {
                occupation: '上班族',
                education: '本科',
                wealthLevel: '小康',
                marriageStatus: '已婚',
                healthStatus: '健康稳定',
                familyStatusTags: [],
                temperamentTags: [],
                summary: '',
            },
            events: [],
        }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /strengthLevel/u);
    assert.equal(saveCalls.length, 0);
});

test('bazi case profile PUT accepts custom family and temperament tags', async (t) => {
    const saveCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    mockCaseProfileContext(t, {
        saveCalls,
        profile: {
            id: 'profile-1',
            user_id: 'user-1',
            bazi_chart_id: CHART_ID,
            master_review: {
                strengthLevel: '偏强',
                patterns: ['财格'],
                yongShen: { basic: ['水'], advanced: ['壬'] },
                xiShen: { basic: [], advanced: [] },
                jiShen: { basic: [], advanced: [] },
                xianShen: { basic: [], advanced: [] },
                summary: '测试',
            },
            owner_feedback: {
                occupation: '上班族',
                education: '本科',
                wealthLevel: '小康',
                marriageStatus: '已婚',
                healthStatus: '健康稳定',
                familyStatusTags: ['父母助力', '父子关系紧张'],
                temperamentTags: ['务实', '嘴硬心软'],
                summary: '',
            },
            created_at: '2026-03-20T00:00:00.000Z',
            updated_at: '2026-03-20T00:00:00.000Z',
        },
        events: [],
    });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: CHART_ID,
            masterReview: {
                strengthLevel: '偏强',
                patterns: ['财格'],
                yongShen: { basic: ['水'], advanced: ['壬'] },
                xiShen: { basic: [], advanced: [] },
                jiShen: { basic: [], advanced: [] },
                xianShen: { basic: [], advanced: [] },
                summary: '',
            },
            ownerFeedback: {
                occupation: '上班族',
                education: '本科',
                wealthLevel: '小康',
                marriageStatus: '已婚',
                healthStatus: '健康稳定',
                familyStatusTags: ['父母助力', '父子关系紧张'],
                temperamentTags: ['务实', '嘴硬心软'],
                summary: '',
            },
            events: [],
        }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.profile.ownerFeedback.familyStatusTags, ['父母助力', '父子关系紧张']);
    assert.deepEqual(payload.profile.ownerFeedback.temperamentTags, ['务实', '嘴硬心软']);
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0]?.fn, 'save_bazi_case_profile_as_service');
});

test('bazi case profile PUT should use the privileged rpc client instead of auth.db', async (t) => {
    const saveCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const contextModule = require('../lib/db/context.server') as { systemDb: typeof import('../lib/db/context.server').systemDb };
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalSystemDb = contextModule.systemDb;

    const authScoped = createCaseProfileScoped({
        rpc: async () => assert.fail('bazi case profile PUT should not call rpc on auth.db'),
    });
    const systemScoped = createCaseProfileScoped({ saveCalls });

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: authScoped,
        accessToken: null,
    })) as unknown as typeof apiUtils.requireUserContext;
    contextModule.systemDb = (() => systemScoped) as typeof contextModule.systemDb;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        contextModule.systemDb = originalSystemDb;
    });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: CHART_ID,
            masterReview: {
                strengthLevel: '偏强',
                patterns: ['财格'],
                yongShen: { basic: ['水'], advanced: [] },
                xiShen: { basic: [], advanced: [] },
                jiShen: { basic: [], advanced: [] },
                xianShen: { basic: [], advanced: [] },
                summary: '',
            },
            ownerFeedback: {
                occupation: '上班族',
                education: '本科',
                wealthLevel: '小康',
                marriageStatus: '已婚',
                healthStatus: '健康稳定',
                familyStatusTags: ['父母助力'],
                temperamentTags: ['务实'],
                summary: '',
            },
            events: [],
        }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0]?.fn, 'save_bazi_case_profile_as_service');
    assert.equal(saveCalls[0]?.args.p_user_id, 'user-1');
    assert.equal(saveCalls[0]?.args.p_chart_id, CHART_ID);
    assert.equal(payload.profile.id, 'profile-1');
});

type TableRow = Record<string, unknown>;

/** A scoped database double: `tx` serves each table's rows through Kysely's chain and records its filters. */
function scopedFor(tables: Record<string, TableRow[]>, rpc?: (fn: string, args: Record<string, unknown>) => unknown) {
    const calls: Array<[string, ...unknown[]]> = [];
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                let matched = tables[table];
                if (!matched) throw new Error(`Unexpected table: ${table}`);
                const query = {
                    select: () => query,
                    selectAll: () => query,
                    orderBy: () => query,
                    limit: () => query,
                    where: (column: string, operator: string, value: unknown) => {
                        calls.push([operator, column, value]);
                        if (operator === 'in') matched = matched!.filter(row => (value as unknown[]).includes(row.id));
                        else if (operator === '=') matched = matched!.filter(row => row[column] === value);
                        return query;
                    },
                    execute: async () => matched,
                    executeTakeFirst: async () => matched![0],
                };
                return query;
            },
        } as never),
        rpc: async (fn, args) => rpc ? rpc(fn, args) : undefined,
    });
    return { scoped, calls };
}

const CHART = '11111111-1111-1111-1111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222', HIDDEN_RUN = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';

test('bazi case profile PUT sends each kept event ID once, lowercased, so the save keeps its source and creation time', async (t) => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    const rpcCalls: Array<Record<string, unknown>> = [];
    const { scoped } = scopedFor({
        bazi_charts: [{ id: CHART, user_id: 'user-1' }],
        bazi_case_profiles: [{ id: 'profile-1', user_id: 'user-1', bazi_chart_id: CHART, master_review: {}, owner_feedback: {}, source_run_id: null, created_at: '2026-03-20T00:00:00.000Z', updated_at: '2026-03-20T00:00:00.000Z' }],
        bazi_case_events: [],
    }, (_fn, args) => { rpcCalls.push(args); return { status: 'ok', profile_id: 'profile-1' }; });
    t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }) as unknown as Awaited<ReturnType<typeof apiUtils.requireUserContext>>);
    const originalSystemDb = contextModule.systemDb;
    contextModule.systemDb = (() => scoped) as typeof contextModule.systemDb;
    t.after(() => { contextModule.systemDb = originalSystemDb; });

    const kept = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const event = (id: string | undefined, title: string) => ({ ...(id === undefined ? {} : { id }), eventDate: '2024-03-01', category: '事业', title, detail: '' });
    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const response = await PUT(new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartId: CHART, masterReview: {}, ownerFeedback: {}, events: [event(kept, '换到新公司'), event(kept, '同一 ID 的第二条'), event('event-1', '旧格式 ID'), event(undefined, '新事件')] }),
    }));

    assert.equal(response.status, 200);
    const sent = rpcCalls[0]?.p_events as Array<Record<string, unknown>>;
    assert.deepEqual(sent.map(item => item.id ?? null), [kept.toLowerCase(), null, null, null], 'an ID given twice stays with the first event; a malformed ID is a new event');
    assert.deepEqual(sent[0], { id: kept.toLowerCase(), event_date: '2024-03-01', category: '事业', title: '换到新公司', detail: null });
});

test('bazi case profile GET says which entries the Agent wrote and the conversation it wrote them in', async (t) => {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const event = (id: string, eventDate: string, category: string, title: string, source: string | null) =>
        ({ id, profile_id: 'profile-1', event_date: eventDate, category, title, detail: null, source_run_id: source, created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z' });
    const { scoped, calls } = scopedFor({
        bazi_charts: [{ id: CHART, user_id: 'user-1' }],
        bazi_case_profiles: [{ id: 'profile-1', user_id: 'user-1', bazi_chart_id: CHART, master_review: { strengthLevel: '偏弱' }, owner_feedback: {}, source_run_id: RUN, created_at: '2026-03-20T00:00:00.000Z', updated_at: '2026-03-20T00:00:00.000Z' }],
        bazi_case_events: [
            event('event-1', '2024-03-01', '事业', '换到新公司', RUN),
            event('event-2', '2019-07-01', '婚姻', '结婚', HIDDEN_RUN),
            event('event-3', '2015-09-01', '学业', '读研', null),
        ],
        // The reader's own tasks only: a task it cannot see keeps its ID and no conversation.
        agent_runs: [{ id: RUN, conversation_id: CONVERSATION, user_id: 'user-1' }],
    });
    t.mock.method(apiUtils, 'requireUserContext', async () => ({ user: { id: 'user-1' }, db: scoped }) as unknown as Awaited<ReturnType<typeof apiUtils.requireUserContext>>);

    const { GET } = await import('../app/api/bazi/case-profile/route');
    const payload = await (await GET(new NextRequest(`http://localhost/api/bazi/case-profile?chartId=${CHART}`))).json();

    assert.deepEqual(calls.find(call => call[0] === 'in'), ['in', 'id', [RUN, HIDDEN_RUN]], 'each task is read once');
    assert.deepEqual(payload.profile.masterReviewSource, { runId: RUN, conversationId: CONVERSATION });
    assert.deepEqual(payload.profile.events.map((item: { source: unknown }) => item.source), [
        { runId: RUN, conversationId: CONVERSATION },
        { runId: HIDDEN_RUN, conversationId: null },
        null,
    ]);
});

test('the case notes client reads each source back for display and keeps the IDs the next save sends', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    const profile = {
        id: 'profile-1', chartId: CHART, masterReview: { strengthLevel: '偏弱' }, ownerFeedback: {}, masterReviewSource: { runId: RUN, conversationId: CONVERSATION },
        events: [
            { id: 'event-1', eventDate: '2024-03-01', category: '事业', title: '换到新公司', detail: '', source: { runId: RUN, conversationId: CONVERSATION } },
            { id: 'event-2', eventDate: '2019-07-01', category: '婚姻', title: '结婚', detail: '', source: { runId: 42 } },
            { id: 'event-3', eventDate: '2015-09-01', category: '学业', title: '读研', detail: '' },
        ],
    };
    global.fetch = async () => new Response(JSON.stringify({ profile }), { headers: { 'Content-Type': 'application/json' } });
    const { loadBaziCaseProfile } = require('../lib/bazi-case-profile-client') as typeof import('../lib/bazi-case-profile-client');
    const loaded = await loadBaziCaseProfile(CHART);
    assert.ok(loaded);
    assert.deepEqual(loaded.masterReviewSource, { runId: RUN, conversationId: CONVERSATION });
    assert.deepEqual(loaded.events.map(item => [item.id, item.source]), [
        ['event-1', { runId: RUN, conversationId: CONVERSATION }],
        ['event-2', null],
        ['event-3', null],
    ]);
});
