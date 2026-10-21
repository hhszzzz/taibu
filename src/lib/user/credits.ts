/**
 * 用户积分/次数管理模块
 * 
 * 使用服务端 Supabase 客户端绕过 RLS
 * 注意：积分存储在 users 表的 ai_chat_count 字段
 * 
 * 当前规则：
 * - 积分余额存储在 users.ai_chat_count
 * - 会员只决定上限（Free 10 / Plus 20 / Pro 50）
 * - 定时恢复已取消，积分主要来自签到、激活码与退款
 */

import { type MembershipType, getPlanConfig, isMembershipExpired } from './membership';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { buildUserRecordSeed } from '@/lib/user/profile-record';

type CreditQueryOptions = {
    db?: ScopedDb;
    user?: Parameters<typeof buildUserRecordSeed>[0];
};

export type UserStateResolutionErrorCode =
    | 'USER_QUERY_FAILED'
    | 'USER_ROW_MISSING'
    | 'INVALID_CREDIT_BALANCE';

export class UserStateResolutionError extends Error {
    code: UserStateResolutionErrorCode;

    constructor(message: string, code: UserStateResolutionErrorCode, options?: { cause?: unknown }) {
        super(message);
        this.name = 'UserStateResolutionError';
        this.code = code;
        if (options && 'cause' in options) {
            Object.defineProperty(this, 'cause', {
                value: options.cause,
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
    }
}

function resolveMembershipType(rawMembership: MembershipType | null | undefined, expiresAt: Date | null): MembershipType {
    const membership = rawMembership === 'plus' || rawMembership === 'pro' ? rawMembership : 'free';
    if (isMembershipExpired({ membership, expiresAt })) {
        return 'free';
    }
    return membership;
}

/**
 * 一次查询获取用户积分 + 有效会员类型
 * 合并 hasCredits + getEffectiveMembershipType，减少重复 DB 查询
 */
export async function getUserAuthInfo(
    userId: string,
    options?: CreditQueryOptions,
): Promise<{
    credits: number;
    effectiveMembership: MembershipType;
    hasCredits: boolean;
}> {
    const info = await getUserCreditInfo(userId, options);
    return {
        credits: info.credits,
        effectiveMembership: info.membership, // getUserCreditInfo 已处理过期降级
        hasCredits: info.credits > 0,
    };
}

/**
 * 获取用户完整信息（积分 + 会员类型 + 恢复时间）
 */
export async function getUserCreditInfo(
    userId: string,
    options?: CreditQueryOptions,
): Promise<{
    credits: number;
    membership: MembershipType;
    expiresAt: Date | null;
}> {
    let data;
    try {
        data = await (options?.db ?? systemDb()).tx(async (trx) => {
            const load = () => trx
                .selectFrom('users')
                .select(['ai_chat_count', 'membership', 'membership_expires_at'])
                .where('id', '=', userId)
                .executeTakeFirst();
            let row = await load();
            if (!row && options?.user) {
                await trx
                    .insertInto('users')
                    .values(buildUserRecordSeed(options.user))
                    .onConflict((conflict) => conflict.column('id').doNothing())
                    .execute();
                row = await load();
            }
            return row;
        });
    } catch (error) {
        console.error('[credits] Failed to get user info:', error);
        throw new UserStateResolutionError('加载账户状态失败，请稍后重试', 'USER_QUERY_FAILED', { cause: error });
    }

    if (!data) {
        console.error('[credits] Missing user row for auth info:', userId);
        throw new UserStateResolutionError('加载账户状态失败，请稍后重试', 'USER_ROW_MISSING');
    }

    if (typeof data.ai_chat_count !== 'number' || Number.isNaN(data.ai_chat_count)) {
        console.error('[credits] Invalid ai_chat_count for user:', userId, data.ai_chat_count);
        throw new UserStateResolutionError('加载账户状态失败，请稍后重试', 'INVALID_CREDIT_BALANCE');
    }

    // 检查会员是否过期
    const expiresAt = data.membership_expires_at ? new Date(data.membership_expires_at) : null;
    const membership = resolveMembershipType(data.membership as MembershipType | null | undefined, expiresAt);

    return {
        credits: data.ai_chat_count,
        membership,
        expiresAt,
    };
}

/**
 * 获取用户积分（从 users 表读取 ai_chat_count）
 */
async function getCredits(userId: string): Promise<number> {
    const info = await getUserCreditInfo(userId);
    return info?.credits ?? 0;
}

/**
 * 消耗一次积分（简化逻辑，使用 RPC 或直接扣减）
 * @returns 成功返回剩余积分，失败返回 null
 */
export async function useCredit(userId: string): Promise<number | null> {
    const result = await runCreditDecrement(userId);
    return result.status === 'ok' ? result.remaining : null;
}

export type CreditUseAttemptResult =
    | { ok: true; remaining: number }
    | { ok: false; reason: 'insufficient_credits' | 'deduction_failed' };

async function getCreditsModuleExports() {
    return await import('@/lib/user/credits');
}

async function runCreditDecrement(userId: string): Promise<
    | { status: 'ok'; remaining: number }
    | { status: 'no_change' }
    | { status: 'rpc_error' }
> {
    try {
        const data = await systemDb().rpc('decrement_ai_chat_count', { user_id: userId });
        if (typeof data === 'number') {
            return { status: 'ok', remaining: data };
        }
        return { status: 'no_change' };
    } catch (error) {
        console.error('[credits] RPC decrement failed:', error);
        return { status: 'rpc_error' };
    }

}

export async function attemptCreditUse(
    userId: string,
    options?: CreditQueryOptions,
): Promise<CreditUseAttemptResult> {
    const decrementResult = await runCreditDecrement(userId);
    if (decrementResult.status === 'ok') {
        return { ok: true, remaining: decrementResult.remaining };
    }
    if (decrementResult.status === 'rpc_error') {
        return { ok: false, reason: 'deduction_failed' };
    }

    const info = await getUserCreditInfo(userId, options);
    if (info.credits <= 0) {
        return { ok: false, reason: 'insufficient_credits' };
    }

    return { ok: false, reason: 'deduction_failed' };
}

/**
 * 添加积分
 */
export async function addCredits(userId: string, amount: number): Promise<number | null> {
    try {
        const data = await systemDb().rpc('increment_ai_chat_count', { user_id: userId, amount });
        return typeof data === 'number' ? data : null;
    } catch (error) {
        console.error('[credits] Failed to add credits:', error);
        return null;
    }
}

export async function refundCreditsOrLog(userId: string, amount: number, context: string): Promise<boolean> {
    const { addCredits: currentAddCredits } = await getCreditsModuleExports();
    const remaining = await currentAddCredits(userId, amount);
    if (remaining === null) {
        console.error(`[credits] ${context} refund failed`, { userId, amount });
        return false;
    }
    return true;
}

/**
 * 检查是否有足够积分
 */
export async function hasCredits(userId: string): Promise<boolean> {
    const credits = await getCredits(userId);
    return credits > 0;
}

export function getMembershipCreditLimit(type: MembershipType): number {
    return getPlanConfig(type).creditLimit;
}
