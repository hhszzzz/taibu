/**
 * 每日签到
 *
 * 当前规则：
 * - 每日只能签到一次
 * - 签到奖励依会员等级发放
 * - 若签到前已达到/超过当前会员积分上限，则不可签到
 * - 若签到前仍低于上限，则本次签到奖励完整发放，允许单次超过上限
 * - 不再维护连续签到、经验值和等级
 */

import type { UserRecordSeedInput } from '@/lib/user/profile-record';
import { systemDb, type ScopedDb } from '@/lib/db/context.server';
import { getUserCreditInfo, getMembershipCreditLimit } from '@/lib/user/credits';

type CheckinUserSeed = UserRecordSeedInput;
type CheckinOptions = { db?: ScopedDb; user?: CheckinUserSeed };

export interface CheckinRecord {
    id: string;
    userId: string;
    checkinDate: string;
    rewardCredits: number;
    createdAt: string;
}

export interface CheckinStatus {
    canCheckin: boolean;
    lastCheckin: string | null;
    todayCheckedIn: boolean;
    rewardRange: [number, number];
    currentCredits: number;
    creditLimit: number;
    blockedReason: 'already_checked_in' | 'credit_cap_reached' | null;
}

export async function getCheckinStatus(
    userId: string,
    options?: CheckinOptions,
): Promise<CheckinStatus> {
    const today = new Date().toISOString().split('T')[0];
    const db = options?.db ?? systemDb();

    const [todayRow, lastRow] = await db.tx(async (trx) => Promise.all([
        trx.selectFrom('daily_checkins')
            .select('checkin_date')
            .where('user_id', '=', userId)
            .where('checkin_date', '=', today)
            .executeTakeFirst(),
        trx.selectFrom('daily_checkins')
            .select('checkin_date')
            .where('user_id', '=', userId)
            .orderBy('checkin_date', 'desc')
            .limit(1)
            .executeTakeFirst(),
    ])).catch((error) => {
        console.error('[checkin] 获取签到状态失败:', error);
        throw new Error('获取签到状态失败');
    });

    const creditInfo = await getUserCreditInfo(userId, { db, user: options?.user });
    const membership = creditInfo.membership;
    const currentCredits = creditInfo.credits;
    const creditLimit = getMembershipCreditLimit(membership);
    const todayCheckedIn = !!todayRow;
    const capReached = currentCredits >= creditLimit;

    return {
        canCheckin: !todayCheckedIn && !capReached,
        lastCheckin: lastRow?.checkin_date || null,
        todayCheckedIn,
        rewardRange: membership === 'pro'
            ? [3, 9]
            : membership === 'plus'
                ? [2, 6]
                : [1, 3],
        currentCredits,
        creditLimit,
        blockedReason: todayCheckedIn
            ? 'already_checked_in'
            : capReached
                ? 'credit_cap_reached'
                : null,
    };
}

export async function performCheckin(
    userId: string,
): Promise<{
    success: boolean;
    rewardCredits: number;
    credits?: number;
    creditLimit?: number;
    blockedReason?: 'already_checked_in' | 'credit_cap_reached';
    errorType?: 'blocked' | 'system';
    error?: string;
}> {
    let data: unknown;
    try {
        data = await systemDb().rpc('perform_daily_checkin_as_service', { p_user_id: userId });
    } catch (error) {
        console.error('[checkin] 签到失败:', error);
        return {
            success: false,
            rewardCredits: 0,
            errorType: 'system',
            error: '签到失败，请稍后重试',
        };
    }

    const result = (data || {}) as {
        status?: string;
        reward_credits?: number;
        credits?: number;
        credit_limit?: number;
    };

    if (result.status === 'already_checked_in') {
        return {
            success: false,
            rewardCredits: 0,
            blockedReason: 'already_checked_in',
            errorType: 'blocked',
            error: '今日已签到',
        };
    }

    if (result.status === 'credit_cap_reached') {
        return {
            success: false,
            rewardCredits: 0,
            blockedReason: 'credit_cap_reached',
            credits: result.credits,
            creditLimit: result.credit_limit,
            errorType: 'blocked',
            error: '当前积分已达或超过上限，消耗后再来签到',
        };
    }

    if (result.status !== 'ok') {
        return {
            success: false,
            rewardCredits: 0,
            errorType: 'system',
            error: '签到失败，请稍后重试',
        };
    }

    return {
        success: true,
        rewardCredits: result.reward_credits || 0,
        credits: result.credits,
        creditLimit: result.credit_limit,
    };
}

export async function getCheckinCalendar(
    userId: string,
    year: number,
    month: number,
    options?: { db?: ScopedDb },
): Promise<string[]> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    let rows;
    try {
        rows = await (options?.db ?? systemDb()).tx((trx) => trx
            .selectFrom('daily_checkins')
            .select('checkin_date')
            .where('user_id', '=', userId)
            .where('checkin_date', '>=', startDate)
            .where('checkin_date', '<=', endDate)
            .orderBy('checkin_date', 'asc')
            .execute());
    } catch (error) {
        console.error('[checkin] 获取签到日历失败:', error);
        throw new Error('获取签到日历失败');
    }

    return rows.map((row) => row.checkin_date);
}

export async function getCheckinStats(
    userId: string,
    options?: { db?: ScopedDb },
): Promise<{
    totalDays: number;
    thisMonthDays: number;
    totalCreditsEarned: number;
}> {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let rows;
    try {
        rows = await (options?.db ?? systemDb()).tx((trx) => trx
            .selectFrom('daily_checkins')
            .select(['checkin_date', 'reward_credits'])
            .where('user_id', '=', userId)
            .orderBy('checkin_date', 'desc')
            .execute());
    } catch (error) {
        console.error('[checkin] 获取签到统计失败:', error);
        throw new Error('获取签到统计失败');
    }

    return {
        totalDays: rows.length,
        thisMonthDays: rows.filter((row) => row.checkin_date.startsWith(thisMonth)).length,
        totalCreditsEarned: rows.reduce((sum, row) => sum + (row.reward_credits || 0), 0),
    };
}
