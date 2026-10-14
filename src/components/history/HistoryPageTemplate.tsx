/**
 * 历史页面通用模板
 *
 * 封装: loadHistorySummariesPage, deleteHistorySummary, 搜索过滤, 删除确认弹窗, KB 模态框
 * 各历史页面只需提供配置即可复用全部逻辑；卡片展示见 HistoryCards。
 *
 * 'use client' - 需要 useState/useEffect/useRouter
 */
'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Search, MessageSquare } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ConfirmDeleteModal } from '@/components/common/ConfirmDeleteModal';
import { useToast } from '@/components/ui/Toast';
import {
    DATA_INDEX_INVALIDATED_EVENT,
    HISTORY_SUMMARY_DELETED_EVENT,
    KNOWLEDGE_BASE_SYNC_EVENT,
} from '@/lib/browser-api';
import {
    applyHistoryRestorePayload,
    deleteHistorySummary,
    loadHistoryRestore,
} from '@/lib/history/client';
import { useHistoryList } from '@/components/history/useHistoryList';
import {
    HistoryGridCard,
    HistoryGridSkeleton,
    HistoryListRow,
    HistoryListSkeleton,
    type CardActions,
    type HistoryDetailRenderer,
} from '@/components/history/HistoryCards';
import { getNavItemById } from '@/lib/navigation/registry';
import { formatHistoryDate } from '@/lib/history/summary-display';
import type { HistorySummaryItem, HistoryType } from '@/lib/history/registry';

/* ---------- 类型定义 ---------- */
export type HistoryLayout = 'list' | 'grid';
export type { CardActions, HistoryDetailRenderer };

export interface HistoryPageConfig {
    /** 历史类型 key */
    sourceType: HistoryType;
    /** 页面标题 */
    title: string;
    /** 副标题 */
    subtitle?: string;
    /** 搜索框 placeholder */
    searchPlaceholder?: string;
    /** 空状态文案 */
    emptyMessage?: string;
    /** 空状态搜索无结果文案 */
    emptySearchMessage?: string;
    /** 开始新占测的按钮文案，标题右侧与空状态共用 */
    actionLabel?: string;
    /** 开始新占测的链接，默认是该占术首页 */
    actionHref?: string;
    /** 删除确认文案 */
    deleteMessage?: string;
    /** KB sourceType (默认与 sourceType 相同) */
    kbSourceType?: string;
    /** 布局模式 */
    layout?: HistoryLayout;
    /** 骨架屏数量 */
    skeletonCount?: number;
    /** 自定义搜索过滤 */
    filterFn?: (item: HistorySummaryItem, query: string) => boolean;
    /** 自定义 KB 标题 */
    kbTitleFn?: (item: HistorySummaryItem) => string;
    /** 覆盖默认卡片里的补充信息行（如塔罗的正逆位牌名） */
    renderDetail?: HistoryDetailRenderer;
    /** 完全自定义卡片；一般只需 renderDetail */
    renderCard?: (item: HistorySummaryItem, actions: CardActions) => ReactNode;
    /** loadHistoryRestore 的额外参数 (如 timezone) */
    restoreTimezone?: string;
    /** 数据变更时的 invalidate types */
    invalidateTypes?: string[];
}

const HISTORY_PAGE_BATCH_SIZE = 12;

function defaultHistoryFilter(item: HistorySummaryItem, query: string) {
    const q = query.toLowerCase();
    return [item.title, item.changedTitle, item.question, ...(item.badges || [])]
        .some(value => (value || '').toLowerCase().includes(q));
}

/* ---------- 主组件 ---------- */
export function HistoryPageTemplate(config: HistoryPageConfig) {
    const {
        sourceType, title, subtitle,
        searchPlaceholder = '搜索记录', emptyMessage = '暂无历史记录',
        emptySearchMessage = '未找到匹配的记录', actionLabel = '开始新的占测',
        actionHref, deleteMessage, kbSourceType, layout = 'grid',
        skeletonCount = layout === 'grid' ? 6 : 4,
        filterFn, kbTitleFn, renderDetail, renderCard, restoreTimezone, invalidateTypes,
    } = config;

    const router = useRouter();
    const { showToast } = useToast();
    const { user, loading: sessionLoading } = useSessionSafe();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const reportLoadError = useCallback((message: string) => showToast('error', message), [showToast]);
    const {
        items, loading, loadingMore, hasMore, nextOffset, appendError, errorMessage,
        loadItems, removeHistoryItem, setErrorMessage, captureScope,
    } = useHistoryList({ type: sourceType, userId: user?.id, enabled: !sessionLoading, batchSize: HISTORY_PAGE_BATCH_SIZE, onError: reportLoadError });
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [kbTarget, setKbTarget] = useState<HistorySummaryItem | null>(null);
    const [viewingId, setViewingId] = useState<string | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const restoreRequestId = useRef(0);
    const basePath = `/${sourceType}`;
    const resolvedKbSourceType = kbSourceType || `${sourceType}_reading`;
    const navItem = getNavItemById(sourceType);
    const resolvedActionHref = actionHref || navItem?.href || basePath;

    useLayoutEffect(() => {
        setDeleteConfirmId(null);
        setKbModalOpen(false);
        setKbTarget(null);
        setViewingId(null);
        setSearchQuery('');
    }, [sourceType, user?.id]);

    useEffect(() => {
        if (!sessionLoading && !user?.id) router.push(basePath);
    }, [basePath, router, sessionLoading, user?.id]);

    useEffect(() => {
        if (
            loading
            || loadingMore
            || !!appendError
            || !hasMore
            || nextOffset == null
            || !loadMoreSentinelRef.current
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadItems({ append: true, offset: nextOffset });
            }
        }, {
            rootMargin: '160px 0px',
        });

        observer.observe(loadMoreSentinelRef.current);
        return () => observer.disconnect();
    }, [appendError, hasMore, loadItems, loading, loadingMore, nextOffset]);

    const handleDelete = async (id: string) => {
        const scope = captureScope();
        if (!scope) return;
        try {
            await deleteHistorySummary(sourceType, id, { signal: scope.signal });
            if (!scope.isCurrent()) return;
            setErrorMessage(null);
            removeHistoryItem(id);
            if (invalidateTypes?.length) {
                window.dispatchEvent(new CustomEvent(DATA_INDEX_INVALIDATED_EVENT, { detail: { types: invalidateTypes } }));
            }
        } catch (error) {
            if (!scope.isCurrent()) return;
            const message = error instanceof Error ? error.message : '删除历史记录失败';
            setErrorMessage(message);
            showToast('error', message);
        } finally {
            if (scope.isCurrent()) setDeleteConfirmId(null);
        }
    };

    const handleView = async (item: HistorySummaryItem) => {
        const scope = captureScope(item.id);
        if (!scope) return;
        const requestId = ++restoreRequestId.current;
        const isCurrent = () => scope.isCurrent() && restoreRequestId.current === requestId;
        setViewingId(item.id);
        try {
            const payload = await loadHistoryRestore(sourceType, item.id, restoreTimezone, { signal: scope.signal });
            if (!isCurrent()) return;
            if (!payload) {
                throw new Error('未找到历史记录');
            }
            setErrorMessage(null);
            router.push(applyHistoryRestorePayload(payload));
        } catch (error) {
            if (!isCurrent()) return;
            const message = error instanceof Error ? error.message : '加载历史记录失败';
            setErrorMessage(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setViewingId(null);
        }
    };

    const trimmedQuery = searchQuery.trim();
    const filteredItems = useMemo(() => {
        if (!trimmedQuery) return items;
        return items.filter(item => (filterFn || defaultHistoryFilter)(item, trimmedQuery));
    }, [filterFn, items, trimmedQuery]);

    useEffect(() => {
        if (
            !trimmedQuery
            || loading
            || loadingMore
            || !!appendError
            || !hasMore
            || nextOffset == null
            || filteredItems.length > 0
        ) {
            return;
        }

        void loadItems({ append: true, offset: nextOffset });
    }, [appendError, filteredItems.length, hasMore, loadItems, loading, loadingMore, nextOffset, trimmedQuery]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleHistorySummaryDeleted = (event: Event) => {
            const detail = (event as CustomEvent<{ type?: string | null; id?: string | null }>).detail;
            if (detail?.type !== sourceType || !detail.id) {
                return;
            }
            removeHistoryItem(detail.id);
        };

        const handleArchiveChanged = (event: Event) => {
            const detail = (event as CustomEvent<{
                pathname?: string;
                requestBody?: Record<string, unknown> | null;
                responseData?: Record<string, unknown> | null;
            }>).detail;
            const pathname = detail?.pathname ?? '';
            const isArchiveMutation = pathname.startsWith('/api/knowledge-base/archive');
            const kbSourceType = detail?.pathname?.startsWith('/api/knowledge-base/ingest')
                ? detail.requestBody?.sourceType
                : detail?.responseData?.sourceType;
            if (!isArchiveMutation && kbSourceType !== resolvedKbSourceType) {
                return;
            }
            void loadItems();
        };

        window.addEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
        window.addEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        return () => {
            window.removeEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
            window.removeEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleArchiveChanged as EventListener);
        };
    }, [loadItems, removeHistoryItem, resolvedKbSourceType, sourceType]);

    const makeActions = (item: HistorySummaryItem): CardActions => ({
        onView: () => void handleView(item),
        onDelete: () => setDeleteConfirmId(item.id),
        onAddToKb: () => {
            if (!knowledgeBaseEnabled) return;
            setKbTarget(item);
            setKbModalOpen(true);
        },
        canAddToKnowledgeBase: knowledgeBaseEnabled,
        formatDate: formatHistoryDate,
    });

    const renderItem = (item: HistorySummaryItem) => {
        const actions = makeActions(item);
        if (renderCard) return renderCard(item, actions);
        const Card = layout === 'grid' ? HistoryGridCard : HistoryListRow;
        return <Card item={item} actions={actions} viewing={viewingId === item.id} renderDetail={renderDetail} />;
    };

    return (
        <div className="min-h-screen bg-background">
            <div className={`${layout === 'grid' ? 'max-w-[65rem]' : 'max-w-4xl'} mx-auto px-4 py-4 md:py-10`}>
                {/* 移动端顶栏已显示页面标题，这里只在桌面端显示面包屑和标题区。 */}
                <div className="hidden md:block">
                    <nav aria-label="面包屑" className="flex items-center gap-1.5 text-[13px] text-foreground-tertiary">
                        <Link href={navItem?.href || basePath} className="text-foreground-secondary hover:text-foreground">
                            {navItem?.label || title}
                        </Link>
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                        <span aria-current="page">历史记录</span>
                    </nav>
                    <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <h1 className="font-display text-[2.125rem] leading-tight font-normal text-foreground">{title}</h1>
                            {subtitle ? <p className="text-[15px] text-foreground-secondary">{subtitle}</p> : null}
                        </div>
                        <Link
                            href={resolvedActionHref}
                            className="inline-flex h-11 shrink-0 items-center rounded-[10px] bg-accent px-[18px] text-[15px] font-medium text-on-accent transition-colors hover:bg-accent/90"
                        >
                            {actionLabel}
                        </Link>
                    </header>
                </div>

                <label className="relative block md:mt-7">
                    <span className="sr-only">搜索历史记录</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-foreground-tertiary" aria-hidden="true" />
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface pr-3.5 pl-[42px] text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none"
                    />
                </label>

                {errorMessage && !loading && filteredItems.length > 0 && (
                    <div role="alert" className="mt-4 rounded-[10px] border-[0.5px] border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                        {errorMessage}
                    </div>
                )}

                <div className="mt-4 md:mt-5">
                    {loading ? (
                        layout === 'grid' ? <HistoryGridSkeleton count={skeletonCount} /> : <HistoryListSkeleton count={skeletonCount} />
                    ) : errorMessage && filteredItems.length === 0 ? (
                        <div role="alert" className="flex flex-col items-center justify-center gap-4 rounded-[14px] border-[0.5px] border-dashed border-danger/40 px-6 py-16 text-center">
                            <p className="text-sm text-danger">{errorMessage}</p>
                            <button
                                type="button"
                                onClick={() => { void loadItems(); }}
                                className="h-10 rounded-[10px] border-[0.5px] border-border-hover bg-surface px-5 text-sm text-foreground transition-colors hover:bg-background-secondary"
                            >
                                重试
                            </button>
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-[14px] border-[0.5px] border-dashed border-border-hover px-6 py-16 text-center">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-background-secondary">
                                <MessageSquare className="h-6 w-6 text-foreground-tertiary" aria-hidden="true" />
                            </div>
                            <p className="font-display text-lg text-foreground">{trimmedQuery ? emptySearchMessage : emptyMessage}</p>
                            {!trimmedQuery && (
                                <Link
                                    href={resolvedActionHref}
                                    className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90"
                                >
                                    {actionLabel}
                                </Link>
                            )}
                        </div>
                    ) : layout === 'grid' ? (
                        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-3 md:gap-4">
                            {filteredItems.map(item => <li key={item.id}>{renderItem(item)}</li>)}
                        </ul>
                    ) : (
                        <ul className={renderCard ? 'flex flex-col gap-3' : 'divide-y-[0.5px] divide-border overflow-hidden rounded-[14px] border-[0.5px] border-border bg-surface'}>
                            {filteredItems.map(item => <li key={item.id}>{renderItem(item)}</li>)}
                        </ul>
                    )}
                </div>

                {!loading && hasMore && (
                    <div ref={loadMoreSentinelRef} className="mt-6 flex justify-center py-4">
                        {loadingMore ? (
                            <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                                <SoundWaveLoader variant="inline" />
                            </div>
                        ) : appendError ? (
                            <button
                                type="button"
                                onClick={() => { void loadItems({ append: true, offset: nextOffset ?? 0 }); }}
                                className="h-10 rounded-[10px] border-[0.5px] border-border-hover px-4 text-sm text-foreground-secondary transition-colors hover:bg-background-secondary"
                            >
                                重试加载更多
                            </button>
                        ) : (
                            <div className="text-sm text-foreground-tertiary">
                                继续下滑加载更多
                            </div>
                        )}
                    </div>
                )}
            </div>

            <ConfirmDeleteModal open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}
                onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)} message={deleteMessage} />

            {knowledgeBaseEnabled && kbTarget && (
                <AddToKnowledgeBaseModal open={kbModalOpen}
                    onClose={() => { setKbModalOpen(false); setKbTarget(null); }}
                    sourceTitle={kbTitleFn ? kbTitleFn(kbTarget) : kbTarget.question || kbTarget.title}
                    sourceType={resolvedKbSourceType} sourceId={kbTarget.id} />
            )}
        </div>
    );
}
