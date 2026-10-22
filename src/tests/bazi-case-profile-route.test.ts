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
