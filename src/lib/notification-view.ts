import type { Notification } from '@/lib/notification';

export type NotificationReadFilter = 'all' | 'unread' | 'read';
export type NotificationTypeFilter = 'all' | Notification['type'];

export interface NotificationFilterState {
    read: NotificationReadFilter;
    type: NotificationTypeFilter;
}

export interface NotificationGroup {
    label: string;
    items: Notification[];
}

function startOfLocalDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function filterNotifications(
    notifications: Notification[],
    filters: NotificationFilterState,
) {
    return notifications.filter((notification) => {
        if (filters.read === 'unread' && notification.is_read) return false;
        if (filters.read === 'read' && !notification.is_read) return false;
        if (filters.type !== 'all' && notification.type !== filters.type) return false;
        return true;
    });
}

export function groupNotificationsByDay(
    notifications: Notification[],
    nowIso: string = new Date().toISOString(),
): NotificationGroup[] {
    const now = new Date(nowIso);
    const startOfToday = startOfLocalDay(now);
    const today: Notification[] = [];
    const recent: Notification[] = [];
    const older: Notification[] = [];

    for (const notification of notifications) {
        const createdAt = new Date(notification.created_at);
        const diffDays = Number.isNaN(createdAt.getTime())
            ? Number.POSITIVE_INFINITY
            : Math.floor((startOfToday - startOfLocalDay(createdAt)) / 86_400_000);

        if (diffDays <= 0) {
            today.push(notification);
        } else if (diffDays < 7) {
            recent.push(notification);
        } else {
            older.push(notification);
        }
    }

    const groups: NotificationGroup[] = [];
    if (today.length > 0) groups.push({ label: '今天', items: today });
    if (recent.length > 0) groups.push({ label: '近 7 天', items: recent });
    if (older.length > 0) groups.push({ label: '更早', items: older });
    return groups;
}

export function reconcileSelectedNotificationIds(
    selectedIds: Set<string>,
    visibleNotifications: Notification[],
) {
    const visibleIds = new Set(visibleNotifications.map((item) => item.id));
    return new Set(
        Array.from(selectedIds).filter((id) => visibleIds.has(id)),
    );
}

export function resolveNotificationLink(link: string, origin?: string) {
    const resolvedOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    try {
        const url = new URL(link, resolvedOrigin);
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return link.startsWith('/') ? link : `/${link}`;
    }
}

/** 列表里的相对时间：一周内用「N 分钟/小时/天前」，更早显示「M 月 D 日」；无法解析时返回空字符串。 */
export function formatNotificationTime(dateStr: string, now: Date = new Date()): string {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
