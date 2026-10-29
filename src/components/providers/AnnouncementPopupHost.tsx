'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarAnnouncementCenter } from '@/components/layout/SidebarAnnouncementCenter';
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

export type AnnouncementCenterTab = 'notifications' | 'announcements';

type OpenAnnouncementCenterOptions = {
    tab?: AnnouncementCenterTab;
};

type AnnouncementCenterContextValue = {
    openAnnouncementCenter: (options?: OpenAnnouncementCenterOptions) => void;
    closeAnnouncementCenter: () => void;
    announcementPromptCount: number;
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

    window.localStorage.setItem(ANNOUNCEMENT_CENTER_STORAGE_KEY, JSON.stringify(value));
}

export function useAnnouncementCenterSafe() {
    return useContext(AnnouncementCenterContext) ?? {
        openAnnouncementCenter: () => { },
        closeAnnouncementCenter: () => { },
        announcementPromptCount: 0,
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
    const { showToast } = useToast();
    const { isFeatureEnabled } = useFeatureToggles();
    const notificationsEnabled = isFeatureEnabled('notifications');
    const [open, setOpen] = useState(false);
    const [preferredTab, setPreferredTab] = useState<AnnouncementCenterTab>('announcements');
    const [localStateVersion, setLocalStateVersion] = useState(0);
    const openRef = useRef(false);
    const previousUnreadCountRef = useRef<number | null>(null);
    const activeSettingsTab = useActiveSettingsCenterTab();
    const isAdminContext = pathname.startsWith('/admin') || isAdminSettingsCenterTab(activeSettingsTab);
    const latestAnnouncementQuery = useLatestAnnouncement({
        enabled: !authLoading && !isAdminContext,
    });
    const latestAnnouncement = latestAnnouncementQuery.data ?? null;
    const unreadNotificationCount = useNotificationUnreadCount(userId, {
        enabled: notificationsEnabled && !authLoading,
    });

    useEffect(() => {
        openRef.current = open;
    }, [open]);

    const closeAnnouncementCenter = useCallback(() => {
        setOpen(false);
    }, []);

    /** 公告真正展示给用户时立即记为已看：自动弹出、点铃铛查看都算，之后刷新或隔天都不再弹。 */
    const markAnnouncementSeen = useCallback((announcement: Announcement) => {
        const announcementKey = getAnnouncementPromptIdentity(announcement);
        if (!announcementKey) return;
        const current = readAnnouncementCenterLocalState();
        if (current.seenAnnouncementKey === announcementKey) return;
        writeAnnouncementCenterLocalState({ ...current, seenAnnouncementKey: announcementKey });
        setLocalStateVersion((value) => value + 1);
    }, []);

    const openAnnouncementCenter = useCallback((options: OpenAnnouncementCenterOptions = {}) => {
        const wantsNotifications = options.tab === 'notifications' && !!userId && notificationsEnabled;
        setPreferredTab(wantsNotifications ? 'notifications' : 'announcements');
        setOpen(true);
    }, [notificationsEnabled, userId]);

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
            && !openRef.current
        ) {
            const addedCount = unreadNotificationCount - previousUnreadCountRef.current;
            showToast(
                'info',
                addedCount > 1 ? `你有 ${addedCount} 条新通知` : '你收到 1 条新通知',
                {
                    duration: 5000,
                    action: {
                        label: '查看',
                        onClick: () => openAnnouncementCenter({ tab: 'notifications' }),
                    },
                },
            );
        }

        previousUnreadCountRef.current = unreadNotificationCount;
    }, [
        authLoading,
        notificationsEnabled,
        openAnnouncementCenter,
        pathname,
        showToast,
        unreadNotificationCount,
        userId,
    ]);

    const announcementPromptCount = useMemo(() => {
        void localStateVersion;

        if (isAdminContext || authLoading || latestAnnouncementQuery.isLoading) {
            return 0;
        }

        return shouldPromptLatestAnnouncement({
            announcementKey: getAnnouncementPromptIdentity(latestAnnouncement),
            state: readAnnouncementCenterLocalState(),
        }) ? 1 : 0;
    }, [authLoading, isAdminContext, latestAnnouncement, latestAnnouncementQuery.isLoading, localStateVersion]);

    useEffect(() => {
        if (isAdminContext && openRef.current) {
            queueMicrotask(() => {
                setOpen(false);
            });
            return;
        }

        if (announcementPromptCount <= 0 || openRef.current) {
            return;
        }

        queueMicrotask(() => {
            setPreferredTab('announcements');
            setOpen(true);
        });
    }, [announcementPromptCount, isAdminContext]);

    const contextValue = useMemo<AnnouncementCenterContextValue>(() => ({
        openAnnouncementCenter,
        closeAnnouncementCenter,
        announcementPromptCount,
    }), [announcementPromptCount, closeAnnouncementCenter, openAnnouncementCenter]);

    return (
        <AnnouncementCenterContext.Provider value={contextValue}>
            {children}
            {open ? (
                <SidebarAnnouncementCenter
                    key={`${preferredTab}-${userId ?? 'visitor'}`}
                    open={open}
                    userId={userId}
                    notificationsEnabled={notificationsEnabled}
                    initialTab={preferredTab}
                    onClose={closeAnnouncementCenter}
                    onAnnouncementsViewed={markAnnouncementSeen}
                />
            ) : null}
        </AnnouncementCenterContext.Provider>
    );
}
