/**
 * Cron API - 处理到期提醒
 * 
 * 由独立 scheduler 或托管 Cron 每 5 分钟调用
 * 处理 scheduled_reminders 表中到期的提醒
 */
import { NextRequest } from 'next/server';
import { processScheduledReminders, scheduleAllUsersReminders } from '@/lib/reminders';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { pruneExpiredNotifications } from '@/lib/notification-server';
import { processDailyBriefings } from '@/lib/daily-briefing.server';
import { cleanupAgentAttachments } from '@/lib/agent/attachments.server';

/**
 * 验证 Cron 请求
 * 支持 CRON_SECRET 环境变量验证
 */
function validateCronRequest(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET;

    // 如果没有配置 CRON_SECRET，仅在开发环境允许
    if (!cronSecret) {
        return process.env.NODE_ENV === 'development';
    }

    // 验证 Authorization header
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        return token === cronSecret;
    }

    // 验证 X-Cron-Secret header（备选）
    const cronHeader = request.headers.get('x-cron-secret');
    return cronHeader === cronSecret;
}

// GET - 处理到期提醒
export async function GET(request: NextRequest) {
    // 验证请求来源
    if (!validateCronRequest(request)) {
        return jsonError('Unauthorized', 401);
    }

    try {
        const operations = await Promise.allSettled([
            processDailyBriefings(), cleanupAgentAttachments(),
            processScheduledReminders(), scheduleAllUsersReminders(), pruneExpiredNotifications(),
        ]);
        const [briefing, attachmentsCleaned, processed, scheduled, prunedNotifications] = operations.map(result => result.status === 'fulfilled' ? result.value : null);
        const failed = operations.flatMap((result, index) => result.status === 'rejected' ? [index] : []);
        if (failed.length) console.error('[cron/process-reminders] 部分步骤失败，下一轮独立重试:', failed);

        console.log(`[cron/process-reminders] 处理了 ${processed} 条提醒，调度了 ${scheduled} 条新提醒，清理了 ${prunedNotifications} 条过期通知`);

        return jsonOk({
            success: failed.length === 0,
            failed,
            processed,
            scheduled,
            prunedNotifications,
            briefing,
            attachmentsCleaned,
        });
    } catch (error) {
        console.error('[cron/process-reminders] 处理失败:', error);
        return jsonError('处理提醒失败', 500);
    }
}

// 确保每次请求都执行
export const dynamic = 'force-dynamic';
