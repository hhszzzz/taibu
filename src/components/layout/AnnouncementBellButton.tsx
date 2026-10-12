'use client';
// Reads the unread notification count and opens the announcement center on click.
import { useCallback } from 'react';
import { Bell } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useAnnouncementCenterSafe } from '@/components/providers/AnnouncementPopupHost';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';

/** The sidebars' entry to announcements and notifications, badged with what is unread. */
export function AnnouncementBellButton({ className, iconSize = 20 }: { className: string; iconSize?: number }) {
    const { user } = useSessionSafe();
    const { isFeatureEnabled } = useFeatureToggles();
    const { openAnnouncementCenter, announcementPromptCount } = useAnnouncementCenterSafe();
    const notificationsEnabled = isFeatureEnabled('notifications');
    const unreadCount = useNotificationUnreadCount(user?.id ?? null, { enabled: notificationsEnabled });
    const badgeCount = (notificationsEnabled ? (unreadCount ?? 0) : 0) + announcementPromptCount;
    const open = useCallback(() => {
        openAnnouncementCenter({ tab: user && notificationsEnabled ? 'notifications' : 'announcements' });
    }, [notificationsEnabled, openAnnouncementCenter, user]);
    return (
        <button type="button" onClick={open} className={className} aria-label="打开公告中心" title="公告与通知">
            <Bell size={iconSize} aria-hidden="true" />
            {badgeCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold leading-none flex items-center justify-center">
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            ) : null}
        </button>
    );
}
