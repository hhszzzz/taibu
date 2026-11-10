'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnnouncementDialog } from '@/components/notifications/AnnouncementDialog';
import { useToast } from '@/components/ui/Toast';
import {
    ANNOUNCEMENT_CENTER_STORAGE_KEY,
    getAnnouncementCenterLocalState,
    getAnnouncementPromptIdentity,
    shouldPromptLatestAnnouncement,
    type Announcement,
    type AnnouncementCenterLocalState,
} from '@/lib/announcement';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useLatestAnnouncement } from '@/lib/hooks/useLatestAnnouncement';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';
import { useActiveSettingsCenterTab } from '@/lib/hooks/useSettingsCenterRouteState';
import { isAdminSettingsCenterTab } from '@/lib/settings-center';

export type NotificationsTab = 'notifications' | 'announcements';

export function notificationsHref(tab: NotificationsTab) {
    return tab === 'announcements' ? '/user/notifications?tab=announcements' : '/user/notifications';
}

/** 桌面侧栏的铃铛登记自己：可见时，「查看通知」就地打开它的面板。 */
export type NotificationBellHandle = { element: () => HTMLElement | null; open: (tab: NotificationsTab) => void };

type AnnouncementCenterContextValue = {
    openNotifications: (options?: { tab?: NotificationsTab }) => void;
    registerBell: (bell: NotificationBellHandle) => () => void;
    supportsNotifications: boolean;
    defaultTab: NotificationsTab;
    /** 还没看过的最新公告；后台与管理设置里不提示。 */
    unseenAnnouncement: Announcement | null;
    unseenAnnouncementKey: string | null;
    openAnnouncement: (announcement: Announcement) => void;
    markAnnouncementSeen: (announcement: Announcement) => void;
};

const AnnouncementCenterContext = createContext<AnnouncementCenterContextValue | null>(null);

function readAnnouncementCenterLocalState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(ANNOUNCEMENT_CENTER_STORAGE_KEY);
        return getAnnouncementCenterLocalState(raw ? JSON.parse(raw) : null);
    } catch {
        return {};
    }
}

function writeAnnouncementCenterLocalState(value: AnnouncementCenterLocalState) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(ANNOUNCEMENT_CENTER_STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Storage can be unavailable in private mode; the notice simply stays unseen.
    }
}

export function useAnnouncementCenterSafe(): AnnouncementCenterContextValue {
    return useContext(AnnouncementCenterContext) ?? {
        openNotifications: () => { },
        registerBell: () => () => { },
        supportsNotifications: false,
        defaultTab: 'announcements',
        unseenAnnouncement: null,
        unseenAnnouncementKey: null,
        openAnnouncement: () => { },
        markAnnouncementSeen: () => { },
    };
}

export function AnnouncementPopupHost({
    userId,
    authLoading,
    children,
}: {
    userId: string | null;
    authLoading: boolean;
    children: ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { showToast } = useToast();
    const { isFeatureEnabled } = useFeatureToggles();
    const notificationsEnabled = isFeatureEnabled('notifications');
    const supportsNotifications = !!userId && notificationsEnabled;
    const defaultTab: NotificationsTab = supportsNotifications ? 'notifications' : 'announcements';
    const [reading, setReading] = useState<Announcement | null>(null);
    const [localStateVersion, setLocalStateVersion] = useState(0);
    const bellRef = useRef<NotificationBellHandle | null>(null);
    const previousUnreadCountRef = useRef<number | null>(null);
    const activeSettingsTab = useActiveSettingsCenterTab();
    const isAdminContext = pathname.startsWith('/admin') || isAdminSettingsCenterTab(activeSettingsTab);
    const latestAnnouncementQuery = useLatestAnnouncement({
        enabled: !authLoading && !isAdminContext,
    });
    const latestAnnouncement = latestAnnouncementQuery.data ?? null;
    const latestKey = getAnnouncementPromptIdentity(latestAnnouncement);
    const unreadNotificationCount = useNotificationUnreadCount(userId, {
        enabled: notificationsEnabled && !authLoading,
    });

    /** 公告真正展示给用户时记为已看：看过卡片里的这条、打开公告列表或关掉提示都算。 */
    const markAnnouncementSeen = useCallback((announcement: Announcement) => {
        const announcementKey = getAnnouncementPromptIdentity(announcement);
        if (!announcementKey) return;
        const current = readAnnouncementCenterLocalState();
        if (current.seenAnnouncementKey === announcementKey) return;
        writeAnnouncementCenterLocalState({ ...current, seenAnnouncementKey: announcementKey });
        setLocalStateVersion((value) => value + 1);
    }, []);

    const openAnnouncement = useCallback((announcement: Announcement) => {
        setReading(announcement);
        // 只有最新那条算「看过」；读旧公告不能把已看标记倒回去。
        if (getAnnouncementPromptIdentity(announcement) === latestKey) markAnnouncementSeen(announcement);
    }, [latestKey, markAnnouncementSeen]);

    const registerBell = useCallback((bell: NotificationBellHandle) => {
        bellRef.current = bell;
        return () => {
            if (bellRef.current === bell) bellRef.current = null;
        };
    }, []);

    const openNotifications = useCallback((options: { tab?: NotificationsTab } = {}) => {
        const tab = options.tab === 'notifications' && !supportsNotifications ? 'announcements' : options.tab ?? defaultTab;
        const bell = bellRef.current;
        if (bell && (bell.element()?.getClientRects().length ?? 0) > 0) {
            bell.open(tab);
            return;
        }
        router.push(notificationsHref(tab));
    }, [defaultTab, router, supportsNotifications]);

    useEffect(() => {
        if (!userId || authLoading || !notificationsEnabled || unreadNotificationCount == null) {
            previousUnreadCountRef.current = null;
            return;
        }

        if (previousUnreadCountRef.current == null) {
            previousUnreadCountRef.current = unreadNotificationCount;
            return;
        }

        if (
            unreadNotificationCount > previousUnreadCountRef.current
            && !pathname.startsWith('/user/notifications')
        ) {
            const addedCount = unreadNotificationCount - previousUnreadCountRef.current;
            showToast(
                'info',
                addedCount > 1 ? `你有 ${addedCount} 条新通知` : '你收到 1 条新通知',
                {
                    duration: 5000,
                    action: {
                        label: '查看',
                        onClick: () => openNotifications({ tab: 'notifications' }),
                    },
                },
            );
        }

        previousUnreadCountRef.current = unreadNotificationCount;
    }, [
        authLoading,
        notificationsEnabled,
        openNotifications,
        pathname,
        showToast,
        unreadNotificationCount,
        userId,
    ]);

    const unseenAnnouncement = useMemo(() => {
        void localStateVersion;

        if (isAdminContext || authLoading || latestAnnouncementQuery.isLoading) {
            return null;
        }

        return shouldPromptLatestAnnouncement({
            announcementKey: latestKey,
            state: readAnnouncementCenterLocalState(),
        }) ? latestAnnouncement : null;
    }, [authLoading, isAdminContext, latestAnnouncement, latestAnnouncementQuery.isLoading, latestKey, localStateVersion]);

    const contextValue = useMemo<AnnouncementCenterContextValue>(() => ({
        openNotifications,
        registerBell,
        supportsNotifications,
        defaultTab,
        unseenAnnouncement,
        unseenAnnouncementKey: unseenAnnouncement ? latestKey : null,
        openAnnouncement,
        markAnnouncementSeen,
    }), [defaultTab, latestKey, markAnnouncementSeen, openAnnouncement, openNotifications, registerBell, supportsNotifications, unseenAnnouncement]);

    return (
        <AnnouncementCenterContext.Provider value={contextValue}>
            {children}
            <AnnouncementDialog
                announcement={reading}
                onClose={() => setReading(null)}
                onShowAll={pathname.startsWith('/user/notifications') ? undefined : () => {
                    setReading(null);
                    router.push(notificationsHref('announcements'));
                }}
            />
        </AnnouncementCenterContext.Provider>
    );
}
