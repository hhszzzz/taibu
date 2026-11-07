'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import {
    Bell,
    CheckCheck,
    ExternalLink,
    Megaphone,
    X,
} from 'lucide-react';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { Dialog } from '@/components/ui/Dialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { requestBrowserJson } from '@/lib/browser-api';
import { formatLocalDateTime } from '@/lib/local-date';
import {
    getNotificationsPage,
    markAllAsRead,
    markAsRead,
    type Notification,
} from '@/lib/notification';
import { resolveNotificationLink } from '@/lib/notification-view';
import { getAnnouncementPromptIdentity, type Announcement } from '@/lib/announcement';
import type { AnnouncementCenterTab } from '@/components/providers/AnnouncementPopupHost';

interface SidebarAnnouncementCenterProps {
    open: boolean;
    userId: string | null;
    notificationsEnabled: boolean;
    initialTab: AnnouncementCenterTab;
    onClose: () => void;
    /** 公告标签成功展示最新一条时通知宿主记为已看。 */
    onAnnouncementsViewed?: (announcement: Announcement) => void;
}

const ANNOUNCEMENT_LIMIT = 20;
const NOTIFICATION_LIMIT = 20;

const notificationTypeLabels: Record<Notification['type'], string> = {
    feature_launch: '功能',
    system: '系统',
    promotion: '活动',
};

function getRelativeTime(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${Math.max(1, diffMins)} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    return `${diffDays} 天前`;
}

/** Infinite-scroll sentinel shared by the notification and announcement lists. */
function LoadMoreSentinel({ sentinelRef, loading, label }: {
    sentinelRef: RefObject<HTMLDivElement | null>;
    loading: boolean;
    label: string;
}) {
    return (
        <div ref={sentinelRef} className="py-3 flex justify-center">
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                    <SoundWaveLoader variant="inline" />
                </div>
            ) : (
                <div className="text-xs text-foreground-secondary">{label}</div>
            )}
        </div>
    );
}

export function SidebarAnnouncementCenter({
    open,
    userId,
    notificationsEnabled,
    initialTab,
    onClose,
    onAnnouncementsViewed,
}: SidebarAnnouncementCenterProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const supportsNotifications = !!userId && notificationsEnabled;
    const defaultTab = supportsNotifications && initialTab === 'notifications'
        ? 'notifications'
        : 'announcements';
    const [activeTab, setActiveTab] = useState<AnnouncementCenterTab>(defaultTab);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [announcementLoading, setAnnouncementLoading] = useState(false);
    const [announcementLoadingMore, setAnnouncementLoadingMore] = useState(false);
    const [announcementHasMore, setAnnouncementHasMore] = useState(false);
    const [announcementNextOffset, setAnnouncementNextOffset] = useState<number | null>(null);
    const [notificationLoading, setNotificationLoading] = useState(false);
    const [notificationLoadingMore, setNotificationLoadingMore] = useState(false);
    const [notificationHasMore, setNotificationHasMore] = useState(false);
    const [notificationNextOffset, setNotificationNextOffset] = useState<number | null>(null);
    const [notificationError, setNotificationError] = useState<string | null>(null);
    const [notificationProcessing, setNotificationProcessing] = useState(false);
    const [markingId, setMarkingId] = useState<string | null>(null);
    const announcementScrollRef = useRef<HTMLDivElement | null>(null);
    const announcementSentinelRef = useRef<HTMLDivElement | null>(null);
    const notificationScrollRef = useRef<HTMLDivElement | null>(null);
    const notificationSentinelRef = useRef<HTMLDivElement | null>(null);
    const viewedAnnouncementKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, open]);

    const loadAnnouncements = useCallback(async (options?: { append?: boolean; offset?: number }) => {
        const append = options?.append === true;

        if (append) {
            setAnnouncementLoadingMore(true);
        } else {
            setAnnouncementLoading(true);
        }

        const result = await requestBrowserJson<{
            announcements?: Announcement[];
            pagination?: {
                hasMore?: boolean;
                nextOffset?: number | null;
            };
        }>(`/api/announcements?limit=${ANNOUNCEMENT_LIMIT}&offset=${options?.offset ?? 0}`, {
            method: 'GET',
        });

        if (result.error) {
            showToast('error', result.error.message || '获取公告失败');
            setAnnouncementHasMore(false);
            setAnnouncementNextOffset(null);
            if (!append) {
                setAnnouncements([]);
            }
            setAnnouncementLoading(false);
            setAnnouncementLoadingMore(false);
            return;
        }

        const nextAnnouncements = result.data?.announcements ?? [];
        const pagination = result.data?.pagination ?? {};
        setAnnouncements((current) => append ? [...current, ...nextAnnouncements] : nextAnnouncements);
        setAnnouncementHasMore(pagination.hasMore === true);
        setAnnouncementNextOffset(typeof pagination.nextOffset === 'number' ? pagination.nextOffset : null);
        setAnnouncementLoading(false);
        setAnnouncementLoadingMore(false);
    }, [showToast]);

    const loadNotifications = useCallback(async (options?: { append?: boolean; offset?: number }) => {
        if (!supportsNotifications || !userId) {
            setNotifications([]);
            setNotificationError(null);
            setNotificationHasMore(false);
            setNotificationNextOffset(null);
            return;
        }

        const append = options?.append === true;
        if (append) {
            setNotificationLoadingMore(true);
        } else {
            setNotificationLoading(true);
        }

        try {
            if (!append) {
                setNotificationError(null);
            }
            const result = await getNotificationsPage({
                limit: NOTIFICATION_LIMIT,
                offset: options?.offset ?? 0,
            });
            setNotifications((current) => append ? [...current, ...result.notifications] : result.notifications);
            setNotificationHasMore(result.pagination.hasMore);
            setNotificationNextOffset(result.pagination.nextOffset);
        } catch (error) {
            console.error('[announcement-center] failed to load notifications:', error);
            const message = error instanceof Error ? error.message : '获取通知失败';
            showToast('error', message);
            setNotificationHasMore(false);
            setNotificationNextOffset(null);
            if (!append) {
                setNotifications([]);
                setNotificationError(message);
            }
        } finally {
            setNotificationLoading(false);
            setNotificationLoadingMore(false);
        }
    }, [showToast, supportsNotifications, userId]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const timer = window.setTimeout(() => {
            void loadAnnouncements();
            void loadNotifications();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [loadAnnouncements, loadNotifications, open]);

    useEffect(() => {
        if (!open || activeTab !== 'announcements' || announcementLoading) return;
        const latest = announcements[0];
        const key = getAnnouncementPromptIdentity(latest);
        if (!latest || !key || viewedAnnouncementKeyRef.current === key) return;
        viewedAnnouncementKeyRef.current = key;
        onAnnouncementsViewed?.(latest);
    }, [activeTab, announcementLoading, announcements, onAnnouncementsViewed, open]);

    useEffect(() => {
        if (
            activeTab !== 'announcements'
            || !announcementHasMore
            || announcementNextOffset == null
            || announcementLoading
            || announcementLoadingMore
            || !announcementScrollRef.current
            || !announcementSentinelRef.current
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadAnnouncements({ append: true, offset: announcementNextOffset });
            }
        }, {
            root: announcementScrollRef.current,
            rootMargin: '120px 0px',
        });

        observer.observe(announcementSentinelRef.current);
        return () => observer.disconnect();
    }, [
        activeTab,
        announcementHasMore,
        announcementLoading,
        announcementLoadingMore,
        announcementNextOffset,
        loadAnnouncements,
    ]);

    useEffect(() => {
        if (
            activeTab !== 'notifications'
            || !notificationHasMore
            || notificationNextOffset == null
            || notificationLoading
            || notificationLoadingMore
            || !notificationScrollRef.current
            || !notificationSentinelRef.current
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadNotifications({ append: true, offset: notificationNextOffset });
            }
        }, {
            root: notificationScrollRef.current,
            rootMargin: '120px 0px',
        });

        observer.observe(notificationSentinelRef.current);
        return () => observer.disconnect();
    }, [
        activeTab,
        loadNotifications,
        notificationHasMore,
        notificationLoading,
        notificationLoadingMore,
        notificationNextOffset,
    ]);

    const unreadCount = useMemo(
        () => notifications.filter((item) => !item.is_read).length,
        [notifications],
    );

    const handleNotificationClick = async (notification: Notification) => {
        if (notificationProcessing) return;

        setMarkingId(notification.id);
        if (!notification.is_read) {
            const success = await markAsRead(notification.id);
            if (!success) {
                showToast('error', '标记已读失败');
                setMarkingId(null);
                return;
            }

            setNotifications((current) => current.map((item) => (
                item.id === notification.id ? { ...item, is_read: true } : item
            )));
        }

        setMarkingId(null);

        const href = resolveNotificationLink(notification);
        if (href) {
            onClose();
            router.push(href);
        }
    };

    const handleMarkAllRead = async () => {
        if (!userId || unreadCount <= 0 || notificationProcessing) {
            return;
        }

        setNotificationProcessing(true);
        const success = await markAllAsRead();
        if (!success) {
            showToast('error', '一键已读失败');
            setNotificationProcessing(false);
            return;
        }

        setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
        setNotificationProcessing(false);
        showToast('success', '已将最近 3 天通知全部标记为已读');
    };

    if (!open) {
        return null;
    }

    return (
        <Dialog bare open={open} onClose={onClose} labelledBy="announcement-center-title" className="dialog-plain dialog-lg">
            <aside className="w-full max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-2 border-b border-border/60 bg-background/80">
                    <h2 id="announcement-center-title" className="text-xl font-bold text-foreground">通知 / 公告</h2>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center p-1 bg-background-secondary rounded-md">
                            {supportsNotifications ? (
                                <Button unstyled
                                    onClick={() => setActiveTab('notifications')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-all ${
                                        activeTab === 'notifications'
                                            ? 'bg-background shadow-sm text-accent'
                                            : 'text-foreground-secondary hover:text-foreground'
                                    }`}
                                >
                                    <Bell className="w-3.5 h-3.5" />
                                    通知
                                </Button>
                            ) : null}
                            <Button unstyled
                                onClick={() => setActiveTab('announcements')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-all ${
                                    activeTab === 'announcements'
                                        ? 'bg-background shadow-sm text-accent'
                                        : 'text-foreground-secondary hover:text-foreground'
                                }`}
                            >
                                <Megaphone className="w-3.5 h-3.5" />
                                公告
                            </Button>
                        </div>
                        <IconButton label="关闭公告中心" expand="none" onClick={onClose} className="p-1.5">
                            <X className="w-5 h-5" aria-hidden="true" />
                        </IconButton>
                    </div>
                </div>

                <div
                    ref={activeTab === 'notifications' ? notificationScrollRef : announcementScrollRef}
                    className="flex-1 overflow-y-auto p-8 custom-scrollbar"
                >
                    {activeTab === 'notifications' && supportsNotifications ? (
                        notificationLoading ? (
                            <div className="flex min-h-[200px] items-center justify-center">
                                <SoundWaveLoader variant="inline" />
                            </div>
                        ) : notificationError ? (
                            <div className="text-center py-20">
                                <div className="text-sm font-semibold text-danger mb-2">通知加载失败</div>
                                <p className="text-xs text-danger">{notificationError}</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="text-center py-20">
                                <div className="text-foreground/10 text-sm font-bold uppercase tracking-[0.2em] mb-2">No Notifications</div>
                                <p className="text-xs text-foreground-secondary">最近 3 天没有任何通知</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="text-xs text-foreground-secondary">
                                        最近 3 天通知
                                    </div>
                                    <Button variant="secondary" size="sm" onClick={handleMarkAllRead} disabled={notificationProcessing || unreadCount <= 0} className="text-xs">
                                        <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                        一键已读
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {notifications.map((notification) => (
                                        <Button unstyled
                                            key={notification.id}
                                            onClick={() => void handleNotificationClick(notification)}
                                            className={`relative w-full rounded-xl border px-4 py-3 text-left transition-colors flex flex-col gap-1.5 ${
                                                notification.is_read
                                                    ? 'bg-background border-border hover:bg-background-secondary'
                                                    : 'bg-accent/10 border-accent/20 hover:bg-accent/15'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3 w-full">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {!notification.is_read ? (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                                                    ) : (
                                                        <span className="w-1.5 h-1.5 flex-shrink-0" />
                                                    )}
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-secondary flex-shrink-0">
                                                        {notificationTypeLabels[notification.type]}
                                                    </span>
                                                    <h3 className={`truncate text-sm font-medium ${notification.is_read ? 'text-foreground-secondary' : 'text-foreground'}`}>
                                                        {notification.title}
                                                    </h3>
                                                </div>
                                                <div className="text-[11px] font-medium text-foreground-secondary whitespace-nowrap flex-shrink-0">
                                                    {markingId === notification.id ? '处理中' : getRelativeTime(notification.created_at)}
                                                </div>
                                            </div>
                                            
                                            {(notification.content || notification.link) && (
                                                <div className="flex items-end justify-between gap-4 pl-[14px] w-full">
                                                    {notification.content ? (
                                                        <p className="text-[13px] leading-relaxed text-foreground-secondary line-clamp-2 break-all text-left">
                                                            {notification.content}
                                                        </p>
                                                    ) : <div />}
                                                    
                                                    {notification.link ? (
                                                        <div className="inline-flex items-center gap-1 text-[11px] font-bold text-accent whitespace-nowrap flex-shrink-0">
                                                            查看详情
                                                            <ExternalLink className="w-3 h-3" />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </Button>
                                    ))}
                                    {notificationHasMore && (
                                        <LoadMoreSentinel sentinelRef={notificationSentinelRef} loading={notificationLoadingMore} label="继续下滑加载更多通知" />
                                    )}
                                </div>
                            </div>
                        )
                    ) : announcementLoading ? (
                        <div className="flex min-h-[200px] items-center justify-center">
                            <SoundWaveLoader variant="inline" />
                        </div>
                    ) : announcements.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="text-foreground/10 text-sm font-bold uppercase tracking-[0.2em] mb-2">No Records</div>
                            <p className="text-xs text-foreground-secondary">当前没有任何公告历史</p>
                        </div>
                    ) : (
                        <div className="relative pl-6">
                            <div className="absolute left-[9px] top-3 bottom-0 w-0.5 bg-border/60" />

                            <div className="space-y-10">
                                {announcements.map((announcement) => (
                                    <div key={announcement.id} className="relative group">
                                        <div className="absolute left-[-20px] top-[6px] w-3 h-3 rounded-full z-10 border-2 border-background transition-colors duration-200 bg-background-tertiary group-hover:bg-accent" />

                                        <div className="space-y-2">
                                            <MarkdownContent
                                                content={announcement.content}
                                                className="text-[14px] leading-relaxed text-foreground/80"
                                            />
                                            <div className="text-[11px] font-medium text-foreground-secondary font-mono uppercase tracking-tight">
                                                {getRelativeTime(announcement.publishedAt)} {formatLocalDateTime(new Date(announcement.publishedAt))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {announcementHasMore && (
                                    <LoadMoreSentinel sentinelRef={announcementSentinelRef} loading={announcementLoadingMore} label="继续下滑加载更多公告" />
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-border/60 flex justify-end gap-3">
                    <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
                </div>
            </aside>
        </Dialog>
    );
}
