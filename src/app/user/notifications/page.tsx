/**
 * 消息通知页面
 *
 * 支持筛选、加载更多、多选、批量删除、批量已读
 *
 * 'use client'：列表、筛选与多选状态都在客户端
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, ChevronRight, Gift, Megaphone, Sparkles, Trash2, type LucideIcon } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
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

const TYPE_STYLES: Record<Notification['type'], { icon: LucideIcon; label: string }> = {
    feature_launch: { icon: Sparkles, label: '功能上线' },
    system: { icon: Megaphone, label: '系统通知' },
    promotion: { icon: Gift, label: '活动推广' },
};

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

const OUTLINE_BUTTON_CLASS = 'inline-flex h-9 items-center gap-1.5 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-3 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-50';
const QUIET_BUTTON_CLASS = 'inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';
const ROW_ICON_BUTTON_CLASS = 'flex h-9 w-9 items-center justify-center rounded-lg text-foreground-tertiary transition-colors hover:bg-background-tertiary hover:text-foreground md:h-7 md:w-7';

/** 分段控件：一组互斥选项，选中项浮起为白底。 */
function SegmentedControl<T extends string>({ label, options, value, onChange }: {
    label: string;
    options: ReadonlyArray<{ value: T; label: string; badge?: number }>;
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-[10px] bg-background-secondary p-0.5">
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    aria-pressed={value === option.value}
                    onClick={() => onChange(option.value)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-foreground-secondary transition-colors hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgba(20,20,19,0.08)] dark:aria-pressed:bg-background-tertiary"
                >
                    {option.label}
                    {option.badge ? <span className="text-xs text-accent tabular-nums">{option.badge}</span> : null}
                </button>
            ))}
        </div>
    );
}

function NotificationRow({
    notification,
    selectMode,
    selected,
    onToggleSelect,
    onOpen,
    onMarkRead,
    onDelete,
}: {
    notification: Notification;
    selectMode: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onOpen: () => void;
    onMarkRead: () => void;
    onDelete: () => void;
}) {
    const style = TYPE_STYLES[notification.type] ?? TYPE_STYLES.system;
    const Icon = style.icon;
    const unread = !notification.is_read;
    const time = formatNotificationTime(notification.created_at);
    const checkboxId = `notification-select-${notification.id}`;

    const text = (
        <>
            <div className="flex items-baseline justify-between gap-4">
                <h3 className={`min-w-0 text-[15px] leading-6 ${unread ? 'font-medium text-foreground' : 'text-foreground-secondary'}`}>
                    {notification.title}
                </h3>
                {time ? <time dateTime={notification.created_at} className="shrink-0 text-xs text-foreground-tertiary">{time}</time> : null}
            </div>
            {notification.content ? (
                <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-foreground-secondary">{notification.content}</p>
            ) : null}
        </>
    );

    const typeLabel = (
        <span className="inline-flex items-center gap-1 text-xs text-foreground-tertiary">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />{style.label}
        </span>
    );

    if (selectMode) {
        return (
            <li className={`relative before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:border-t-[0.5px] before:border-border first:before:hidden md:before:inset-x-4 rounded-xl transition-colors ${selected ? 'bg-accent-light' : 'hover:bg-background-secondary/70'}`}>
                <div className="flex gap-3 px-3 py-3.5 md:px-4">
                    <input id={checkboxId} type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
                    {/* 整行都能点选，复选框本身仍是唯一的可聚焦控件。 */}
                    <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                        {text}
                        <div className="mt-2">{typeLabel}</div>
                    </label>
                </div>
            </li>
        );
    }

    return (
        <li className="group relative before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:border-t-[0.5px] before:border-border first:before:hidden md:before:inset-x-4 rounded-xl transition-colors hover:bg-background-secondary/70">
            <div className="flex gap-3 py-3.5 pr-2 pl-3 md:pr-3 md:pl-4">
                <span className="flex h-6 w-2 shrink-0 items-center">
                    {unread ? (
                        <span className="h-2 w-2 rounded-full bg-accent"><span className="sr-only">未读</span></span>
                    ) : null}
                </span>
                <div className="min-w-0 flex-1">
                    {text}
                    <div className="mt-1.5 flex min-h-9 items-center gap-3 md:min-h-7">
                        {typeLabel}
                        {notification.link ? (
                            <button type="button" onClick={onOpen} className="inline-flex items-center text-xs text-accent hover:text-accent-strong">
                                查看详情<ChevronRight className="h-3 w-3" aria-hidden="true" />
                            </button>
                        ) : null}
                        {/* 手机上常显；桌面端悬停或键盘聚焦到该行时出现。 */}
                        <span className="ml-auto flex gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                            {unread ? (
                                <button type="button" onClick={onMarkRead} aria-label="标为已读" title="标为已读" className={ROW_ICON_BUTTON_CLASS}>
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                </button>
                            ) : null}
                            <button type="button" onClick={onDelete} aria-label="删除通知" title="删除" className={`${ROW_ICON_BUTTON_CLASS} hover:bg-danger/10 hover:text-danger`}>
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </span>
                    </div>
                </div>
            </div>
        </li>
    );
}

function NotificationsSkeleton() {
    return (
        <div aria-hidden="true" className="divide-y-[0.5px] divide-border overflow-hidden rounded-[14px] border-[0.5px] border-border bg-surface">
            {[1, 2, 3, 4].map(index => (
                <div key={index} className="flex animate-pulse gap-4 py-4 pr-3 pl-5">
                    <div className="h-9 w-9 rounded-full bg-foreground/10" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-40 rounded bg-foreground/10" />
                        <div className="h-3 w-full rounded bg-foreground/5" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyState({ icon = false, children }: { icon?: boolean; children: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center rounded-[14px] border-[0.5px] border-dashed border-border-hover px-6 py-16 text-center">
            {icon ? (
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-background-secondary">
                    <Bell className="h-6 w-6 text-foreground-tertiary" aria-hidden="true" />
                </div>
            ) : null}
            {children}
        </div>
    );
}

export default function NotificationsPage() {
    const router = useRouter();
    const { user, loading: sessionLoading } = useSessionSafe();
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
        if (sessionLoading) return;
        if (!userId) {
            router.push('/');
            return;
        }
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
    }, [reloadKey, router, sessionLoading, showToast, userId]);

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

    const handleOpen = async (notification: Notification) => {
        if (!notification.link) return;
        await handleMarkRead(notification);
        router.push(resolveNotificationLink(notification.link));
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
    const unreadLabel = unreadCount > 0 ? `${unreadCount} 条未读` : '全部已读';

    return (
        <div className="min-h-screen bg-background pb-20 text-foreground lg:pb-8">
            <div className={`mx-auto flex max-w-[44rem] flex-col gap-6 px-4 py-4 md:gap-8 md:py-10 ${selectMode ? 'pb-28' : ''}`}>
                <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* 手机端顶栏已显示「通知中心」，这里不再重复标题。 */}
                        <h1 className="hidden font-display text-[2.125rem] leading-tight font-normal md:block">通知</h1>
                        <p className="text-[15px] text-foreground-secondary">
                            {isLoading ? '系统提醒、功能上线与活动消息' : hasNotifications ? unreadLabel : '系统提醒、功能上线与活动消息'}
                        </p>
                    </div>

                    {hasNotifications ? (
                        <div className="-mr-3 flex items-center">
                            {!selectMode ? (
                                <button type="button" onClick={handleMarkAllRead} disabled={isProcessing || unreadCount === 0} className={QUIET_BUTTON_CLASS}>
                                    {isProcessing ? <SoundWaveLoader variant="inline" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
                                    全部已读
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={toggleSelectMode}
                                aria-pressed={selectMode}
                                className={`${QUIET_BUTTON_CLASS} aria-pressed:text-accent`}
                            >
                                {selectMode ? '完成' : '选择'}
                            </button>
                        </div>
                    ) : null}
                </header>

                {hasNotifications ? (
                    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
                        <SegmentedControl
                            label="阅读状态"
                            options={READ_FILTER_OPTIONS.map(option => (option.value === 'unread' ? { ...option, badge: unreadCount } : option))}
                            value={filters.read}
                            onChange={(read) => updateFilters({ read })}
                        />
                        <SegmentedControl
                            label="通知类型"
                            options={TYPE_FILTER_OPTIONS}
                            value={filters.type}
                            onChange={(type) => updateFilters({ type })}
                        />
                    </div>
                ) : null}

                {isLoading ? (
                    <NotificationsSkeleton />
                ) : loadError ? (
                    <EmptyState>
                        <p role="alert" className="text-sm text-danger">{loadError}</p>
                        <button type="button" onClick={() => setReloadKey(key => key + 1)} className={`${OUTLINE_BUTTON_CLASS} mt-4`}>重试</button>
                    </EmptyState>
                ) : !hasNotifications ? (
                    <EmptyState icon>
                        <p className="font-display text-lg text-foreground">暂无通知</p>
                        <p className="mt-1.5 text-sm text-foreground-secondary">系统提醒和功能更新会出现在这里。</p>
                    </EmptyState>
                ) : visibleNotifications.length === 0 ? (
                    <EmptyState>
                        <p className="text-sm text-foreground-secondary">当前筛选下没有通知</p>
                    </EmptyState>
                ) : (
                    <div className="flex flex-col gap-6">
                        {groupedNotifications.map((group) => (
                            <section key={group.label} aria-label={group.label}>
                                <h2 className="mb-1 text-[13px] font-medium text-foreground-tertiary">{group.label}</h2>
                                {/* 行内留白与悬停底色向外延伸，文字与分隔线仍和标题左对齐。 */}
                                <ul className="-mx-3 flex flex-col md:-mx-4">
                                    {group.items.map((notification) => (
                                        <NotificationRow
                                            key={notification.id}
                                            notification={notification}
                                            selectMode={selectMode}
                                            selected={selectedIds.has(notification.id)}
                                            onToggleSelect={() => toggleSelect(notification.id)}
                                            onOpen={() => { void handleOpen(notification); }}
                                            onMarkRead={() => { void handleMarkRead(notification); }}
                                            onDelete={() => { void handleDeleteSingle(notification.id); }}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}

                {!isLoading && nextOffset != null ? (
                    <div className="flex justify-center">
                        <button type="button" onClick={() => { void loadMore(); }} disabled={loadingMore} className={OUTLINE_BUTTON_CLASS}>
                            {loadingMore ? <SoundWaveLoader variant="inline" /> : null}
                            加载更早的通知
                        </button>
                    </div>
                ) : null}
            </div>

            {selectMode && visibleNotifications.length > 0 ? (
                <div className="fixed inset-x-0 bottom-[calc(var(--sab,0px)+5.5rem)] z-40 flex justify-center px-4 lg:bottom-8">
                    <div role="toolbar" aria-label="批量操作" className="flex w-full max-w-xl items-center gap-2 rounded-[14px] border-[0.5px] border-border bg-surface py-2 pr-2 pl-4 shadow-[0_8px_28px_rgba(20,20,19,0.12)]">
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 accent-accent" />
                            全选
                        </label>
                        <span role="status" className="flex-1 truncate text-sm text-foreground-secondary">已选择 {selectedCount} 项</span>
                        <button type="button" onClick={handleMarkSelectedRead} disabled={isProcessing || selectedCount === 0} className="h-9 rounded-lg px-3 text-sm text-foreground transition-colors hover:bg-background-secondary disabled:opacity-40">
                            标为已读
                        </button>
                        <button type="button" onClick={() => setConfirmBatchDelete(true)} disabled={isProcessing || selectedCount === 0} className="h-9 rounded-lg px-3 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-40">
                            删除
                        </button>
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
        </div>
    );
}
