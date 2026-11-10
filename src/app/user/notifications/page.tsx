/**
 * 通知中心：「通知 | 公告」两段（`?tab=announcements`）。
 *
 * 通知段需登录且通知功能开启：筛选、加载更多、多选、批量删除、批量已读；
 * 公告段访客也能看，点开进单条阅读弹窗。
 *
 * 'use client'：列表、筛选与多选状态都在客户端
 */
'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Check, CheckCheck, ChevronDown, Megaphone, Trash2 } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useHeaderTitle } from '@/components/layout/HeaderMenuContext';
import { useAnnouncementCenterSafe, type NotificationsTab } from '@/components/providers/AnnouncementPopupHost';
import { AnnouncementRows } from '@/components/notifications/AnnouncementList';
import { NOTIFICATION_TYPES, NotificationRow } from '@/components/notifications/NotificationRow';
import { useAnnouncementFeed, useMarkLatestAnnouncementSeen } from '@/components/notifications/feeds';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { StatePanel } from '@/components/ui/StatePanel';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';
import {
    deleteNotification,
    deleteNotifications,
    getNotificationsPage,
    markAllAsRead,
    markAsRead,
    markSelectedAsRead,
    type Notification,
} from '@/lib/notification';
import {
    filterNotifications,
    formatNotificationTime,
    groupNotificationsByDay,
    reconcileSelectedNotificationIds,
    resolveNotificationLink,
    type NotificationFilterState,
} from '@/lib/notification-view';

const PAGE_SIZE = 50;

const READ_FILTER_OPTIONS: Array<{ value: NotificationFilterState['read']; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'unread', label: '未读' },
    { value: 'read', label: '已读' },
];

const TYPE_FILTER_OPTIONS: Array<{ value: NotificationFilterState['type']; label: string }> = [
    { value: 'all', label: '全部类型' },
    { value: 'system', label: '系统' },
    { value: 'feature_launch', label: '功能' },
    { value: 'promotion', label: '活动' },
];

function TypeFilterMenu({ value, onChange }: { value: NotificationFilterState['type']; onChange: (value: NotificationFilterState['type']) => void }) {
    const current = TYPE_FILTER_OPTIONS.find(option => option.value === value) ?? TYPE_FILTER_OPTIONS[0];
    return (
        <Menu>
            <MenuTrigger aria-label={`通知类型：${current.label}`}
                className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-sm text-foreground-secondary transition-colors hover:bg-fill-ghost-hover hover:text-foreground data-popup-open:bg-fill-ghost-hover">
                {current.label}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </MenuTrigger>
            <MenuContent className="w-36">
                <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as NotificationFilterState['type'])}>
                    {TYPE_FILTER_OPTIONS.map(option => <MenuRadioItem key={option.value} value={option.value}>{option.label}</MenuRadioItem>)}
                </MenuRadioGroup>
            </MenuContent>
        </Menu>
    );
}

function SelectableNotificationRow({ notification, selected, onToggleSelect }: {
    notification: Notification;
    selected: boolean;
    onToggleSelect: () => void;
}) {
    const type = NOTIFICATION_TYPES[notification.type] ?? NOTIFICATION_TYPES.system;
    const Icon = type.icon;
    const time = formatNotificationTime(notification.created_at);
    const checkboxId = `notification-select-${notification.id}`;
    return (
        <li className={`relative rounded-xl transition-colors before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:border-t-[0.5px] before:border-border first:before:hidden md:before:inset-x-4 ${selected ? 'bg-accent-light' : 'hover:bg-fill-ghost-hover'}`}>
            <div className="flex gap-3 px-3 py-3.5 md:px-4">
                <Checkbox id={checkboxId} checked={selected} onCheckedChange={() => onToggleSelect()} className="mt-1" />
                {/* 整行都能点选，复选框本身仍是唯一的可聚焦控件。 */}
                <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                    <span className="flex items-baseline justify-between gap-4">
                        <span className={`min-w-0 text-[15px] leading-6 ${notification.is_read ? 'text-foreground-secondary' : 'font-medium text-foreground'}`}>{notification.title}</span>
                        {time ? <time dateTime={notification.created_at} className="shrink-0 text-xs text-foreground-tertiary">{time}</time> : null}
                    </span>
                    {notification.content ? <span className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-foreground-secondary">{notification.content}</span> : null}
                    <span className="mt-2 inline-flex items-center gap-1 text-xs text-foreground-tertiary"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{type.label}</span>
                </label>
            </div>
        </li>
    );
}

function ListSkeleton() {
    return (
        <div aria-hidden="true" className="flex flex-col">
            {[1, 2, 3, 4].map(index => (
                <div key={index} className="flex animate-pulse gap-3 py-4 pl-5">
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-40 rounded bg-foreground/10" />
                        <div className="h-3 w-full rounded bg-foreground/5" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function NotificationsTabContent({ tabs }: { tabs: ReactNode }) {
    const router = useRouter();
    const { user } = useSessionSafe();
    const userId = user?.id;
    const { showToast } = useToast();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
    const [filters, setFilters] = useState<NotificationFilterState>({ read: 'all', type: 'all' });
    // 每次重新加载列表都换代；加载更多只在发起时那一代仍有效时才合并结果。
    const listGenerationRef = useRef(0);

    // 账号切换或重试时重新加载；旧请求的结果直接丢弃。
    useEffect(() => {
        if (!userId) return;
        const generation = ++listGenerationRef.current;
        const isCurrent = () => listGenerationRef.current === generation;
        void (async () => {
            setIsLoading(true);
            setLoadError(null);
            setSelectMode(false);
            setSelectedIds(new Set());
            try {
                const page = await getNotificationsPage({ limit: PAGE_SIZE });
                if (!isCurrent()) return;
                setNotifications(page.notifications);
                setNextOffset(page.pagination.hasMore ? page.pagination.nextOffset : null);
            } catch (error) {
                if (!isCurrent()) return;
                const message = error instanceof Error ? error.message : '获取通知失败';
                setNotifications([]);
                setNextOffset(null);
                setLoadError(message);
                showToast('error', message);
            } finally {
                if (isCurrent()) setIsLoading(false);
            }
        })();
        return () => { listGenerationRef.current += 1; };
    }, [reloadKey, showToast, userId]);

    const loadMore = useCallback(async () => {
        if (nextOffset == null || loadingMore) return;
        const generation = listGenerationRef.current;
        setLoadingMore(true);
        try {
            const page = await getNotificationsPage({ limit: PAGE_SIZE, offset: nextOffset });
            if (listGenerationRef.current !== generation) return;
            setNotifications(current => {
                const seen = new Set(current.map(item => item.id));
                return [...current, ...page.notifications.filter(item => !seen.has(item.id))];
            });
            setNextOffset(page.pagination.hasMore ? page.pagination.nextOffset : null);
        } catch (error) {
            if (listGenerationRef.current === generation) {
                showToast('error', error instanceof Error ? error.message : '加载更多通知失败');
            }
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, nextOffset, showToast]);

    const unreadCount = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);
    const visibleNotifications = useMemo(() => filterNotifications(notifications, filters), [notifications, filters]);
    const groupedNotifications = useMemo(() => groupNotificationsByDay(visibleNotifications), [visibleNotifications]);
    const selectedCount = selectedIds.size;
    const allSelected = visibleNotifications.length > 0 && visibleNotifications.every((item) => selectedIds.has(item.id));

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('taibu:notifications-unread', { detail: { count: unreadCount } }));
    }, [unreadCount]);

    const toggleSelectMode = () => {
        setSelectMode((value) => !value);
        setSelectedIds(new Set());
    };

    const toggleSelect = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(visibleNotifications.map((item) => item.id)));
    };

    const updateFilters = (patch: Partial<NotificationFilterState>) => {
        const nextFilters = { ...filters, ...patch };
        setFilters(nextFilters);
        setSelectedIds((existing) => reconcileSelectedNotificationIds(existing, filterNotifications(notifications, nextFilters)));
    };

    const markReadLocally = (ids: Set<string>) => {
        setNotifications((current) => current.map((item) => (ids.has(item.id) ? { ...item, is_read: true } : item)));
    };

    const handleMarkRead = async (notification: Notification) => {
        if (notification.is_read) return true;
        const success = await markAsRead(notification.id);
        if (success) markReadLocally(new Set([notification.id]));
        else showToast('error', '标记已读失败');
        return success;
    };

    // 点整行：标为已读，有链接就打开。
    const handleOpen = async (notification: Notification) => {
        const success = await handleMarkRead(notification);
        const href = resolveNotificationLink(notification);
        if (success && href) router.push(href);
    };

    const handleDeleteSingle = async (id: string) => {
        const success = await deleteNotification(id);
        if (success) {
            setNotifications((current) => current.filter((item) => item.id !== id));
            showToast('success', '通知已删除');
        } else {
            showToast('error', '删除通知失败');
        }
    };

    const handleMarkAllRead = async () => {
        setIsProcessing(true);
        const success = await markAllAsRead();
        if (success) {
            setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
            showToast('success', '已将全部通知标记为已读');
        } else {
            showToast('error', '全部标为已读失败');
        }
        setIsProcessing(false);
    };

    const handleMarkSelectedRead = async () => {
        if (selectedIds.size === 0) return;
        const ids = new Set(selectedIds);
        setIsProcessing(true);
        const success = await markSelectedAsRead(Array.from(ids));
        if (success) {
            markReadLocally(ids);
            setSelectedIds(new Set());
            showToast('success', `已将 ${ids.size} 条通知标为已读`);
        } else {
            showToast('error', '批量标为已读失败');
        }
        setIsProcessing(false);
    };

    const handleDeleteSelected = async () => {
        if (selectedIds.size === 0) return;
        const ids = new Set(selectedIds);
        setIsProcessing(true);
        const success = await deleteNotifications(Array.from(ids));
        if (success) {
            if (notifications.every((item) => ids.has(item.id))) setSelectMode(false);
            setNotifications((current) => current.filter((item) => !ids.has(item.id)));
            setSelectedIds(new Set());
            showToast('success', `已删除 ${ids.size} 条通知`);
        } else {
            showToast('error', '批量删除失败');
        }
        setIsProcessing(false);
        setConfirmBatchDelete(false);
    };

    const hasNotifications = notifications.length > 0;

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                {tabs}
                {hasNotifications ? (
                    <div className="-mr-2 flex items-center">
                        {!selectMode ? (
                            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} disabled={isProcessing || unreadCount === 0}>
                                {isProcessing ? <SoundWaveLoader variant="inline" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
                                全部已读
                            </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={toggleSelectMode} aria-pressed={selectMode} className="aria-pressed:text-accent">
                            {selectMode ? '完成' : '选择'}
                        </Button>
                    </div>
                ) : null}
            </div>

            {hasNotifications ? (
                <div className="flex items-center gap-2">
                    <SegmentedControl
                        ariaLabel="阅读状态"
                        mode="toggle"
                        size="sm"
                        value={filters.read}
                        onChange={(read) => updateFilters({ read })}
                        className="w-[13.5rem]"
                        options={READ_FILTER_OPTIONS.map(option => ({
                            value: option.value,
                            label: <>{option.label}{option.value === 'unread' && unreadCount ? <span className="text-xs text-accent tabular-nums">{unreadCount}</span> : null}</>,
                        }))}
                    />
                    <TypeFilterMenu value={filters.type} onChange={(type) => updateFilters({ type })} />
                </div>
            ) : null}

            {isLoading ? (
                <ListSkeleton />
            ) : loadError ? (
                <StatePanel
                    tone="danger"
                    title="加载通知失败"
                    description={loadError}
                    action={<Button variant="secondary" size="xs" onClick={() => setReloadKey(key => key + 1)}>重试</Button>}
                />
            ) : !hasNotifications ? (
                <StatePanel icon={Bell} title="暂无通知" description="最近 3 天的系统提醒、任务结果和功能更新会出现在这里。" />
            ) : visibleNotifications.length === 0 ? (
                filters.read === 'unread' && filters.type === 'all'
                    ? <StatePanel title="没有未读通知" description="所有通知都已读过。" />
                    : <StatePanel title="当前筛选下没有通知" description="换个分类看看。" />
            ) : (
                <div className="flex flex-col gap-6">
                    {groupedNotifications.map((group) => (
                        <section key={group.label} aria-label={group.label}>
                            <h2 className="mb-1 text-[13px] font-medium text-foreground-tertiary">{group.label}</h2>
                            {/* 行内留白与悬停底色向外延伸，文字与分隔线仍和标题左对齐。 */}
                            <ul className="-mx-3 flex flex-col md:-mx-4">
                                {group.items.map((notification) => selectMode ? (
                                    <SelectableNotificationRow
                                        key={notification.id}
                                        notification={notification}
                                        selected={selectedIds.has(notification.id)}
                                        onToggleSelect={() => toggleSelect(notification.id)}
                                    />
                                ) : (
                                    <NotificationRow
                                        key={notification.id}
                                        notification={notification}
                                        onOpen={() => { void handleOpen(notification); }}
                                        actions={(
                                            <>
                                                {!notification.is_read ? (
                                                    <IconButton label="标为已读" title="标为已读" size="sm" onClick={() => { void handleMarkRead(notification); }}>
                                                        <Check aria-hidden="true" />
                                                    </IconButton>
                                                ) : null}
                                                <IconButton label="删除通知" title="删除" size="sm" className="hover:bg-danger/10 hover:text-danger" onClick={() => { void handleDeleteSingle(notification.id); }}>
                                                    <Trash2 aria-hidden="true" />
                                                </IconButton>
                                            </>
                                        )}
                                    />
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}

            {!isLoading && nextOffset != null ? (
                <div className="flex justify-center">
                    <Button variant="secondary" onClick={() => { void loadMore(); }} loading={loadingMore}>
                        加载更早的通知
                    </Button>
                </div>
            ) : null}

            {selectMode && visibleNotifications.length > 0 ? <div className="h-16" aria-hidden="true" /> : null}
            {selectMode && visibleNotifications.length > 0 ? (
                <div className="fixed inset-x-0 bottom-[calc(var(--sab,0px)+5.5rem)] z-40 flex justify-center px-4 lg:bottom-8">
                    <div role="toolbar" aria-label="批量操作" className="flex w-full max-w-xl items-center gap-2 rounded-2xl border-[0.5px] border-border bg-surface py-2 pr-2 pl-4 shadow-[var(--shadow-lg)]">
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <Checkbox checked={allSelected} onCheckedChange={() => toggleSelectAll()} />
                            全选
                        </label>
                        <span role="status" className="flex-1 truncate text-sm text-foreground-secondary">已选择 {selectedCount} 项</span>
                        <Button variant="ghost" size="sm" onClick={handleMarkSelectedRead} disabled={isProcessing || selectedCount === 0}>
                            标为已读
                        </Button>
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmBatchDelete(true)} disabled={isProcessing || selectedCount === 0}>
                            删除
                        </Button>
                    </div>
                </div>
            ) : null}

            <ConfirmDialog
                isOpen={confirmBatchDelete}
                onClose={() => setConfirmBatchDelete(false)}
                onConfirm={handleDeleteSelected}
                loading={isProcessing}
                title="删除通知"
                description={`确定要删除选中的 ${selectedCount} 条通知吗？此操作无法撤销。`}
                confirmText="删除"
                variant="danger"
            />
        </>
    );
}

function AnnouncementsTabContent({ tabs }: { tabs: ReactNode }) {
    const { openAnnouncement } = useAnnouncementCenterSafe();
    const feed = useAnnouncementFeed(true);
    const newAnnouncementKey = useMarkLatestAnnouncementSeen(feed.loading ? undefined : feed.items[0]);

    return (
        <>
            {tabs}
            {feed.loading ? (
                <ListSkeleton />
            ) : feed.error ? (
                <StatePanel
                    tone="danger"
                    title="加载公告失败"
                    description={feed.error}
                    action={<Button variant="secondary" size="xs" onClick={feed.reload}>重试</Button>}
                />
            ) : feed.items.length === 0 ? (
                <StatePanel icon={Megaphone} title="还没有公告" description="版本更新与站务公告会出现在这里。" />
            ) : (
                <div className="-mx-3 md:-mx-4">
                    <AnnouncementRows announcements={feed.items} unseenKey={newAnnouncementKey} onOpen={openAnnouncement} />
                </div>
            )}
            {!feed.loading && feed.nextOffset != null ? (
                <div className="flex justify-center">
                    <Button variant="secondary" onClick={feed.loadMore} loading={feed.loadingMore}>加载更早的公告</Button>
                </div>
            ) : null}
        </>
    );
}

function NotificationCenter() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { isLoading: togglesLoading } = useFeatureToggles();
    const { supportsNotifications } = useAnnouncementCenterSafe();
    const unreadCount = useNotificationUnreadCount(user?.id ?? null, { enabled: supportsNotifications }) ?? 0;
    const tab: NotificationsTab = supportsNotifications && searchParams.get('tab') !== 'announcements' ? 'notifications' : 'announcements';
    const title = supportsNotifications ? '通知中心' : '公告';
    useHeaderTitle(sessionLoading || togglesLoading ? null : title);
    const setTab = (next: NotificationsTab) => {
        router.replace(next === 'announcements' ? `${pathname}?tab=announcements` : pathname, { scroll: false });
    };

    const tabs = supportsNotifications ? (
        <SegmentedControl<NotificationsTab>
            ariaLabel="通知与公告"
            mode="tabs"
            size="sm"
            value={tab}
            onChange={setTab}
            className="w-[12rem]"
            options={[
                { value: 'notifications', label: <>通知{unreadCount > 0 ? <span className="text-xs text-accent tabular-nums">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</> },
                { value: 'announcements', label: '公告' },
            ]}
        />
    ) : null;

    return (
        <div className="min-h-screen bg-background pb-20 text-foreground lg:pb-8">
            <div className="mx-auto flex max-w-[44rem] flex-col gap-5 px-4 py-4 md:gap-6 md:py-10">
                {/* 手机端顶栏已显示标题，这里不再重复。 */}
                <h1 className="hidden font-display text-[1.875rem] leading-tight font-normal md:block">{title}</h1>
                {sessionLoading || togglesLoading ? (
                    <ListSkeleton />
                ) : tab === 'notifications' ? (
                    <NotificationsTabContent tabs={tabs} />
                ) : (
                    <AnnouncementsTabContent tabs={tabs} />
                )}
            </div>
        </div>
    );
}

export default function NotificationsPage() {
    return <Suspense fallback={<ListSkeleton />}><NotificationCenter /></Suspense>;
}
