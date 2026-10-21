import { systemDb } from '@/lib/db/context.server';

const NOTIFICATION_RETENTION_DAYS = 3;
const NOTIFICATION_RETENTION_MS = NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function getNotificationRetentionCutoffIso(now: Date = new Date()) {
    return new Date(now.getTime() - NOTIFICATION_RETENTION_MS).toISOString();
}

export async function pruneExpiredNotifications(options: { userId?: string } = {}) {
    const cutoffIso = getNotificationRetentionCutoffIso();

    try {
        const rows = await systemDb().tx((trx) => {
            let query = trx
                .deleteFrom('notifications')
                .where('created_at', '<', cutoffIso);
            if (options.userId) {
                query = query.where('user_id', '=', options.userId);
            }
            return query.returning('id').execute();
        });
        return rows.length;
    } catch (error) {
        console.error('清理过期通知失败:', error);
        return 0;
    }
}
