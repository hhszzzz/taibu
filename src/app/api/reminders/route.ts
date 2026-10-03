/**
 * 提醒订阅 API
 */
import { NextRequest } from 'next/server';
import {
    getReminderSubscriptions,
    ReminderReadError,
    updateReminderSubscription,
    scheduleUpcomingSolarTermReminders,
    scheduleUpcomingFortuneReminders,
    scheduleKeyDateReminders,
    type ReminderType
} from '@/lib/reminders';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { calculateBaziOutputFromStoredFields } from '@/lib/divination/bazi-record';

// GET - 获取提醒订阅设置
export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const expectedUserId = request.headers.get('X-Expected-User-Id');
        if (expectedUserId !== null && expectedUserId !== auth.user.id) {
            return jsonError('账号已切换，请重新加载设置', 409, { success: false });
        }
        const { user } = auth;
        const db = auth.db;

        const subscriptions = await getReminderSubscriptions(user.id, { client: db });

        // 确保所有类型都有记录
        const allTypes: ReminderType[] = ['solar_term', 'fortune', 'key_date'];
        const result = allTypes.map(type => {
            const existing = subscriptions.find(s => s.reminderType === type);
            return {
                reminderType: type,
                enabled: existing?.enabled ?? false,
                notifyEmail: existing?.notifyEmail ?? false,
                notifySite: existing?.notifySite ?? true,
            };
        });

        return jsonOk({
            success: true,
            data: { subscriptions: result },
        });
    } catch (error) {
        console.error('[reminders API] 错误:', error);
        if (error instanceof ReminderReadError) {
            return jsonError(error.message, 500, { success: false });
        }
        return jsonError('服务器错误', 500, { success: false });
    }
}

// POST - 更新提醒订阅设置
export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const expectedUserId = request.headers.get('X-Expected-User-Id');
        if (expectedUserId !== null && expectedUserId !== auth.user.id) {
            return jsonError('账号已切换，请重新加载设置', 409, { success: false });
        }
        const { user } = auth;
        const db = auth.db;

        const body = await request.json();
        const { reminderType, enabled, notifyEmail, notifySite } = body;

        if (!reminderType || !['solar_term', 'fortune', 'key_date'].includes(reminderType)) {
            return jsonError('无效的提醒类型', 400, { success: false });
        }

        const success = await updateReminderSubscription(
            user.id,
            reminderType as ReminderType,
            { enabled, notifyEmail, notifySite },
            { client: db },
        );

        if (!success) {
            return jsonError('更新失败', 500, { success: false });
        }

        // 如果启用了提醒，安排对应类型的提醒
        let scheduled = 0;
        if (enabled) {
            if (reminderType === 'solar_term') {
                scheduled = await scheduleUpcomingSolarTermReminders(user.id);
            } else if (reminderType === 'fortune' || reminderType === 'key_date') {
                // 获取用户的八字命盘
                const { data: chartData } = await db
                    .from('bazi_charts')
                    .select('gender, birth_date, birth_time, birth_place, longitude, calendar_type, is_leap_month')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (chartData) {
                    const baziOutput = calculateBaziOutputFromStoredFields(chartData);
                    if (baziOutput) {
                        if (reminderType === 'fortune') {
                            scheduled = await scheduleUpcomingFortuneReminders(user.id, baziOutput);
                        } else {
                            scheduled = await scheduleKeyDateReminders(user.id, baziOutput);
                        }
                    }
                }
            }
        }

        return jsonOk({
            success: true,
            data: { scheduled },
        });
    } catch (error) {
        console.error('[reminders API] 更新错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
