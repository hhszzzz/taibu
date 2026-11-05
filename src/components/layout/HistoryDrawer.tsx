/**
 * 通用历史记录抽屉组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect, useCallback)
 * - 使用 useRouter 进行客户端导航
 */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { History, ChevronLeft, Calendar, X } from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { HISTORY_SUMMARY_DELETED_EVENT } from '@/lib/browser-api';
import { applyHistoryRestorePayload, loadHistoryRestore } from '@/lib/history/client';
import { useHistoryList } from '@/components/history/useHistoryList';
import { formatHistoryDateShort } from '@/lib/history/summary-display';
import {
    HISTORY_CONFIG,
    type HistoryType,
} from '@/lib/history/registry';

interface HistoryDrawerProps {
    type: HistoryType;
    className?: string;
}

const HISTORY_DRAWER_BATCH_SIZE = 10;
/** 面板宽度 320px（20rem）。 */
const PANEL_WIDTH = 320;

export function HistoryDrawer({ type, className = '' }: HistoryDrawerProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const { user, loading: sessionLoading } = useSessionSafe();
    const [isOpen, setIsOpen] = useState(false);
    const reportLoadError = useCallback((message: string) => showToast('error', message), [showToast]);
    const {
        items, loading, loadingMore, hasMore, nextOffset, appendError, errorMessage,
        loadItems: loadHistory, removeHistoryItem, setErrorMessage, captureScope,
    } = useHistoryList({ type, userId: user?.id, enabled: isOpen && !sessionLoading, batchSize: HISTORY_DRAWER_BATCH_SIZE, onError: reportLoadError });
    const [navigating, setNavigating] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const restoreRequestId = useRef(0);
    const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

    const config = HISTORY_CONFIG[type];

    const handleToggle = useCallback(() => setIsOpen(open => !open), []);

    const [prevResetKey, setPrevResetKey] = useState({ isOpen, type, userId: user?.id });
    if (prevResetKey.isOpen !== isOpen || prevResetKey.type !== type || prevResetKey.userId !== user?.id) {
        setPrevResetKey({ isOpen, type, userId: user?.id });
        setNavigating(null);
    }

    useEffect(() => {
        if (
            !isOpen
            || loading
            || loadingMore
            || !!appendError
            || !hasMore
            || nextOffset == null
            || !scrollContainerRef.current
            || !loadMoreSentinelRef.current
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadHistory({ append: true, offset: nextOffset });
            }
        }, {
            root: scrollContainerRef.current,
            rootMargin: '120px 0px',
        });

        observer.observe(loadMoreSentinelRef.current);
        return () => observer.disconnect();
    }, [appendError, hasMore, isOpen, loadHistory, loading, loadingMore, nextOffset]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleHistorySummaryDeleted = (event: Event) => {
            const detail = (event as CustomEvent<{ type?: string | null; id?: string | null }>).detail;
            if (detail?.type !== type || !detail.id) {
                return;
            }
            removeHistoryItem(detail.id);
        };

        window.addEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
        return () => {
            window.removeEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
        };
    }, [removeHistoryItem, type]);

    // 点击查看历史记录详情
    const handleViewItem = useCallback(async (itemId: string) => {
        const scope = captureScope(itemId);
        if (!scope) return;
        const requestId = ++restoreRequestId.current;
        const isCurrent = () => scope.isCurrent() && restoreRequestId.current === requestId;
        setNavigating(itemId);

        try {
            const payload = await loadHistoryRestore(type, itemId, defaultTimeZone, { signal: scope.signal });
            if (!isCurrent()) return;
            if (!payload) {
                throw new Error('未找到历史记录');
            }

            setErrorMessage(null);
            setIsOpen(false);
            router.push(applyHistoryRestorePayload(payload));
        } catch (err) {
            if (!isCurrent()) return;
            const message = err instanceof Error ? err.message : '加载历史记录失败';
            setErrorMessage(message);
            showToast('error', message);
        } finally {
            if (isCurrent()) setNavigating(null);
        }
    }, [captureScope, defaultTimeZone, router, setErrorMessage, showToast, type]);

    if (sessionLoading || !user?.id) return null;

    return (
        <>
            {/* 遮罩层 - 仅展开时显示 */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* 
                主容器
                固定在右侧，手机端避开顶部和底部导航栏
                通过 translateX 控制显示/隐藏
            */}
            <div
                className={`
                    fixed top-15 bottom-15 md:top-1/2 md:bottom-auto md:-translate-y-1/2 right-0 z-50
                    flex items-center
                    transition-transform duration-300 ease-out
                    ${className}
                `}
                style={{
                    transform: isOpen ? 'translateX(0)' : `translateX(${PANEL_WIDTH}px)`,
                    filter: 'drop-shadow(-4px 0 8px var(--shadow-color))'
                }}
            >
                {/* 
                   把手部分 (白色/背景色)
                   使用 SVG 实现带边框的反向圆角，以适应白色背景
                */}
                <div className="group relative flex flex-col items-end z-20 cursor-pointer" onClick={handleToggle}>
                    {/* 上方反向圆角 */}
                    <svg width="16" height="16" className="relative -mb-[1px] z-30 pointer-events-none">
                        {/* 填充：右下角区域，左上为凹弧 */}
                        <path d="M 16 0 L 16 16 L 0 16 A 16 16 0 0 0 16 0 Z" className="fill-background" />
                        {/* 描边：仅描绘弧线部分 */}
                        <path d="M 0 16 A 16 16 0 0 0 16 0" className="stroke-border fill-none" strokeWidth="1" />
                    </svg>

                    {/* 按钮主体 */}
                    <Button unstyled
                        className={`
                            relative
                            flex items-center justify-center
                            w-10 h-16
                            bg-background
                            rounded-l-md
                            transition-colors duration-150
                            border-y border-l border-border
                            border-r-0
                            -mr-[1px]
                            shadow-sm
                        `}
                        title={isOpen ? "收起" : "历史记录"}
                    >
                        <div className="transition-all duration-150 text-accent">
                            {isOpen ? (
                                <X className="w-5 h-5" />
                            ) : (
                                <History className="w-5 h-5" />
                            )}
                        </div>
                    </Button>

                    {/* 下方反向圆角 */}
                    <svg width="16" height="16" className="relative -mt-[1px] z-30 pointer-events-none">
                        {/* 填充：右上角区域，左下为凹弧 */}
                        <path d="M 16 16 L 16 0 L 0 0 A 16 16 0 0 1 16 16 Z" className="fill-background" />
                        {/* 描边：仅描绘弧线部分 */}
                        <path d="M 0 0 A 16 16 0 0 1 16 16" className="stroke-border fill-none" strokeWidth="1" />
                    </svg>
                </div>

                {/* 
                    内容面板 
                    手机端使用 h-full 自适应，桌面端使用固定高度
                */}
                <div
                    className="h-full md:h-[90vh] bg-background border-y border-l border-border rounded-l-lg shadow-md flex flex-col overflow-hidden relative text-foreground"
                    style={{
                        width: PANEL_WIDTH,
                        marginLeft: '-1px' // 消除缝隙
                    }}
                >
                    {/* 头部 */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-background/80 backdrop-blur-sm">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-sm uppercase tracking-wider text-foreground-secondary">{config.label}</span>
                            <span className="px-2 py-0.5 rounded-md bg-background-secondary text-foreground text-[10px] font-bold">
                                {items.length}
                            </span>
                        </div>
                        <Link
                            href={config.historyPath}
                            className="text-[11px] font-bold text-accent hover:underline transition-colors flex items-center gap-1"
                        >
                            全部
                            <ChevronLeft className="w-3 h-3 rotate-180" />
                        </Link>
                    </div>

                    {/* 列表 */}
                    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3">
                        {loading ? (
                            <div className="space-y-2">
                                {/* 骨架屏 - 模拟历史记录项 */}
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="p-3 rounded-md bg-background border border-border/60 animate-pulse">
                                        <div className="h-4 w-3/4 rounded bg-background-secondary mb-2" />
                                        <div className="h-3 w-1/2 rounded bg-background-secondary" />
                                    </div>
                                ))}
                            </div>
                        ) : errorMessage && items.length === 0 ? (
                            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 text-center text-sm text-danger">
                                <span>{errorMessage}</span>
                                <Button size="xs" onClick={() => { void loadHistory(); }}>重试</Button>
                            </div>
                        ) : items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-foreground-secondary gap-3">
                                <History className="w-8 h-8 opacity-20" />
                                <span className="text-xs font-medium">暂无历史记录</span>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {errorMessage && (
                                    <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                                        {errorMessage}
                                    </div>
                                )}
                                {items.map(item => (
                                    <div
                                        key={item.id}
                                        className={`group/item relative p-3 rounded-md bg-background border border-border/60 hover:bg-background-secondary active:bg-background-tertiary transition-all duration-150 cursor-pointer overflow-hidden shadow-sm ${navigating === item.id ? 'opacity-60' : ''}`}
                                        onClick={() => !navigating && handleViewItem(item.id)}
                                    >
                                        {/* 加载指示器 */}
                                        {navigating === item.id && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-20">
                                                <SoundWaveLoader variant="inline" />
                                            </div>
                                        )}
                                        <div className="flex items-start gap-3 relative z-10">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-bold text-foreground truncate flex items-center gap-1.5">
                                                    <span className="truncate">{item.title}</span>
                                                    {item.changedTitle && (
                                                        <>
                                                            <span className="text-[10px] text-foreground-secondary font-normal">变</span>
                                                            <span className="truncate font-medium">{item.changedTitle}</span>
                                                        </>
                                                    )}
                                                    {item.subType && (
                                                        <span className={`
                                                            text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-tight
                                                            ${item.subType === '情侣' ? 'bg-fire-soft text-fire' :
                                                                item.subType === '商业' ? 'bg-water-soft text-water' :
                                                                    item.subType === '亲子' ? 'bg-earth-soft text-earth' :
                                                                        'bg-background-secondary text-foreground-secondary'}
                                                        `}>
                                                            {item.subType}
                                                        </span>
                                                    )}
                                                </h4>
                                                {/* 问题显示在标题下方 */}
                                                {item.question && (
                                                    <p className="text-[11px] text-foreground-secondary truncate mt-0.5 font-medium">
                                                        {item.question}
                                                    </p>
                                                )}
                                                <div className="flex items-center gap-2 mt-2">
                                                    <span className="text-[10px] text-foreground-secondary font-bold flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        {formatHistoryDateShort(item.createdAt)}
                                                    </span>
                                                    {item.modelName && (
                                                        <span className="text-[10px] text-foreground-secondary font-bold border-l border-border pl-2">
                                                            {item.modelName}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {hasMore && (
                                    <div ref={loadMoreSentinelRef} className="py-3 flex justify-center">
                                        {loadingMore ? (
                                            <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                                                <SoundWaveLoader variant="inline" />
                                            </div>
                                        ) : appendError ? (
                                            <Button variant="secondary" size="xs" onClick={() => { void loadHistory({ append: true, offset: nextOffset ?? 0 }); }}>
                                                重试加载更多
                                            </Button>
                                        ) : (
                                            <div className="text-xs text-foreground-secondary">
                                                继续下滑加载更多
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 底部渐变遮罩 (提示可滚动) */}
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                </div>
            </div>
        </>
    );
}
