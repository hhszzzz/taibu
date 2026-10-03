import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

test('bazi case profile GET returns current profile with events for owned chart', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
        getSystemAdminClient: typeof import('../lib/api-utils').getSystemAdminClient;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetSystemAdminClient = apiUtils.getSystemAdminClient;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: apiUtils.getSystemAdminClient(),
        supabase: apiUtils.getSystemAdminClient(),
    })) as unknown as typeof apiUtils.requireUserContext;

    apiUtils.getSystemAdminClient = (() => ({
        rpc() {
            throw new Error('bazi case profile GET should not call a write rpc');
        },
        from(table: string) {
            if (table === 'bazi_charts') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: { id: '11111111-1111-1111-1111-111111111111' },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_profiles') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: {
                                                    id: 'profile-1',
                                                    user_id: 'user-1',
                                                    bazi_chart_id: '11111111-1111-1111-1111-111111111111',
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
                                                },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_events') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    order: async () => ({
                                        data: [
                                            {
                                                id: 'event-1',
                                                profile_id: 'profile-1',
                                                bazi_chart_id: '11111111-1111-1111-1111-111111111111',
                                                event_date: '2025-01-01',
                                                category: '事业',
                                                title: '岗位晋升',
                                                detail: '细节',
                                                created_at: '2026-03-20T00:00:00.000Z',
                                                updated_at: '2026-03-20T00:00:00.000Z',
                                            },
                                        ],
                                        error: null,
                                    }),
                                };
                            },
                        };
                    },
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
    })) as unknown as typeof apiUtils.getSystemAdminClient;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getSystemAdminClient = originalGetSystemAdminClient;
    });

    const { GET } = await import('../app/api/bazi/case-profile/route');
    const response = await GET(new NextRequest('http://localhost/api/bazi/case-profile?chartId=11111111-1111-1111-1111-111111111111'));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.profile.id, 'profile-1');
    assert.equal(payload.profile.masterReview.strengthLevel, '偏强');
    assert.equal(payload.profile.events.length, 1);
    assert.equal(payload.profile.events[0].category, '事业');
});

test('bazi case profile PUT rejects invalid enumerated values like strengthLevel', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
        getSystemAdminClient: typeof import('../lib/api-utils').getSystemAdminClient;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetSystemAdminClient = apiUtils.getSystemAdminClient;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: apiUtils.getSystemAdminClient(),
        supabase: apiUtils.getSystemAdminClient(),
    })) as unknown as typeof apiUtils.requireUserContext;

    apiUtils.getSystemAdminClient = (() => ({
        from(table: string) {
            if (table !== 'bazi_charts') {
                throw new Error(`Unexpected table: ${table}`);
            }
            return {
                select() {
                    return {
                        eq() {
                            return {
                                eq() {
                                    return {
                                        maybeSingle: async () => ({
                                            data: { id: '11111111-1111-1111-1111-111111111111' },
                                            error: null,
                                        }),
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    })) as unknown as typeof apiUtils.getSystemAdminClient;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getSystemAdminClient = originalGetSystemAdminClient;
    });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '11111111-1111-1111-1111-111111111111',
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
});

test('bazi case profile PUT accepts custom family and temperament tags', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
        getSystemAdminClient: typeof import('../lib/api-utils').getSystemAdminClient;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetSystemAdminClient = apiUtils.getSystemAdminClient;

    const savedOwnerFeedback = { current: null as Record<string, unknown> | null };

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: apiUtils.getSystemAdminClient(),
        supabase: apiUtils.getSystemAdminClient(),
    })) as unknown as typeof apiUtils.requireUserContext;

    apiUtils.getSystemAdminClient = (() => ({
        rpc(fn: string, args: Record<string, unknown>) {
            assert.equal(fn, 'save_bazi_case_profile_as_service');
            savedOwnerFeedback.current = args.p_owner_feedback as Record<string, unknown>;
            return Promise.resolve({
                data: {
                    status: 'ok',
                    profile_id: 'profile-1',
                },
                error: null,
            });
        },
        from(table: string) {
            if (table === 'bazi_charts') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: { id: '11111111-1111-1111-1111-111111111111' },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_profiles') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: {
                                                    id: 'profile-1',
                                                    user_id: 'user-1',
                                                    bazi_chart_id: '11111111-1111-1111-1111-111111111111',
                                                    master_review: {
                                                        strengthLevel: '偏强',
                                                        patterns: ['财格'],
                                                        yongShen: { basic: ['水'], advanced: ['壬'] },
                                                        xiShen: { basic: [], advanced: [] },
                                                        jiShen: { basic: [], advanced: [] },
                                                        xianShen: { basic: [], advanced: [] },
                                                        summary: '测试',
                                                    },
                                                    owner_feedback: savedOwnerFeedback.current,
                                                    created_at: '2026-03-20T00:00:00.000Z',
                                                    updated_at: '2026-03-20T00:00:00.000Z',
                                                },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_events') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    order: async () => ({
                                        data: [],
                                        error: null,
                                    }),
                                };
                            },
                        };
                    },
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
    })) as unknown as typeof apiUtils.getSystemAdminClient;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getSystemAdminClient = originalGetSystemAdminClient;
    });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '11111111-1111-1111-1111-111111111111',
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
});

test('bazi case profile PUT should use the privileged rpc client instead of auth.db', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
        getSystemAdminClient: typeof import('../lib/api-utils').getSystemAdminClient;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    const originalGetSystemAdminClient = apiUtils.getSystemAdminClient;

    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const authDb = {
        from(table: string) {
            if (table === 'bazi_charts') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: { id: '11111111-1111-1111-1111-111111111111' },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_profiles') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => ({
                                                data: {
                                                    id: 'profile-1',
                                                    user_id: 'user-1',
                                                    bazi_chart_id: '11111111-1111-1111-1111-111111111111',
                                                    master_review: {
                                                        strengthLevel: '偏强',
                                                        patterns: ['财格'],
                                                        yongShen: { basic: ['水'], advanced: [] },
                                                        xiShen: { basic: [], advanced: [] },
                                                        jiShen: { basic: [], advanced: [] },
                                                        xianShen: { basic: [], advanced: [] },
                                                        summary: '',
                                                    },
                                                    owner_feedback: {
                                                        occupation: '上班族',
                                                        education: '本科',
                                                        wealthLevel: '小康',
                                                        marriageStatus: '已婚',
                                                        healthStatus: '健康稳定',
                                                        familyStatusTags: ['父母助力'],
                                                        temperamentTags: ['务实'],
                                                        summary: '',
                                                    },
                                                    created_at: '2026-03-20T00:00:00.000Z',
                                                    updated_at: '2026-03-20T00:00:00.000Z',
                                                },
                                                error: null,
                                            }),
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }

            if (table === 'bazi_case_events') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    order: async () => ({
                                        data: [],
                                        error: null,
                                    }),
                                };
                            },
                        };
                    },
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
        rpc() {
            throw new Error('bazi case profile PUT should not call rpc on auth.db');
        },
    };

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: authDb,
        supabase: authDb,
    })) as unknown as typeof apiUtils.requireUserContext;

    apiUtils.getSystemAdminClient = (() => ({
        rpc(fn: string, args: Record<string, unknown>) {
            rpcCalls.push({ fn, args });
            return Promise.resolve({
                data: {
                    status: 'ok',
                    profile_id: 'profile-1',
                },
                error: null,
            });
        },
    })) as unknown as typeof apiUtils.getSystemAdminClient;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
        apiUtils.getSystemAdminClient = originalGetSystemAdminClient;
    });

    const { PUT } = await import('../app/api/bazi/case-profile/route');
    const request = new NextRequest('http://localhost/api/bazi/case-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '11111111-1111-1111-1111-111111111111',
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
    assert.equal(rpcCalls.length, 1);
    const [rpcCall] = rpcCalls;
    assert.ok(rpcCall);
    assert.equal(rpcCall.fn, 'save_bazi_case_profile_as_service');
    assert.equal(rpcCall.args.p_user_id, 'user-1');
    assert.equal(rpcCall.args.p_chart_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(payload.profile.id, 'profile-1');
});
