/**
 * 签到 API
 */
import { NextRequest } from 'next/server';
import {
    getCheckinStatus,
    performCheckin,
    getCheckinCalendar,
    getCheckinStats
} from '@/lib/user/checkin';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';

interface CheckinResponse {
    success: boolean;
    data?: {
        status?: {
            canCheckin: boolean;
            lastCheckin: string | null;
            todayCheckedIn: boolean;
            rewardRange: [number, number];
            currentCredits: number;
            creditLimit: number;
            blockedReason: 'already_checked_in' | 'credit_cap_reached' | null;
        };
        result?: {
            rewardCredits: number;
            credits?: number;
            creditLimit?: number;
            blockedReason?: 'already_checked_in' | 'credit_cap_reached';
        };
        calendar?: string[];
        stats?: {
            totalDays: number;
            thisMonthDays: number;
            totalCreditsEarned: number;
        };
    };
    error?: string;
}

// GET - 获取签到状态
export async function GET(request: NextRequest) {
    try {
        const requestUrl = new URL(request.url);
        const perfEnabled = requestUrl.searchParams.get('perf') === '1';
        const perfStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const { user } = auth;

        const action = requestUrl.searchParams.get('action') || 'status';

        switch (action) {
            case 'status': {
                const status = await getCheckinStatus(user.id, { db: auth.db, user });
                const data: CheckinResponse['data'] = { status };
                if (perfEnabled) {
                    const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - perfStart);
                    console.info(`[perf:checkin:status] ${duration}ms`, { userId: user.id });
                }
                return jsonOk({
                    success: true,
                    data,
                });
            }

            case 'calendar': {
                const year = parseInt(requestUrl.searchParams.get('year') || String(new Date().getFullYear()));
                const month = parseInt(requestUrl.searchParams.get('month') || String(new Date().getMonth() + 1));
                const calendar = await getCheckinCalendar(user.id, year, month, { db: auth.db });
                if (perfEnabled) {
                    const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - perfStart);
                    console.info(`[perf:checkin:calendar] ${duration}ms`, { userId: user.id, year, month });
                }
                return jsonOk({ success: true, data: { calendar } });
            }

            case 'stats': {
                const stats = await getCheckinStats(user.id, { db: auth.db });
                if (perfEnabled) {
                    const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - perfStart);
                    console.info(`[perf:checkin:stats] ${duration}ms`, { userId: user.id });
                }
                return jsonOk({ success: true, data: { stats } });
            }

            default:
                return jsonError('未知操作', 400, { success: false });
        }
    } catch (error) {
        console.error('[checkin API] 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}

// POST - 执行签到
export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const { user } = auth;

        const result = await performCheckin(user.id);

        if (!result.success) {
            const status = result.blockedReason || result.errorType === 'blocked' ? 400 : 500;
            return jsonError(result.error || '签到失败', status, {
                success: false,
                data: {
                    result: {
                        rewardCredits: result.rewardCredits,
                        credits: result.credits,
                        creditLimit: result.creditLimit,
                        blockedReason: result.blockedReason,
                    },
                },
            });
        }

        return jsonOk({
            success: true,
            data: {
                result: {
                    rewardCredits: result.rewardCredits,
                    credits: result.credits,
                    creditLimit: result.creditLimit,
                },
            },
        });
    } catch (error) {
        console.error('[checkin API] 签到错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
