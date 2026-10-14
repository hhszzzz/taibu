/**
 * 会员权限逻辑
 * 
 * Free/Plus/Pro 三级会员体系
 * - Free: 积分上限 10，签到随机 1-3 积分
 * - Plus: 积分上限 20，签到奖励 x2
 * - Pro: 积分上限 50，签到奖励 x3
 */

import { requestBrowserJson, type BrowserApiError } from '@/lib/browser-api';

export type MembershipType = 'free' | 'plus' | 'pro';

export interface MembershipInfo {
    type: MembershipType;
    expiresAt: Date | null;
    isActive: boolean;
    aiChatCount: number;
}

type MembershipInfoPayload = {
    type?: MembershipType | null;
    expiresAt?: string | Date | null;
    isActive?: boolean | null;
    aiChatCount?: number | null;
};

export type MembershipLookupResult = {
    ok: true;
    info: MembershipInfo | null;
} | {
    ok: false;
    error: BrowserApiError;
};

export type MembershipInfoSource = {
    membership?: MembershipType | null;
    membership_expires_at?: string | null;
    ai_chat_count?: number | null;
};

export function normalizeMembershipInfo(input: MembershipInfoPayload | MembershipInfo | null): MembershipInfo | null {
    if (!input) {
        return null;
    }

    const membershipType = input.type === 'plus' || input.type === 'pro' ? input.type : 'free';
    const expiresAtRaw = input.expiresAt;
    const expiresAt = expiresAtRaw instanceof Date
        ? expiresAtRaw
        : typeof expiresAtRaw === 'string' && expiresAtRaw.length > 0
            ? new Date(expiresAtRaw)
            : null;
    const effectiveExpiresAt = membershipType === 'free' ? null : expiresAt;

    return {
        type: membershipType,
        expiresAt: effectiveExpiresAt && !Number.isNaN(effectiveExpiresAt.getTime()) ? effectiveExpiresAt : null,
        isActive: typeof input.isActive === 'boolean' ? input.isActive : membershipType === 'free' || effectiveExpiresAt === null || effectiveExpiresAt > new Date(),
        aiChatCount: typeof input.aiChatCount === 'number' ? input.aiChatCount : 0,
    };
}

/**
 * 判断付费会员是否已过期
 * free 用户永远返回 false（无过期概念）
 */
export function isMembershipExpired(source: {
    membership?: MembershipType | string | null;
    membership_expires_at?: string | null;
    expiresAt?: Date | null;
}): boolean {
    const type = (source.membership || 'free') as MembershipType;
    if (type === 'free') return false;
    const expiresAt = source.expiresAt
        ?? (source.membership_expires_at ? new Date(source.membership_expires_at) : null);
    return expiresAt !== null && expiresAt <= new Date();
}

export interface PricingPlan {
    id: MembershipType;
    name: string;
    price: number;
    period: string;
    features: string[];
    popular?: boolean;
    /** 可累计积分上限 */
    creditLimit: number;
}

// 会员套餐配置
export const pricingPlans: PricingPlan[] = [
    {
        id: 'free',
        name: 'Free',
        price: 0,
        period: '永久',
        features: [
            '基础命盘排盘',
            '每日/月运势预览',
            '塔罗牌、六爻、MBTI解读',
            '积分上限 10',
            '每日签到随机 1-3 积分',
        ],
        creditLimit: 10,
    },
    {
        id: 'plus',
        name: 'Plus',
        price: 0,
        period: '30 天',
        features: [
            '全部 Free 功能',
            '积分上限 20',
            '每日签到奖励 x2',
            '更多模型支持',
            '全部AI分析',
            '知识库',
        ],
        popular: true,
        creditLimit: 20,
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 0,
        period: '30 天',
        features: [
            '全部 Plus 功能',
            '积分上限 50',
            '每日签到奖励 x3',
            '获取更高级模型支持',
            '更精确的知识库',
        ],
        creditLimit: 50,
    },
];

/**
 * 获取套餐配置
 */
export function getPlanConfig(type: MembershipType): PricingPlan {
    return pricingPlans.find(p => p.id === type) || pricingPlans[0];
}

/** 会员到期日按浏览器本地日历显示为 YYYY-MM-DD。 */
export function formatMembershipExpiryDate(expiresAt: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())}`;
}

/** 会员等级卡片：积分上限与签到奖励合成一行摘要，其余条目作为权益列表。 */
export function describePricingPlan(plan: PricingPlan): { summary: string; perks: string[] } {
    const checkin = plan.features.find(feature => feature.includes('签到'));
    return {
        summary: [`积分上限 ${plan.creditLimit}`, checkin].filter(Boolean).join(' · '),
        perks: plan.features.filter(feature => !feature.includes('签到') && !feature.startsWith('积分上限')),
    };
}

/**
 * 获取积分上限
 */
export function getCreditLimit(type: MembershipType): number {
    return getPlanConfig(type).creditLimit;
}

/**
 * 获取用户会员信息
 */
export async function getMembershipInfoResult(userId: string): Promise<MembershipLookupResult> {
    const result = await requestBrowserJson<{
        userId?: string | null;
        membership?: MembershipInfo | null;
    }>('/api/user/membership', {
        method: 'GET',
    });

    if (result.error) {
        return { ok: false, error: result.error };
    }

    const payloadUserId = result.data?.userId ?? null;
    if (!payloadUserId || payloadUserId !== userId) {
        return {
            ok: false,
            error: { message: '会员状态校验失败，请刷新后重试' },
        };
    }

    return {
        ok: true,
        info: normalizeMembershipInfo(result.data?.membership ?? null),
    };
}

/**
 * 获取用户会员信息
 */
export async function getMembershipInfo(userId: string): Promise<MembershipLookupResult> {
    return getMembershipInfoResult(userId);
}

export function buildMembershipInfo(source: MembershipInfoSource | null): MembershipInfo {
    if (!source) {
        return {
            type: 'free',
            expiresAt: null,
            isActive: true,
            aiChatCount: 0,
        };
    }

    const membershipType = source.membership ? (source.membership as MembershipType) : 'free';
    const aiChatCount = typeof source.ai_chat_count === 'number' ? source.ai_chat_count : 0;
    const expiresAt = source.membership_expires_at
        ? new Date(source.membership_expires_at)
        : null;

    let isActive = true;
    let effectiveType = membershipType;

    if (isMembershipExpired({ membership: membershipType, expiresAt })) {
        isActive = false;
        effectiveType = 'free';
    }

    return {
        type: effectiveType,
        expiresAt: effectiveType === 'free' ? null : expiresAt,
        isActive,
        aiChatCount,
    };
}
