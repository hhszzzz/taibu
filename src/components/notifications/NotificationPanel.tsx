'use client';

/**
 * 铃铛弹出的通知面板：「通知 / 公告」两栏（访客与通知关闭时只有公告），通知栏可全部已读；
 * 列表滚到底续页，底部「查看全部」进通知页。
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ChevronRight, Megaphone } from 'lucide-react';
import { markAllAsRead, markAsRead, type Notification } from '@/lib/notification';
import { resolveNotificationLink } from '@/lib/notification-view';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { notificationsHref, useAnnouncementCenterSafe, type NotificationsTab } from '@/components/providers/AnnouncementPopupHost';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { AnnouncementRows } from './AnnouncementList';
import { NotificationRow } from './NotificationRow';
import { useAnnouncementFeed, useLoadMoreSentinel, useMarkLatestAnnouncementSeen, useNotificationFeed } from './feeds';

function PanelState({ icon: Icon, text, action }: { icon?: typeof Bell; text: string; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            {Icon ? <Icon className="h-5 w-5 text-foreground-tertiary" aria-hidden="true" /> : null}
            <p className="text-[13px] text-foreground-secondary">{text}</p>
            {action}
        </div>
    );
}

export function NotificationPanel({ tab, onTabChange, onClose }: {
    tab: NotificationsTab;
    onTabChange: (tab: NotificationsTab) => void;
    onClose: () => void;
}) {
    const router = useRouter();
    const { showToast } = useToast();
    const { user } = useSessionSafe();
    const { supportsNotifications, unseenAnnouncement, openAnnouncement } = useAnnouncementCenterSafe();
    const activeTab = supportsNotifications ? tab : 'announcements';
    const unreadCount = useNotificationUnreadCount(user?.id ?? null, { enabled: supportsNotifications }) ?? 0;
    const notifications = useNotificationFeed(supportsNotifications && activeTab === 'notifications');
    const announcements = useAnnouncementFeed(activeTab === 'announcements');
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const feed = activeTab === 'notifications' ? notifications : announcements;
    const sentinelRef = useLoadMoreSentinel(scrollRef, !feed.loading && feed.nextOffset != null, feed.loadMore);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [markingAll, setMarkingAll] = useState(false);

    const newAnnouncementKey = useMarkLatestAnnouncementSeen(activeTab === 'announcements' && !announcements.loading ? announcements.items[0] : undefined);

    const openNotification = async (notification: Notification) => {
        if (busyId) return;
        if (!notification.is_read) {
            setBusyId(notification.id);
            const success = await markAsRead(notification.id);
            setBusyId(null);
            if (!success) {
                showToast('error', '标记已读失败');
                return;
            }
            notifications.update(items => items.map(item => item.id === notification.id ? { ...item, is_read: true } : item));
        }
        const href = resolveNotificationLink(notification);
        if (href) {
            onClose();
            router.push(href);
        }
    };

    const handleMarkAllRead = async () => {
        setMarkingAll(true);
        const success = await markAllAsRead();
        setMarkingAll(false);
        if (!success) {
            showToast('error', '全部标为已读失败');
            return;
        }
        notifications.update(items => items.map(item => ({ ...item, is_read: true })));
    };

    return (
        <div className="flex max-h-[min(34rem,calc(100dvh-2rem))] w-[min(23rem,calc(100vw-2rem))] flex-col">
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                {supportsNotifications ? (
                    <SegmentedControl<NotificationsTab> ariaLabel="通知与公告" mode="tabs" size="sm" value={activeTab} onChange={onTabChange} className="w-[11.5rem]" options={[
                        { value: 'notifications', label: <>通知{unreadCount > 0 ? <span className="text-xs text-accent tabular-nums">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</> },
                        { value: 'announcements', label: <>公告{unseenAnnouncement ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="有新公告" /> : null}</> },
                    ]} />
                ) : (
                    <h2 className="px-1 text-sm font-medium text-foreground">公告</h2>
                )}
                {activeTab === 'notifications' ? (
                    <Button variant="ghost" size="sm" onClick={() => { void handleMarkAllRead(); }} disabled={markingAll || unreadCount === 0}>
                        <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />全部已读
                    </Button>
                ) : null}
            </div>

            <div ref={scrollRef} role={supportsNotifications ? 'tabpanel' : undefined} aria-label={activeTab === 'notifications' ? '通知' : '公告'}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5">
                {feed.loading ? (
                    <div className="flex justify-center py-12"><SoundWaveLoader variant="inline" /></div>
                ) : feed.error ? (
                    <PanelState text={activeTab === 'notifications' ? '通知加载失败' : '公告加载失败'}
                        action={<Button variant="secondary" size="sm" onClick={feed.reload}>重试</Button>} />
                ) : activeTab === 'notifications' ? (
                    notifications.items.length ? (
                        <ul className="flex flex-col">
                            {notifications.items.map(notification => (
                                <NotificationRow key={notification.id} compact notification={notification} busy={busyId === notification.id}
                                    onOpen={() => { void openNotification(notification); }} />
                            ))}
                        </ul>
                    ) : <PanelState icon={Bell} text="最近 3 天没有通知" />
                ) : announcements.items.length ? (
                    <AnnouncementRows compact announcements={announcements.items} unseenKey={newAnnouncementKey}
                        onOpen={(announcement) => { onClose(); openAnnouncement(announcement); }} />
                ) : <PanelState icon={Megaphone} text="还没有公告" />}
                {!feed.loading && feed.nextOffset != null ? (
                    <div ref={sentinelRef} className="flex justify-center py-3">{feed.loadingMore ? <SoundWaveLoader variant="inline" /> : null}</div>
                ) : null}
            </div>

            <div className="border-t-[0.5px] border-border p-1.5">
                <Link href={notificationsHref(activeTab)} onClick={onClose}
                    className="flex h-9 items-center justify-between rounded-lg px-2.5 text-[13px] text-foreground-secondary transition-colors hover:bg-fill-ghost-hover hover:text-foreground">
                    查看全部{activeTab === 'notifications' ? '通知' : '公告'}<ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
            </div>
        </div>
    );
}
