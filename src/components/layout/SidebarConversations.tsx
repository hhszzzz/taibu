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

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Plus, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import type { ConversationListItem, ConversationSourceType } from '@/types';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { ConversationGroup } from '@/components/chat/sidebar/ConversationGroup';
import '@/components/chat/sidebar/chat-sidebar.css';
import { SOURCE_TYPE_CONFIG, SOURCE_TYPE_ORDER } from '@/lib/chat/conversation-groups';
import { resolveConversationRemainingTargetCount } from '@/lib/chat/conversation-list-window';
import { ConversationActions } from '@/components/chat/sidebar/ConversationActions';
import { ConversationMarker, ConversationNavItem } from '@/components/chat/sidebar/ConversationNavItem';
import { formatConversationMenuTitle } from '@/lib/chat/conversation-title-display';
import { loadPinnedConversations, togglePinnedConversation } from '@/lib/chat/pinned-conversations';
import { CONVERSATION_DISPLAY_LABELS, CONVERSATION_LIST_DEFAULTS, CONVERSATION_SORT_LABELS, saveConversationListPreferences, useConversationListPreferences } from '@/lib/chat/conversation-list-prefs';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { newChatHref, useCurrentChatMode } from '@/lib/chat/mode-control-store';
import type { ConversationAgentMarker } from '@/lib/agent/activity';

/** 「最近使用」组头 = claude Recents：24px 行，折叠箭头在名称右侧（悬停/聚焦显形），右侧是工具按钮。 */
export function RecentsHead({ userId, recentsOpen, onToggleRecents, onToggleBlocked }: { userId: string | null; recentsOpen: boolean; onToggleRecents: () => void; onToggleBlocked?: boolean }) {
    const router = useRouter();
    const { handleNewChat } = useConversationList();
    // 新建会话沿用当前对话方式：Agent 里点「新建」仍开 Agent。
    const currentMode = useCurrentChatMode(userId);
    const preferences = useConversationListPreferences(userId);
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLButtonElement>(null);
    const update = (patch: Partial<typeof preferences>) => saveConversationListPreferences(userId, { ...preferences, ...patch });
    const item = (label: string, checked: boolean, onClick: () => void) => (
        <button key={label} type="button" role="menuitemradio" aria-checked={checked} className="chat-recents-menu-item" onClick={onClick}>
            <span>{label}</span>{checked && <Check size={14} aria-hidden="true" />}
        </button>
    );
    return <>
        <div className="chat-recents-head">
            {/* claude 组头：名称本身就是折叠开关，箭头在名称左侧；右侧是「分组和排序」与「新建会话」。 */}
            <button type="button" className="chat-recents-toggle" aria-expanded={recentsOpen}
                title={onToggleBlocked ? '当前会话在列表中，先收起会隐藏它' : undefined}
                onClick={() => { if (onToggleBlocked) return; onToggleRecents(); }}>
                <span>最近使用</span>
                <span className="chat-recents-caret" aria-hidden="true">{recentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            </button>
            <div className="chat-recents-tools">
                <button ref={anchorRef} type="button" className="chat-recents-tool" aria-label="筛选和分组最近对话" title="分组和排序"
                    aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><SlidersHorizontal size={14} aria-hidden="true" /></button>
                <button type="button" className="chat-recents-tool" aria-label="新建会话" title="新建会话"
                    onClick={() => { void handleNewChat(); router.push(newChatHref(currentMode)); }}><Plus size={14} aria-hidden="true" /></button>
            </div>
        </div>
        <FloatingPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} label="筛选和分组最近对话" className="chat-recents-menu">
            <div className="chat-recents-menu-section">
                <p>排序方式</p>
                {item(CONVERSATION_SORT_LABELS.recent, preferences.sort === 'recent', () => update({ sort: 'recent' }))}
                {item(CONVERSATION_SORT_LABELS.title, preferences.sort === 'title', () => update({ sort: 'title' }))}
            </div>
            <div className="chat-recents-menu-section">
                <p>显示</p>
                {item(CONVERSATION_DISPLAY_LABELS.all, preferences.display === 'all', () => update({ display: 'all' }))}
                {item(CONVERSATION_DISPLAY_LABELS.pinned, preferences.display === 'pinned', () => update({ display: 'pinned' }))}
                {item(CONVERSATION_DISPLAY_LABELS.running, preferences.display === 'running', () => update({ display: 'running' }))}
            </div>
            <div className="chat-recents-menu-divider" role="separator" />
            <button type="button" role="menuitem" className="chat-recents-menu-item" onClick={() => saveConversationListPreferences(userId, CONVERSATION_LIST_DEFAULTS)}>
                <span>恢复默认设置</span>
            </button>
        </FloatingPanel>
    </>;
}

interface SidebarConversationsProps {
    /** `date`: 今天 / 昨天 / 7 天内 … groups with task markers (chat sidebar); `source`: grouped by divination type. */
    grouping?: 'source' | 'date';
    markers?: ReadonlyMap<string, ConversationAgentMarker>;
    /** Inside a modal drawer the row menu renders in the dialog's top layer. */
    withinModal?: boolean;
}

/** 最近对话默认列出的条数；其余点「查看更多」展开。 */
const RECENT_VISIBLE = 10;

export function SidebarConversations({ grouping = 'source', markers, withinModal = false }: SidebarConversationsProps = {}) {
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

    const [collapsedGroups, setCollapsedGroups] = useState<Set<ConversationSourceType>>(new Set());
    const [actionConv, setActionConv] = useState<ConversationListItem | null>(null);
    const [actionView, setActionView] = useState<'menu' | 'rename' | 'delete'>('menu');
    const actionAnchorRef = useRef<HTMLElement>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [sidebarTargetCount, setSidebarTargetCount] = useState<number | null>(null);
    const listViewportRef = useRef<HTMLDivElement | null>(null);
    const pinnedBlockRef = useRef<HTMLDivElement | null>(null);

    // Determine active conversation from URL search params
    const activeId = useMemo(() => {
        if (!pathname?.startsWith('/chat')) return undefined;
        return searchParams.get('id') ?? undefined;
    }, [pathname, searchParams]);

    const wantsDate = grouping === 'date';
    const { user } = useSessionSafe();
    const userId = user?.id ?? null;
    // claude Pinned 组与「分组和排序」：纯前端偏好（localStorage，按用户隔离）。
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    // 组头的「最近使用」菜单写在全局侧栏里（Sidebar.tsx），这里只订阅同一份偏好。
    const listPreferences = useConversationListPreferences(userId);
    useEffect(() => {
        setPinnedIds(loadPinnedConversations(userId));
    }, [userId]);
    const togglePin = useCallback((conv: ConversationListItem) => {
        if (!userId) return;
        setPinnedIds(current => togglePinnedConversation(userId, conv.id, current));
    }, [userId]);
    const [pinnedOpen, setPinnedOpen] = useState(true);
    const [recentsOpen, setRecentsOpen] = useState(true);
    // 每次「查看更多」再多列 10 条；置顶与当前会话始终在列，不占这 10 个名额。
    const [recentsLimit, setRecentsLimit] = useState(RECENT_VISIBLE);

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
    // 会话按类别分栏（claude 的 Claude|Code 两个列表）：跑过 Agent 任务的归「Agent」，其余归「对话」；
    // 当前打开的会话一律保留，避免新建或跨类会话在列表里凭空消失。
    // 列表跟随当前对话方式：/chat 内取页内控件，其它页面取本地偏好。
    const chatMode = useCurrentChatMode(userId);
    const visibleConversations = useMemo(() => {
        const wantsAgent = chatMode === 'agent';
        return conversations.filter(conv => {
            // 只在聊天页按当前方式过滤；其它页面展示全部会话（任务标记不因换页消失）。
            if (wantsDate && conv.hasAgentRun !== undefined && conv.hasAgentRun !== wantsAgent) return false;
            if (listPreferences.display === 'pinned') return pinnedSet.has(conv.id) || conv.id === activeId;
            if (listPreferences.display === 'running') return markers?.get(conv.id) === 'running' || markers?.get(conv.id) === 'awaiting' || conv.id === activeId;
            return true;
        });
    }, [conversations, chatMode, wantsDate, activeId, listPreferences.display, pinnedSet, markers]);
    // 正在跑或等你回答的会话：列表里本来就有标记，这里让它永远在列，并排到最近使用的最上面。
    const needsAttention = useCallback((id: string) => markers?.get(id) === 'running' || markers?.get(id) === 'awaiting', [markers]);
    const shownConversations = useMemo(() => {
        const kept: ConversationListItem[] = [];
        let recents = 0;
        for (const conv of visibleConversations) {
            if (pinnedSet.has(conv.id) || conv.id === activeId || needsAttention(conv.id)) { kept.push(conv); continue; }
            if (recents >= recentsLimit) continue;
            recents += 1;
            kept.push(conv);
        }
        return kept;
    }, [recentsLimit, visibleConversations, pinnedSet, activeId, needsAttention]);
    const hasHiddenRecents = shownConversations.length < visibleConversations.length;
    // 还有没列出来的（本地或服务端）就只给「查看更多」；全都列完了才给「收起」。
    const hasMoreToShow = visibleConversations.length > 0 && (hasHiddenRecents || hasMoreConversations);
    // 置顶会话从最近列表里抽出，单独组成最上面的「已置顶」组。
    const unpinnedConversations = useMemo(() => {
        const recents = shownConversations.filter(conv => !pinnedSet.has(conv.id));
        // 需要你回应的排在最前，其余保持原来的先后。
        return [...recents.filter(conv => needsAttention(conv.id) && conv.id !== activeId), ...recents.filter(conv => !needsAttention(conv.id) || conv.id === activeId)];
    }, [shownConversations, pinnedSet, needsAttention, activeId]);
    const pinnedConversations = useMemo(() => pinnedIds.map(id => shownConversations.find(conv => conv.id === id)).filter((conv): conv is ConversationListItem => Boolean(conv)), [pinnedIds, shownConversations]);

    // 「标题 A→Z」作用于每个日期组内部；「最近活动」保持接口原始顺序。
    const sortGroupItems = useCallback((items: ConversationListItem[]) => listPreferences.sort === 'title'
        ? [...items].sort((a, b) => formatConversationMenuTitle(a).localeCompare(formatConversationMenuTitle(b), 'zh-Hans-CN'))
        : items, [listPreferences.sort]);

    const groupedConversations = useMemo(() => {
        const groups: Record<ConversationSourceType, ConversationListItem[]> = {
            chat: [], dream: [], bazi_wuxing: [], bazi_personality: [],
            tarot: [], liuyao: [], ziwei: [], mbti: [], hepan: [],
            palm: [], face: [], qimen: [], daliuren: [],
            meihua: [], xiaoliuren: [],
        };

        shownConversations.forEach(conv => {
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
    }, [shownConversations]);

    const toggleGroup = useCallback((type: ConversationSourceType) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });
    }, []);

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

    const shouldAutoTopUp = collapsedGroups.size === 0;

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

    return (
        <>
            {/* 对话区域 — 紧凑内嵌在 Chat 项下方；只有「最近使用」这一段滚动，「已置顶」停在上面。 */}
            <div className={`${wantsDate ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
                {wantsDate && pinnedConversations.length > 0 ? (
                    <div className="chat-nav-pinned-block" ref={pinnedBlockRef}>
                        <section className="chat-nav-group" aria-label="已置顶">
                            <div className="chat-recents-head chat-pinned-head">
                                <button type="button" className="chat-recents-toggle" aria-expanded={pinnedOpen}
                                    onClick={() => setPinnedOpen(value => !value)}>
                                    <span>已置顶</span>
                                    <span className="chat-recents-caret" aria-hidden="true">{pinnedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                                </button>
                            </div>
                            {pinnedOpen && pinnedConversations.map(conv => (
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
                    </div>
                ) : null}
                {/* 组头固定在列表上方：外面滚动只作用于会话行，箭头与「最近使用」不随列表滑动。 */}
                {wantsDate && !withinModal ? (
                    <div className="chat-recents-block">
                        <RecentsHead userId={userId} recentsOpen={recentsOpen} onToggleRecents={() => setRecentsOpen(value => !value)}
                            onToggleBlocked={recentsOpen && !!activeId && unpinnedConversations.some(conv => conv.id === activeId) ? true : undefined} />
                    </div>
                ) : null}
                <div ref={listViewportRef} className={`relative space-y-0.5 ${wantsDate ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>
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
                    ) : shownConversations.length === 0 && !pendingSidebarTitle ? (
                        wantsDate && !withinModal ? (
                            <section className="chat-nav-group" aria-label="最近使用">
                                {recentsOpen && <div className="text-center text-foreground-secondary text-[11px] py-3">暂无对话</div>}
                            </section>
                        ) : (
                            <div className="text-center text-foreground-secondary text-[11px] py-3">
                                暂无对话
                            </div>
                        )
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
                            {wantsDate ? (
                                <div className="chat-recents-block">
                                    <section className="chat-nav-group" aria-label="最近使用">
                                    {recentsOpen && <>
                                    {pendingSidebarTitle ? (
                                        <div data-conversation-row="true" className="chat-nav-row" data-pending="true">
                                            <span className="chat-nav-row-link">
                                                <span className="chat-nav-row-title">{pendingSidebarTitle}</span>
                                                <ConversationMarker marker="running" />
                                            </span>
                                        </div>
                                    ) : null}
                                    {/* 已置顶只在「已置顶」组出现；最近使用不重复列出（claude Pinned / Recents 同构）。 */}
                                    {sortGroupItems(unpinnedConversations).map(conv => (
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
                                    </>}
                                    </section>
                                </div>
                            ) : SOURCE_TYPE_ORDER.map(type => {
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
                                            onOpenAction={openActionSheet}
                                            editingId={editingId}
                                            editTitle={editTitle}
                                            onEditTitleChange={setEditTitle}
                                            onSaveRename={saveRename}
                                            onCancelRename={cancelRename}
                                            pendingTitle={pendingSidebarTitle}
                                            showPendingInGroup={showPendingInGroup}
                                            markers={markers}
                                            compact
                                        />
                                    </div>
                                );
                            })}
                        </>
                    )}
                    {/* 「最近使用」收起时，展开/收起一并隐藏。 */}
                    {hasLoadedConversations && (!wantsDate || recentsOpen) && hasMoreToShow && (
                        <div className="mt-1 px-2">
                            <button type="button" className="flex items-center gap-1 text-[14px] text-foreground-secondary transition-colors hover:text-foreground"
                                onClick={() => { if (!hasHiddenRecents && hasMoreConversations) void loadMoreConversations(); setRecentsLimit(limit => limit + RECENT_VISIBLE); }}
                                aria-busy={loadingMoreConversations || undefined}>
                                查看更多
                                {loadingMoreConversations ? <SoundWaveLoader variant="inline" /> : <ChevronDown size={15} aria-hidden="true" />}
                            </button>
                        </div>
                    )}
                    {hasLoadedConversations && visibleConversations.length > 0 && (!wantsDate || recentsOpen) && !hasMoreToShow && recentsLimit > RECENT_VISIBLE && (
                        <div className="mt-1 mb-1 px-2">
                            <button type="button" className="flex items-center gap-1 text-[14px] text-foreground-secondary transition-colors hover:text-foreground"
                                onClick={() => { setRecentsLimit(RECENT_VISIBLE); listViewportRef.current?.parentElement?.scrollTo({ top: 0 }); }}>
                                收起<ChevronUp size={15} aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <ConversationActions conversation={actionConv} anchorRef={actionAnchorRef} view={actionView} onViewChange={setActionView} onClose={closeActionSheet} onRename={startInlineRename} onDelete={confirmDelete} deleting={deleteLoading} withinModal={withinModal}
                pinned={actionConv ? pinnedSet.has(actionConv.id) : false} onPin={() => { if (actionConv) togglePin(actionConv); closeActionSheet(); }} />
        </>
    );
}
