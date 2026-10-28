/**
 * 提醒系统
 * 
 * 管理节气提醒、运势提醒、关键日提醒等
 */

import type { ScopedDb } from '@/lib/db/context.server';
import { systemDb } from '@/lib/db/context.server';
import { getNextSolarTerm, getSolarTermMeaning } from '@/lib/divination/solar-terms';
import { calculateDailyFortune, generateEnhancedKeyDates, compareLevels, isLevelFavorable } from '@/lib/divination/fortune';
import type { BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import { calculateBaziOutputFromStoredFields } from '@/lib/divination/bazi-record';

// ===== 提醒类型 =====

export type ReminderType = 'solar_term' | 'fortune' | 'key_date';

export interface ReminderSubscription {
    id: string;
    userId: string;
    reminderType: ReminderType;
    enabled: boolean;
    notifyEmail: boolean;
    notifySite: boolean;
}

const REMINDER_CLAIM_TTL_MS = 5 * 60 * 1000;

type ReminderNotificationPayload = {
    title: string;
    message: string;
    link?: string;
};

type ReminderDeliveryStatus = 'sent' | 'skipped' | 'not_claimed';

export class ReminderReadError extends Error {
    constructor(message = '获取提醒订阅失败') {
        super(message);
        this.name = 'ReminderReadError';
    }
}

type ReminderOptions = { db?: ScopedDb };

function resolveReminderDb(options?: ReminderOptions) {
    return options?.db ?? systemDb();
}

// ===== 订阅管理 =====

/**
 * 获取用户提醒订阅设置
 */
export async function getReminderSubscriptions(
    userId: string,
    options?: ReminderOptions,
): Promise<ReminderSubscription[]> {
    try {
        const data = await resolveReminderDb(options).tx((trx) => trx
            .selectFrom('reminder_subscriptions')
            .selectAll()
            .where('user_id', '=', userId)
            .execute());
        return data.map(d => ({
            id: d.id,
            userId: d.user_id,
            reminderType: d.reminder_type as ReminderType,
            enabled: d.enabled ?? false,
            notifyEmail: d.notify_email ?? false,
            notifySite: d.notify_site ?? true,
        }));
    } catch (error) {
        console.error('[reminders] 获取订阅设置失败:', error);
        throw new ReminderReadError('获取提醒订阅失败');
    }
}

/**
 * 更新提醒订阅设置
 */
export async function updateReminderSubscription(
    userId: string,
    reminderType: ReminderType,
    settings: { enabled?: boolean; notifyEmail?: boolean; notifySite?: boolean },
    options?: ReminderOptions,
): Promise<boolean> {
    const values = {
        user_id: userId,
        reminder_type: reminderType,
        enabled: settings.enabled ?? true,
        notify_email: settings.notifyEmail ?? false,
        notify_site: settings.notifySite ?? true,
        updated_at: new Date().toISOString(),
    };
    try {
        await resolveReminderDb(options).tx((trx) => trx
            .insertInto('reminder_subscriptions')
            .values(values)
            .onConflict((oc) => oc.columns(['user_id', 'reminder_type']).doUpdateSet({
                enabled: values.enabled,
                notify_email: values.notify_email,
                notify_site: values.notify_site,
                updated_at: values.updated_at,
            }))
            .execute());
        return true;
    } catch (error) {
        console.error('[reminders] 更新订阅设置失败:', error);
        return false;
    }
}

/**
 * 检查用户是否订阅了某类型提醒
 */
export async function isSubscribed(
    userId: string,
    reminderType: ReminderType,
    options?: ReminderOptions,
): Promise<boolean> {
    const db = resolveReminderDb(options);
    let subscription;
    try {
        subscription = await db.tx((trx) => trx.selectFrom('reminder_subscriptions')
            .select(['enabled', 'notify_site'])
            .where('user_id', '=', userId)
            .where('reminder_type', '=', reminderType)
            .executeTakeFirst());
    } catch (error) {
        console.error('[reminders] 获取订阅状态失败:', error);
        throw new ReminderReadError('获取提醒订阅状态失败');
    }
    if (!subscription?.enabled || !subscription.notify_site) return false;

    let settings;
    try {
        settings = await db.tx((trx) => trx.selectFrom('user_settings')
            .select(['notifications_enabled', 'notify_site'])
            .where('user_id', '=', userId)
            .executeTakeFirst());
    } catch (error) {
        console.error('[reminders] 获取通知偏好失败:', error);
        throw new ReminderReadError('获取通知偏好失败');
    }
    return (settings?.notifications_enabled ?? true) && (settings?.notify_site ?? true);
}

// ===== 提醒调度 =====

/**
 * 安排节气提醒
 */
export async function scheduleSolarTermReminder(
    userId: string,
    termDate: string,
    termName: string
): Promise<boolean> {
    const meaning = getSolarTermMeaning(termName);
    return scheduleReminderIfAbsent(
        userId,
        'solar_term',
        `${termDate}T08:00:00+08:00`,
        {
            term_name: termName,
            meaning: meaning.meaning,
            tips: meaning.tips,
        },
    );
}

/**
 * 安排运势提醒
 */
export async function scheduleFortuneReminder(
    userId: string,
    date: string,
    fortuneData: Record<string, unknown>
): Promise<boolean> {
    return scheduleReminderIfAbsent(
        userId,
        'fortune',
        `${date}T07:00:00+08:00`,
        fortuneData,
    );
}

/**
 * 处理到期提醒（由 Cron Job 调用）
 * 返回处理的提醒数量
 */
export async function processScheduledReminders(): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();
    const claimStaleBefore = new Date(now.getTime() - REMINDER_CLAIM_TTL_MS).toISOString();

    // 系统上下文绕过 RLS，只读取已到期的提醒。
    let pendingReminders;
    try {
        pendingReminders = await systemDb().tx((trx) => trx
            .selectFrom('scheduled_reminders')
            .selectAll()
            .where('sent', '=', false)
            .where('scheduled_for', '<=', nowIso)
            .where((eb) => eb.or([
                eb('sent_at', 'is', null),
                eb('sent_at', '<=', claimStaleBefore),
            ]))
            .limit(100)
            .execute());
    } catch (error) {
        console.error('[reminders] 获取待处理提醒失败:', error);
        return 0;
    }

    let processed = 0;

    for (const reminder of pendingReminders) {
        try {
            const notification = buildReminderNotificationPayload(reminder);
            const status = await processScheduledReminderDelivery(
                reminder.id,
                claimStaleBefore,
                notification,
            );
            if (status === 'sent') {
                processed++;
            }
        } catch (err) {
            console.error(`[reminders] 处理提醒 ${reminder.id} 失败:`, err);
        }
    }

    return processed;
}

/**
 * 构建提醒通知内容
 */
function buildReminderNotificationPayload(reminder: {
    user_id: string;
    reminder_type: string;
    content: unknown;
}): ReminderNotificationPayload {
    const content = (reminder.content && typeof reminder.content === 'object' && !Array.isArray(reminder.content)
        ? reminder.content
        : {}) as Record<string, unknown>;

    let title = '';
    let message = '';
    let link: string | undefined;

    switch (reminder.reminder_type) {
        case 'solar_term':
            title = `🌿 今日节气：${content.term_name}`;
            message = `${content.meaning}\n\n养生建议：${content.tips}`;
            link = '/daily';
            break;
        case 'fortune':
            title = '📅 今日运势提醒';
            message = typeof content.summary === 'string' ? content.summary : '查看您的今日运势分析';
            link = '/daily';
            break;
        case 'key_date':
            title = `🔔 重要日期提醒`;
            message = typeof content.description === 'string' ? content.description : '今天有重要事项';
            link = '/daily';
            break;
        default:
            title = '系统提醒';
            message = '您有一条新提醒';
    }

    return {
        title,
        message,
        link,
    };
}

async function processScheduledReminderDelivery(
    reminderId: string,
    staleBefore: string,
    notification: ReminderNotificationPayload,
): Promise<ReminderDeliveryStatus> {
    const data = await systemDb().rpc('process_scheduled_reminder_delivery_as_service', {
        p_reminder_id: reminderId,
        p_stale_before: staleBefore,
        p_notification_title: notification.title,
        p_notification_content: notification.message,
        p_notification_link: notification.link ?? null,
    });
    const result = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
    if (result?.status === 'sent' || result?.status === 'skipped' || result?.status === 'not_claimed') {
        return result.status;
    }

    throw new Error('process_scheduled_reminder_delivery_as_service returned invalid payload');
}

async function scheduleReminderIfAbsent(
    userId: string,
    reminderType: ReminderType,
    scheduledFor: string,
    content: Record<string, unknown>,
): Promise<boolean> {
    try {
        return await systemDb().rpc('schedule_reminder_if_absent_as_service', {
            p_user_id: userId,
            p_reminder_type: reminderType,
            p_scheduled_for: scheduledFor,
            p_content: content,
        }) === true;
    } catch (error) {
        console.error('[reminders] 安排提醒失败:', error);
        return false;
    }
}

// ===== 自动调度 =====

/**
 * 为用户安排未来的节气提醒
 */
export async function scheduleUpcomingSolarTermReminders(userId: string): Promise<number> {
    const nextTerm = getNextSolarTerm();
    if (!nextTerm) return 0;

    const meaning = getSolarTermMeaning(nextTerm.name);
    const success = await scheduleReminderIfAbsent(
        userId,
        'solar_term',
        `${nextTerm.date}T08:00:00+08:00`,
        {
            term_name: nextTerm.name,
            meaning: meaning.meaning,
            tips: meaning.tips,
        },
    );
    return success ? 1 : 0;
}

/**
 * 为用户安排未来7天的运势波动提醒
 * 识别运势显著变化的日期并创建提醒
 */
export async function scheduleUpcomingFortuneReminders(
    userId: string,
    baziOutput: CoreBaziOutput
): Promise<number> {
    const now = new Date();
    let scheduled = 0;

    // 计算未来7天的运势
    for (let i = 1; i <= 7; i++) {
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + i);

        const fortune = calculateDailyFortune(baziOutput, targetDate);
        const dateStr = fortune.date;

        // 识别运势波动：大吉 或 凶
        const isSignificant = fortune.overall === '大吉' || compareLevels(fortune.overall, '小凶') <= 0;
        if (!isSignificant) continue;

        const summaryType = isLevelFavorable(fortune.overall) ? '大吉日' : '低谷日';
        const summary = isLevelFavorable(fortune.overall)
            ? `今日运势极佳（${fortune.overall}），适合把握机会！`
            : `今日运势较低（${fortune.overall}），建议谨慎行事。`;

        const success = await scheduleReminderIfAbsent(
            userId,
            'fortune',
            `${dateStr}T07:00:00+08:00`,
            {
            summary,
            overall: fortune.overall,
            career: fortune.career,
            wealth: fortune.wealth,
            love: fortune.love,
            health: fortune.health,
            type: summaryType,
            },
        );

        if (success) scheduled++;
    }

    return scheduled;
}

/**
 * 为用户安排当月的关键日提醒
 */
export async function scheduleKeyDateReminders(
    userId: string,
    baziOutput: CoreBaziOutput
): Promise<number> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    let scheduled = 0;

    // 获取当月关键日
    const keyDates = generateEnhancedKeyDates(baziOutput, year, month);

    for (const keyDate of keyDates) {
        // 只安排未来的日期
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(keyDate.date).padStart(2, '0')}`;
        if (dateStr <= now.toISOString().split('T')[0]) continue;

        const inserted = await scheduleReminderIfAbsent(
            userId,
            'key_date',
            `${dateStr}T07:00:00+08:00`,
            {
                date: keyDate.date,
                type: keyDate.type,
                summary: keyDate.summary,
                recommendation: keyDate.recommendation,
                scores: keyDate.levels,
                description: `${month}月${keyDate.date}日：${keyDate.summary}`,
            },
        );

        if (inserted) scheduled++;
    }

    return scheduled;
}

/**
 * 获取用户的主要八字命盘（用于运势计算）
 */
async function getUserPrimaryBaziChart(userId: string): Promise<CoreBaziOutput | null> {
    const data = await systemDb().tx((trx) => trx
        .selectFrom('bazi_charts')
        .select(['gender', 'birth_date', 'birth_time', 'birth_place', 'longitude', 'calendar_type', 'is_leap_month', 'timezone', 'disambiguation'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst());

    return calculateBaziOutputFromStoredFields(data || {});
}

/**
 * 为所有启用提醒的用户调度提醒（由 Cron 调用）
 */
let reminderSchedulingCursor: string | null = null;
export async function scheduleAllUsersReminders(): Promise<number> {
    const db = systemDb();
    let totalScheduled = 0;
    const deadline = Date.now() + 20_000;

    // 获取所有启用了提醒的订阅
    let subscriptions;
    try {
        subscriptions = await db.tx((trx) => {
            let query = trx
                .selectFrom('reminder_subscriptions')
                .select(['user_id', 'reminder_type', 'enabled', 'notify_site'])
                .where('enabled', '=', true)
                .where('notify_site', '=', true)
                .where('reminder_type', 'in', ['solar_term', 'fortune', 'key_date'])
                .orderBy('user_id', 'asc')
                .limit(300);
            if (reminderSchedulingCursor) query = query.where('user_id', '>', reminderSchedulingCursor);
            return query.execute();
        });
    } catch (subscriptionsError) {
        console.error('[reminders] 获取订阅列表失败:', subscriptionsError);
        return 0;
    }

    if (subscriptions.length === 0) { reminderSchedulingCursor = null; return 0; }

    const userIds = Array.from(new Set(subscriptions.map(sub => sub.user_id)));
    const settingsMap = new Map<string, { notifications_enabled?: boolean; notify_site?: boolean }>();
    if (userIds.length > 0) {
        try {
            const settingsRows = await db.tx((trx) => trx
                .selectFrom('user_settings')
                .select(['user_id', 'notifications_enabled', 'notify_site'])
                .where('user_id', 'in', userIds)
                .execute());
            for (const row of settingsRows) settingsMap.set(row.user_id, {
                notifications_enabled: row.notifications_enabled ?? undefined,
                notify_site: row.notify_site ?? undefined,
            });
        } catch (settingsError) {
            console.error('[reminders] 获取用户通知偏好失败:', settingsError);
        }
    }

    // 按用户分组
    const userSubscriptions = new Map<string, Set<string>>();
    for (const sub of subscriptions) {
        const settings = settingsMap.get(sub.user_id);
        const notificationsEnabled = settings?.notifications_enabled ?? true;
        const settingsNotifySite = settings?.notify_site ?? true;
        if (!notificationsEnabled || !settingsNotifySite) {
            continue;
        }
        if (!userSubscriptions.has(sub.user_id)) {
            userSubscriptions.set(sub.user_id, new Set());
        }
        userSubscriptions.get(sub.user_id)!.add(sub.reminder_type);
    }

    // 为每个用户调度提醒
    for (const [userId, types] of userSubscriptions) {
        if (Date.now() >= deadline) break;
        try {
            // 节气提醒
            if (types.has('solar_term')) {
                const count = await scheduleUpcomingSolarTermReminders(userId);
                totalScheduled += count;
            }

            // 运势和关键日提醒需要八字数据
            if (types.has('fortune') || types.has('key_date')) {
                const baziChart = await getUserPrimaryBaziChart(userId);
                if (baziChart) {
                    if (types.has('fortune')) {
                        const count = await scheduleUpcomingFortuneReminders(userId, baziChart);
                        totalScheduled += count;
                    }
                    if (types.has('key_date')) {
                        const count = await scheduleKeyDateReminders(userId, baziChart);
                        totalScheduled += count;
                    }
                }
            }
        } catch (err) {
            console.error(`[reminders] 为用户 ${userId} 调度提醒失败:`, err);
        }
        reminderSchedulingCursor = userId;
    }
    if (!userSubscriptions.size) reminderSchedulingCursor = subscriptions[subscriptions.length - 1].user_id;

    return totalScheduled;
}
