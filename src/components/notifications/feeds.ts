'use client';

/**
 * 铃铛面板与通知页的分页数据：首屏一页，滚到底再取下一页。
 * 追加失败只提示并停止追加，不清掉已加载的内容；重新加载换代，旧请求的结果直接丢弃。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { requestBrowserJson } from '@/lib/browser-api';
import { getAnnouncementPromptIdentity, type Announcement } from '@/lib/announcement';
import { getNotificationsPage, type Notification } from '@/lib/notification';
import { useAnnouncementCenterSafe } from '@/components/providers/AnnouncementPopupHost';
import { useToast } from '@/components/ui/Toast';

const PAGE_SIZE = 20;

type Page<T> = { items: T[]; nextOffset: number | null };

type FeedState<T> = Page<T> & { loading: boolean; loadingMore: boolean; error: string | null };

export async function fetchAnnouncementPage(offset: number, limit = PAGE_SIZE): Promise<Page<Announcement>> {
    const result = await requestBrowserJson<{
        announcements?: Announcement[];
        pagination?: { hasMore?: boolean; nextOffset?: number | null };
    }>(`/api/announcements?limit=${limit}&offset=${offset}`, { method: 'GET' });
    if (result.error) throw new Error(result.error.message || '获取公告失败');
    const pagination = result.data?.pagination ?? {};
    return {
        items: result.data?.announcements ?? [],
        nextOffset: pagination.hasMore === true && typeof pagination.nextOffset === 'number' ? pagination.nextOffset : null,
    };
}

async function fetchNotificationPage(offset: number): Promise<Page<Notification>> {
    const page = await getNotificationsPage({ limit: PAGE_SIZE, offset });
    return { items: page.notifications, nextOffset: page.pagination.hasMore ? page.pagination.nextOffset : null };
}

function usePagedFeed<T extends { id: string }>(enabled: boolean, fetchPage: (offset: number) => Promise<Page<T>>, fallbackMessage: string) {
    const { showToast } = useToast();
    const [state, setState] = useState<FeedState<T>>({ items: [], nextOffset: null, loading: true, loadingMore: false, error: null });
    const [reloadKey, setReloadKey] = useState(0);
    const generation = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        const id = ++generation.current;
        void Promise.resolve().then(() => {
            if (generation.current !== id) return;
            setState(current => ({ ...current, loading: true, error: null }));
            return fetchPage(0).then(page => {
                if (generation.current === id) setState({ ...page, loading: false, loadingMore: false, error: null });
            }, (error: unknown) => {
                if (generation.current === id) setState({ items: [], nextOffset: null, loading: false, loadingMore: false, error: error instanceof Error ? error.message : fallbackMessage });
            });
        });
        return () => { generation.current += 1; };
    }, [enabled, fallbackMessage, fetchPage, reloadKey]);

    const loadMore = useCallback(() => {
        if (state.loading || state.loadingMore || state.nextOffset == null) return;
        const id = generation.current;
        const offset = state.nextOffset;
        setState(current => ({ ...current, loadingMore: true }));
        fetchPage(offset).then(page => {
            if (generation.current !== id) return;
            setState(current => {
                const seen = new Set(current.items.map(item => item.id));
                return { ...current, items: [...current.items, ...page.items.filter(item => !seen.has(item.id))], nextOffset: page.nextOffset, loadingMore: false };
            });
        }, (error: unknown) => {
            if (generation.current !== id) return;
            setState(current => ({ ...current, nextOffset: null, loadingMore: false }));
            showToast('error', error instanceof Error ? error.message : fallbackMessage);
        });
    }, [fallbackMessage, fetchPage, showToast, state.loading, state.loadingMore, state.nextOffset]);

    const update = useCallback((change: (items: T[]) => T[]) => setState(current => ({ ...current, items: change(current.items) })), []);
    const reload = useCallback(() => setReloadKey(key => key + 1), []);
    return { ...state, loadMore, update, reload };
}

export function useAnnouncementFeed(enabled: boolean) {
    return usePagedFeed(enabled, fetchAnnouncementPage, '获取公告失败');
}

export function useNotificationFeed(enabled: boolean) {
    return usePagedFeed(enabled, fetchNotificationPage, '获取通知失败');
}

/** 列表底部的哨兵进入滚动容器可视区（提前 120px）时取下一页。 */
export function useLoadMoreSentinel(rootRef: RefObject<HTMLElement | null>, active: boolean, onLoadMore: () => void) {
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!active || !sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) onLoadMore();
        }, { root: rootRef.current, rootMargin: '120px 0px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [active, onLoadMore, rootRef]);
    return sentinelRef;
}

/** 列表展示出最新一条就记为已看；返回这次浏览里仍标「新」的公告身份，圆点留到列表关闭。 */
export function useMarkLatestAnnouncementSeen(latestShown: Announcement | undefined) {
    const { unseenAnnouncement, unseenAnnouncementKey, markAnnouncementSeen } = useAnnouncementCenterSafe();
    const [newKey, setNewKey] = useState(unseenAnnouncementKey);
    if (unseenAnnouncementKey && unseenAnnouncementKey !== newKey) setNewKey(unseenAnnouncementKey);
    useEffect(() => {
        if (latestShown && unseenAnnouncement && getAnnouncementPromptIdentity(latestShown) === unseenAnnouncementKey) markAnnouncementSeen(unseenAnnouncement);
    }, [latestShown, markAnnouncementSeen, unseenAnnouncement, unseenAnnouncementKey]);
    return newKey;
}
