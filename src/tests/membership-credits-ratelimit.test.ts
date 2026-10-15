/**
 * Regression tests for the membership -> credits -> rate-limit chain.
 *
 * Validates:
 * - Membership expiry downgrades to free
 * - Credits deduction returns null on failure
 * - getUserAuthInfo returns correct hasCredits flag
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

test('isMembershipExpired returns false for free users regardless of expiresAt', () => {
    const { isMembershipExpired } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    assert.equal(isMembershipExpired({ membership: 'free', expiresAt: null }), false);
    assert.equal(isMembershipExpired({ membership: 'free', expiresAt: new Date('2020-01-01') }), false);
});

test('isMembershipExpired returns true for expired plus/pro', () => {
    const { isMembershipExpired } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const pastDate = new Date(Date.now() - 86400_000);
    assert.equal(isMembershipExpired({ membership: 'plus', expiresAt: pastDate }), true);
    assert.equal(isMembershipExpired({ membership: 'pro', expiresAt: pastDate }), true);
});

test('isMembershipExpired returns false for active plus/pro', () => {
    const { isMembershipExpired } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const futureDate = new Date(Date.now() + 86400_000);
    assert.equal(isMembershipExpired({ membership: 'plus', expiresAt: futureDate }), false);
    assert.equal(isMembershipExpired({ membership: 'pro', expiresAt: futureDate }), false);
});

test('isMembershipExpired returns false for plus/pro with null expiresAt (lifetime)', () => {
    const { isMembershipExpired } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    assert.equal(isMembershipExpired({ membership: 'plus', expiresAt: null }), false);
    assert.equal(isMembershipExpired({ membership: 'pro', expiresAt: null }), false);
});

test('buildMembershipInfo downgrades expired pro to free', () => {
    const { buildMembershipInfo } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const info = buildMembershipInfo({
        membership: 'pro',
        membership_expires_at: new Date(Date.now() - 86400_000).toISOString(),
        ai_chat_count: 50,
    });

    assert.equal(info.type, 'free');
    assert.equal(info.isActive, false);
    assert.equal(info.aiChatCount, 50);
});

test('buildMembershipInfo returns defaults for null source', () => {
    const { buildMembershipInfo } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const info = buildMembershipInfo(null);
    assert.equal(info.type, 'free');
    assert.equal(info.isActive, true);
    assert.equal(info.aiChatCount, 0);
});

test('normalizeMembershipInfo converts serialized expiresAt back to Date', () => {
    const { normalizeMembershipInfo } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const iso = '2026-04-12T00:00:00.000Z';
    const info = normalizeMembershipInfo({
        type: 'plus',
        expiresAt: iso,
        isActive: true,
        aiChatCount: 12,
    });

    assert.ok(info);
    assert.ok(info.expiresAt instanceof Date);
    assert.equal(info.expiresAt?.toISOString(), iso);
    assert.equal(info.type, 'plus');
    assert.equal(info.aiChatCount, 12);
});

test('getUserAuthInfo should throw explicit user-state errors when DB query fails', async () => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const creditsModule = require('../lib/user/credits') as typeof import('../lib/user/credits');
    const creditsPath = require.resolve('../lib/user/credits');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;

    apiUtilsModule.getSystemAdminClient = () => ({
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: null, error: { message: 'connection refused' } }),
                }),
            }),
        }),
    });

    try {
        delete require.cache[creditsPath];
        await assert.rejects(
            () => creditsModule.getUserAuthInfo('user-1'),
            /加载账户状态失败/u,
        );
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[creditsPath];
    }
});

test('getUserAuthInfo returns hasCredits=false when credits are 0', async () => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const creditsPath = require.resolve('../lib/user/credits');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;

    apiUtilsModule.getSystemAdminClient = () => ({
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: {
                            ai_chat_count: 0,
                            membership: 'free',
                            membership_expires_at: null,
                        },
                        error: null,
                    }),
                }),
            }),
        }),
    });

    try {
        delete require.cache[creditsPath];
        const { getUserAuthInfo } = require('../lib/user/credits') as typeof import('../lib/user/credits');
        const result = await getUserAuthInfo('user-1');
        assert.ok(result);
        assert.equal(result.hasCredits, false);
        assert.equal(result.credits, 0);
        assert.equal(result.effectiveMembership, 'free');
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[creditsPath];
    }
});

test('useCredit returns null when RPC fails', async () => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const creditsPath = require.resolve('../lib/user/credits');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: async () => ({ data: null, error: { message: 'rpc error' } }),
    });

    try {
        delete require.cache[creditsPath];
        const { useCredit } = require('../lib/user/credits') as typeof import('../lib/user/credits');
        const result = await useCredit('user-1');
        assert.equal(result, null);
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[creditsPath];
    }
});

test('attemptCreditUse maps post-deduction races back to insufficient credits', async () => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const creditsPath = require.resolve('../lib/user/credits');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: async (fn: string) => {
            if (fn === 'decrement_ai_chat_count') {
                return { data: null, error: null };
            }
            throw new Error(`unexpected rpc ${fn}`);
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: {
                            ai_chat_count: 0,
                            membership: 'free',
                            membership_expires_at: null,
                        },
                        error: null,
                    }),
                }),
            }),
        }),
    });

    try {
        delete require.cache[creditsPath];
        const { attemptCreditUse } = require('../lib/user/credits') as typeof import('../lib/user/credits');
        const result = await attemptCreditUse('user-1');
        assert.deepEqual(result, {
            ok: false,
            reason: 'insufficient_credits',
        });
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[creditsPath];
    }
});

test('attemptCreditUse should keep rpc failures as deduction_failed even when balance is already 0', async () => {
    const apiUtilsModule = require('../lib/api-utils') as any;
    const creditsPath = require.resolve('../lib/user/credits');
    const originalGetServiceClient = apiUtilsModule.getSystemAdminClient;

    apiUtilsModule.getSystemAdminClient = () => ({
        rpc: async () => ({ data: null, error: { message: 'rpc unavailable' } }),
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: {
                            ai_chat_count: 0,
                            membership: 'free',
                            membership_expires_at: null,
                        },
                        error: null,
                    }),
                }),
            }),
        }),
    });

    try {
        delete require.cache[creditsPath];
        const { attemptCreditUse } = require('../lib/user/credits') as typeof import('../lib/user/credits');
        const result = await attemptCreditUse('user-1');
        assert.deepEqual(result, {
            ok: false,
            reason: 'deduction_failed',
        });
    } finally {
        apiUtilsModule.getSystemAdminClient = originalGetServiceClient;
        delete require.cache[creditsPath];
    }
});

test('getPlanConfig returns correct credit caps for each tier', () => {
    const { getPlanConfig } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    const free = getPlanConfig('free');
    assert.equal(free.creditLimit, 10);

    const plus = getPlanConfig('plus');
    assert.equal(plus.creditLimit, 20);

    const pro = getPlanConfig('pro');
    assert.equal(pro.creditLimit, 50);
});

test('formatMembershipExpiryDate renders the local calendar date with zero padding', () => {
    const { formatMembershipExpiryDate } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    // 用本地时间构造，避免测试机时区影响日期边界。
    assert.equal(formatMembershipExpiryDate(new Date(2027, 2, 1, 0, 0, 0)), '2027-03-01');
    assert.equal(formatMembershipExpiryDate(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('describePricingPlan folds credit cap and check-in reward into one summary line', () => {
    const { describePricingPlan, getPlanConfig } = require('../lib/user/membership') as typeof import('../lib/user/membership');

    assert.deepEqual(describePricingPlan(getPlanConfig('plus')), {
        summary: '积分上限 20 · 每日签到奖励 x2',
        perks: ['全部 Free 功能', '更多模型支持', '全部AI分析', '知识库'],
    });
    assert.deepEqual(describePricingPlan(getPlanConfig('free')), {
        summary: '积分上限 10 · 每日签到随机 1-3 积分',
        perks: ['基础命盘排盘', '每日/月运势预览', '塔罗牌、六爻、MBTI解读'],
    });
    // 没有签到条目时摘要只保留积分上限，不出现多余分隔符。
    assert.deepEqual(describePricingPlan({ ...getPlanConfig('pro'), features: ['积分上限 50', '更精确的知识库'] }), {
        summary: '积分上限 50',
        perks: ['更精确的知识库'],
    });
});

test('resolveRateLimitResetAt uses earliest window start', () => {
    const rateLimit = require('../lib/rate-limit') as { resolveRateLimitResetAt?: (rows: Array<{ window_start: string }>, windowMs: number) => Date };

    assert.equal(typeof rateLimit.resolveRateLimitResetAt, 'function');
    const windowMs = 60_000;
    const rows = [
        { window_start: '2026-01-28T11:59:30.000Z' },
        { window_start: '2026-01-28T11:59:50.000Z' },
    ];
    const resetAt = rateLimit.resolveRateLimitResetAt!(rows, windowMs);
    assert.equal(resetAt.toISOString(), '2026-01-28T12:00:30.000Z');
});
