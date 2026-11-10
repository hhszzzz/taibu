'use client';
// 侧栏的通知入口：桌面侧栏弹出锚定面板，手机抽屉里直接进通知页；角标 = 未读通知 + 未看的新公告。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellIcon } from '@/lib/navigation/nav-icons';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { notificationsHref, useAnnouncementCenterSafe, type NotificationsTab } from '@/components/providers/AnnouncementPopupHost';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';
import { NotificationPanel } from '@/components/notifications/NotificationPanel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';

const LABEL = '通知与公告';

function Badge({ count, dot }: { count: number; dot: boolean }) {
    if (count > 0) {
        return (
            <span className="absolute -top-0.5 -right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-[3px] text-[10px] leading-none font-medium text-on-accent tabular-nums ring-2 ring-sidebar">
                {count > 99 ? '99+' : count}
            </span>
        );
    }
    return dot ? <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar" /> : null;
}

export function AnnouncementBellButton({ className, iconSize = 20, mode = 'panel' }: {
    className: string;
    iconSize?: number;
    /** link：手机抽屉里点了直接进通知页。 */
    mode?: 'panel' | 'link';
}) {
    const { user } = useSessionSafe();
    const { supportsNotifications, defaultTab, unseenAnnouncement, registerBell } = useAnnouncementCenterSafe();
    const unreadCount = useNotificationUnreadCount(user?.id ?? null, { enabled: supportsNotifications }) ?? 0;
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<NotificationsTab>(defaultTab);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const title = unreadCount > 0 ? `${LABEL}（${unreadCount} 条未读）` : LABEL;

    useEffect(() => {
        if (mode !== 'panel') return;
        return registerBell({
            element: () => triggerRef.current,
            open: (next) => { setTab(next); setOpen(true); },
        });
    }, [mode, registerBell]);

    if (mode === 'link') {
        return (
            <Link href={notificationsHref(defaultTab)} className={className} aria-label={title} title={LABEL}>
                <BellIcon size={iconSize} aria-hidden="true" />
                <Badge count={unreadCount} dot={!!unseenAnnouncement} />
            </Link>
        );
    }

    return (
        <Popover open={open} onOpenChange={(next) => {
            // 每次打开都从有未读的那一栏开始。
            if (next) setTab(unreadCount > 0 || !unseenAnnouncement ? defaultTab : 'announcements');
            setOpen(next);
        }}>
            <PopoverTrigger ref={triggerRef} className={className} aria-label={title} title={LABEL}>
                <BellIcon size={iconSize} aria-hidden="true" />
                <Badge count={unreadCount} dot={!!unseenAnnouncement} />
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={10} className="overflow-hidden p-0" aria-label={LABEL}>
                <NotificationPanel tab={tab} onTabChange={setTab} onClose={() => setOpen(false)} />
            </PopoverContent>
        </Popover>
    );
}
