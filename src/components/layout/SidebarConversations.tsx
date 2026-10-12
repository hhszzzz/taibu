/**
 * 侧边栏对话列表（内嵌在 Chat 项下方）
 *
 * 直接渲染在 AI > Chat 导航项下方，与导航共用滚动区域。
 * 初始仅显示少量对话，向下滚动后按需继续加载。
 * 对话页侧栏使用 `grouping="date"`：按日期分组并显示 Agent 任务标记，搜索交给全局搜索。
 *
 * 'use client' 标记说明：
 * - 使用 React hooks 和交互状态
 */
'use client';

import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
    Search, X,
} from 'lucide-react';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { ConversationListItem, ConversationSourceType } from '@/types';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { AddToKnowledgeBaseModal } from '@/components/knowledge-base/AddToKnowledgeBaseModal';
import { ConversationGroup } from '@/components/chat/sidebar/ConversationGroup';
import { SOURCE_TYPE_CONFIG, SOURCE_TYPE_ORDER } from '@/lib/chat/conversation-groups';
import { resolveConversationRemainingTargetCount } from '@/lib/chat/conversation-list-window';
import { ConversationActions } from '@/components/chat/sidebar/ConversationActions';
import { ConversationMarker, ConversationNavItem } from '@/components/chat/sidebar/ConversationNavItem';
import { CONVERSATION_DATE_GROUP_LABELS, groupConversationsByDate } from '@/lib/chat/conversation-dates';
import type { ConversationAgentMarker } from '@/lib/agent/activity';

interface SidebarConversationsProps {
    /** `date`: 今天 / 昨天 / 7 天内 … groups with task markers (chat sidebar); `source`: grouped by divination type. */
    grouping?: 'source' | 'date';
    markers?: ReadonlyMap<string, ConversationAgentMarker>;
    /** Inside a modal drawer the row menu renders in the dialog's top layer. */
    withinModal?: boolean;
}

/** Local midnight of today; changes once a day so the date groups roll over. */
function subscribeToDayChange(onChange: () => void) {
    let timer: number | undefined;
    const schedule = () => {
        const now = new Date();
        const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
        timer = window.setTimeout(() => { onChange(); schedule(); }, nextDay - now.getTime() + 1000);
    };
    schedule();
    return () => window.clearTimeout(timer);
}
function getLocalDayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
const getServerDayStart = () => 0;
const subscribeToNothing = () => () => {};

export function SidebarConversations({ grouping = 'source', markers, withinModal = false }: SidebarConversationsProps = {}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const {
        conversations,
        conversationsLoading,
        loadingMoreConversations,
        hasLoadedConversations,
        hasMoreConversations,
        conversationListError,
        pendingSidebarTitle,
        retryConversationListLoad,
        handleDeleteConversation,
        handleRenameConversation,
        triggerConversationListLoad,
        loadMoreConversations,
    } = useConversationList();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();

    const [isSearching, setIsSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<ConversationSourceType>>(new Set());
    const [actionConv, setActionConv] = useState<ConversationListItem | null>(null);
    const [actionView, setActionView] = useState<'menu' | 'rename' | 'delete'>('menu');
    const actionAnchorRef = useRef<HTMLElement>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [archiveTarget, setArchiveTarget] = useState<ConversationListItem | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [sidebarTargetCount, setSidebarTargetCount] = useState<number | null>(null);
    const [hasUserScrolled, setHasUserScrolled] = useState(false);
    const listViewportRef = useRef<HTMLDivElement | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    // Determine active conversation from URL search params
    const activeId = useMemo(() => {
        if (!pathname?.startsWith('/chat')) return undefined;
        return searchParams.get('id') ?? undefined;
    }, [pathname, searchParams]);

    const byDate = grouping === 'date';
    const dayStart = useSyncExternalStore(byDate ? subscribeToDayChange : subscribeToNothing, getLocalDayStart, getServerDayStart);
    const dateGroups = useMemo(() => byDate ? groupConversationsByDate(conversations, new Date(dayStart)) : [], [byDate, conversations, dayStart]);

    const groupedConversations = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        const filtered = query
            ? conversations.filter(conv => (conv.title ?? '').toLowerCase().includes(query))
            : conversations;

        const groups: Record<ConversationSourceType, ConversationListItem[]> = {
            chat: [], dream: [], bazi_wuxing: [], bazi_personality: [],
            tarot: [], liuyao: [], ziwei: [], mbti: [], hepan: [],
            palm: [], face: [], qimen: [], daliuren: [],
            meihua: [], xiaoliuren: [],
        };

        filtered.forEach(conv => {
            let type = conv.sourceType || 'chat';
            if (type === 'bazi_personality') {
                type = 'bazi_wuxing';
            }
            if (groups[type]) {
                groups[type].push(conv);
            } else {
                groups.chat.push(conv);
            }
        });

        return groups;
    }, [conversations, searchQuery]);

    const toggleGroup = useCallback((type: ConversationSourceType) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });
    }, []);

    const handleSelect = useCallback((id: string) => {
        router.push(`/chat?id=${id}`);
    }, [router]);

    // Action menu helpers
    const closeActionSheet = useCallback(() => {
        setActionConv(null);
        setActionView('menu');
    }, []);

    const openActionSheet = useCallback((conv: ConversationListItem, e: React.MouseEvent) => {
        actionAnchorRef.current = e.currentTarget as HTMLElement;
        setActionConv(conv);
        setActionView('menu');
    }, []);

    const startInlineRename = useCallback(() => {
        if (!actionConv || actionConv.sourceType !== 'chat') return;
        setEditingId(actionConv.id);
        setEditTitle(actionConv.title);
        closeActionSheet();
    }, [actionConv, closeActionSheet]);

    const saveRename = useCallback(() => {
        if (editingId && editTitle.trim()) {
            handleRenameConversation(editingId, editTitle.trim());
            setEditingId(null);
            setEditTitle('');
        }
    }, [editingId, editTitle, handleRenameConversation]);

    const cancelRename = useCallback(() => {
        setEditingId(null);
        setEditTitle('');
    }, []);

    const confirmDelete = useCallback(() => {
        if (!actionConv) return Promise.resolve();

        setDeleteLoading(true);
        return handleDeleteConversation(actionConv.id).finally(() => {
            setDeleteLoading(false);
            closeActionSheet();
        });
    }, [actionConv, closeActionSheet, handleDeleteConversation]);

    const openArchive = useCallback(() => {
        if (!actionConv) return;
        setArchiveTarget(actionConv);
        closeActionSheet();
    }, [actionConv, closeActionSheet]);

    const getScrollContainer = useCallback(() => {
        const listViewport = listViewportRef.current;
        if (!listViewport) {
            return null;
        }

        const scrollContainer = listViewport.closest('[data-conversation-scroll]') ?? listViewport.closest('nav');
        if (!(scrollContainer instanceof HTMLElement)) {
            return null;
        }

        return scrollContainer;
    }, []);

    const getSidebarConversationTargetCount = useCallback(() => {
        const listViewport = listViewportRef.current;
        if (!listViewport) {
            return null;
        }

        const scrollContainer = getScrollContainer();
        if (!scrollContainer) {
            return null;
        }

        const scrollRect = scrollContainer.getBoundingClientRect();
        const listRect = listViewport.getBoundingClientRect();
        const listItem = listViewport.closest('li');
        let reservedBottomHeight = 0;

        if (listItem instanceof HTMLElement) {
            let sibling = listItem.nextElementSibling;
            while (sibling instanceof HTMLElement) {
                reservedBottomHeight += sibling.getBoundingClientRect().height;
                sibling = sibling.nextElementSibling;
            }
        }

        const visibleTop = Math.max(listRect.top, scrollRect.top);
        const availableHeight = Math.max(scrollRect.bottom - visibleTop - reservedBottomHeight, 0);
        const rowElements = Array.from(
            listViewport.querySelectorAll<HTMLElement>('[data-conversation-row="true"]'),
        );

        if (availableHeight <= 0 || rowElements.length === 0) {
            return null;
        }

        return resolveConversationRemainingTargetCount({
            loadedCount: conversations.length,
            availableHeight,
            contentHeight: listViewport.getBoundingClientRect().height,
            rowHeights: rowElements.map((element) => element.getBoundingClientRect().height),
        });
    }, [conversations.length, getScrollContainer]);

    const shouldAutoTopUp = !isSearching && searchQuery.trim().length === 0 && collapsedGroups.size === 0;

    useEffect(() => {
        if (typeof window === 'undefined' || !shouldAutoTopUp) {
            return;
        }

        const updateTargetCount = () => {
            const nextTargetCount = getSidebarConversationTargetCount();
            setSidebarTargetCount((current) => (current === nextTargetCount ? current : nextTargetCount));
        };

        updateTargetCount();

        const handleResize = () => {
            updateTargetCount();
        };

        window.addEventListener('resize', handleResize);

        if (typeof ResizeObserver === 'undefined') {
            return () => {
                window.removeEventListener('resize', handleResize);
            };
        }

        const observer = new ResizeObserver(() => {
            updateTargetCount();
        });

        if (listViewportRef.current) {
            observer.observe(listViewportRef.current);
        }
        const scrollContainer = getScrollContainer();
        if (scrollContainer) {
            observer.observe(scrollContainer);
        }

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [getScrollContainer, getSidebarConversationTargetCount, shouldAutoTopUp]);

    useEffect(() => {
        if (!hasLoadedConversations || !shouldAutoTopUp || sidebarTargetCount == null) {
            return;
        }

        triggerConversationListLoad(sidebarTargetCount);
    }, [hasLoadedConversations, shouldAutoTopUp, sidebarTargetCount, triggerConversationListLoad]);

    useEffect(() => {
        const scrollContainer = getScrollContainer();
        if (!scrollContainer) {
            return;
        }

        const handleScroll = () => {
            setHasUserScrolled(scrollContainer.scrollTop > 0);
        };

        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            scrollContainer.removeEventListener('scroll', handleScroll);
        };
    }, [getScrollContainer]);

    useEffect(() => {
        const scrollContainer = getScrollContainer();
        if (
            !hasLoadedConversations
            || !hasUserScrolled
            || !hasMoreConversations
            || loadingMoreConversations
            || !loadMoreSentinelRef.current
            || !scrollContainer
        ) {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                void loadMoreConversations();
            }
        }, {
            root: scrollContainer,
            rootMargin: '120px 0px',
        });

        observer.observe(loadMoreSentinelRef.current);
        return () => observer.disconnect();
    }, [
        hasLoadedConversations,
        hasUserScrolled,
        hasMoreConversations,
        getScrollContainer,
        loadMoreConversations,
        loadingMoreConversations,
    ]);

    return (
        <>
            {/* 对话区域 — 紧凑内嵌在 Chat 项下方 */}
            <div className={byDate ? undefined : 'mt-1'}>
                {/* 搜索区域 — 符合 Notion 风格，搜索时替换按钮；对话页侧栏改用全局搜索 */}
                {!byDate && <div className="mb-1">
                    {isSearching ? (
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="搜索聊天..."
                                className="w-full pl-8 pr-8 py-1.5 text-[14px] rounded-md bg-background border border-border text-foreground placeholder:text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent/10 focus:border-accent transition-all duration-200"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => {
                                    if (!searchQuery) setIsSearching(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setIsSearching(false);
                                        setSearchQuery('');
                                    }
                                }}
                            />
                            <Search className="absolute left-3 w-4 h-4 text-foreground-secondary" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsSearching(false);
                                    setSearchQuery('');
                                }}
                                className="absolute right-2 p-0.5 rounded hover:bg-background-tertiary text-foreground-secondary hover:text-destructive transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsSearching(true);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md transition-colors duration-150 text-[14px] font-medium text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
                        >
                            <Search className="w-4.5 h-4.5 flex-shrink-0" />
                            <span className="truncate">搜索聊天</span>
                        </button>
                    )}
                </div>}

                {/* 分组对话列表 */}
                <div ref={listViewportRef} className={byDate ? 'chat-nav-conversations' : 'relative space-y-0.5'}>
                    {conversationListError && !hasLoadedConversations && !conversationsLoading ? (
                        <div className="rounded-md border border-[#ead9bf] bg-[#fcf8ee] px-3 py-3 text-xs text-[#946c21]">
                            <div>{conversationListError}</div>
                            <button
                                type="button"
                                onClick={() => { void retryConversationListLoad(); }}
                                className="mt-2 rounded-md px-2 py-1 font-medium text-[#7c5f1c] transition-colors hover:bg-[#f4ead3]"
                            >
                                重试
                            </button>
                        </div>
                    ) : !hasLoadedConversations || conversationsLoading ? (
                        <div className="flex flex-col items-center justify-center text-foreground-secondary text-xs py-3 gap-1">
                            {hasLoadedConversations ? (
                                <>
                                    <SoundWaveLoader variant="inline" />
                                </>
                            ) : (
                                <div className="w-full space-y-1">
                                    <div className="h-5 rounded bg-background-secondary animate-pulse" />
                                    <div className="h-5 rounded bg-background-secondary animate-pulse" />
                                    <div className="h-5 rounded bg-background-secondary animate-pulse" />
                                </div>
                            )}
                        </div>
                    ) : conversations.length === 0 && !pendingSidebarTitle ? (
                        <div className="text-center text-foreground-secondary text-[11px] py-3">
                            暂无对话
                        </div>
                    ) : (
                        <>
                            {conversationListError ? (
                                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-[#ead9bf] bg-[#fcf8ee] px-3 py-2 text-xs text-[#946c21]">
                                    <span className="min-w-0 flex-1">{conversationListError}</span>
                                    <button
                                        type="button"
                                        onClick={() => { void retryConversationListLoad(); }}
                                        className="shrink-0 rounded-md px-2 py-1 font-medium text-[#7c5f1c] transition-colors hover:bg-[#f4ead3]"
                                    >
                                        重试
                                    </button>
                                </div>
                            ) : null}
                            {byDate ? (pendingSidebarTitle && dateGroups[0]?.key !== 'today'
                                ? [{ key: 'today' as const, label: CONVERSATION_DATE_GROUP_LABELS.today, items: [] }, ...dateGroups]
                                : dateGroups).map(group => (
                                <section key={group.key} className="chat-nav-group" aria-labelledby={`chat-nav-group-${group.key}`}>
                                    <h3 id={`chat-nav-group-${group.key}`} className="chat-nav-group-label">{group.label}</h3>
                                    {group.key === 'today' && pendingSidebarTitle ? (
                                        <div data-conversation-row="true" className="chat-nav-row" data-pending="true">
                                            <span className="chat-nav-row-link">
                                                <span className="chat-nav-row-title">{pendingSidebarTitle}</span>
                                                <ConversationMarker marker="running" />
                                            </span>
                                        </div>
                                    ) : null}
                                    {group.items.map(conv => (
                                        <ConversationNavItem
                                            key={conv.id}
                                            conv={conv}
                                            isActive={activeId === conv.id}
                                            isActionActive={actionConv?.id === conv.id}
                                            marker={markers?.get(conv.id)}
                                            onOpenAction={openActionSheet}
                                            isEditing={editingId === conv.id}
                                            editTitle={editingId === conv.id ? editTitle : ''}
                                            onEditTitleChange={editingId === conv.id ? setEditTitle : undefined}
                                            onSaveRename={editingId === conv.id ? saveRename : undefined}
                                            onCancelRename={editingId === conv.id ? cancelRename : undefined}
                                        />
                                    ))}
                                </section>
                            )) : SOURCE_TYPE_ORDER.map(type => {
                                const allItems = groupedConversations[type];
                                const showPendingInGroup = type === 'chat' && !!pendingSidebarTitle;
                                if (allItems.length === 0 && !showPendingInGroup) return null;

                                const config = SOURCE_TYPE_CONFIG[type];
                                const isGroupCollapsed = collapsedGroups.has(type);

                                return (
                                    <div key={type}>
                                        <ConversationGroup
                                            type={type}
                                            label={config.label}
                                            items={allItems}
                                            showLabel={type !== 'chat'}
                                            isGroupCollapsed={isGroupCollapsed}
                                            onToggleGroup={toggleGroup}
                                            activeId={activeId}
                                            actionConvId={actionConv?.id}
                                            isSidebarCollapsed={false}
                                            onSelect={handleSelect}
                                            onOpenAction={openActionSheet}
                                            editingId={editingId}
                                            editTitle={editTitle}
                                            onEditTitleChange={setEditTitle}
                                            onSaveRename={saveRename}
                                            onCancelRename={cancelRename}
                                            pendingTitle={pendingSidebarTitle}
                                            showPendingInGroup={showPendingInGroup}
                                            compact
                                        />
                                    </div>
                                );
                            })}
                        </>
                    )}
                    {hasLoadedConversations && hasMoreConversations && (
                        <div ref={loadMoreSentinelRef} className="py-2">
                            {loadingMoreConversations ? (
                                <div className="flex items-center justify-center gap-2 text-[10px] text-foreground-secondary">
                                    <SoundWaveLoader variant="inline" />
                                </div>
                            ) : (
                                <div className="text-center text-[10px] text-foreground-secondary">
                                    下滑加载更多
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <ConversationActions conversation={actionConv} anchorRef={actionAnchorRef} view={actionView} onViewChange={setActionView} onClose={closeActionSheet} onRename={startInlineRename} onArchive={openArchive} onDelete={confirmDelete} deleting={deleteLoading} knowledgeBaseEnabled={knowledgeBaseEnabled} withinModal={withinModal} />

            {/* Knowledge base archive modal */}
            {knowledgeBaseEnabled && archiveTarget && (
                <AddToKnowledgeBaseModal
                    open={true}
                    onClose={() => setArchiveTarget(null)}
                    sourceTitle={archiveTarget.title}
                    sourceType="conversation"
                    sourceId={archiveTarget.id}
                />
            )}
        </>
    );
}
