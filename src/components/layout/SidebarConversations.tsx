/**
 * 侧边栏对话列表（内嵌在 Chat 项下方）
 *
 * 直接渲染在 AI > Chat 导航项下方，与导航共用滚动区域。
 * 初始仅显示少量对话，向下滚动后按需继续加载。
 * 站点侧栏统一按日期分组并显示 Agent 任务标记，搜索交给全局搜索。
 *
 * 'use client' 标记说明：
 * - 使用 React hooks 和交互状态
 */
'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Button } from '@/components/ui/Button';
import type { ConversationListItem } from '@/types';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import '@/components/chat/sidebar/chat-sidebar.css';
import { resolveConversationRemainingTargetCount } from '@/lib/chat/conversation-list-window';
import { ConversationMenu } from '@/components/chat/sidebar/ConversationActions';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, createMenuHandle, type MenuHandle } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
    const item = (label: string, value: string) => (
        <MenuRadioItem key={value} value={value} className="chat-recents-menu-item"><span>{label}</span></MenuRadioItem>
    );
    return <>
        <div className="chat-recents-head">
            {/* claude 组头：名称本身就是折叠开关，箭头在名称左侧；右侧是「分组和排序」与「新建会话」。 */}
            <Button unstyled type="button" className="chat-recents-toggle" aria-expanded={recentsOpen}
                title={onToggleBlocked ? '当前会话在列表中，先收起会隐藏它' : undefined}
                onClick={() => { if (onToggleBlocked) return; onToggleRecents(); }}>
                <span>最近使用</span>
                <span className="chat-recents-caret" aria-hidden="true">{recentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            </Button>
            <div className="chat-recents-tools">
                <Menu open={open} onOpenChange={setOpen}>
                    <MenuTrigger ref={anchorRef} className="chat-recents-tool" aria-label="筛选和分组最近对话" title="分组和排序">
                        <SlidersHorizontal size={14} aria-hidden="true" />
                    </MenuTrigger>
                    <MenuContent align="end" className="chat-recents-menu">
                        <MenuGroup>
                            <MenuLabel>排序方式</MenuLabel>
                            <MenuRadioGroup value={preferences.sort} onValueChange={value => update({ sort: value as typeof preferences.sort })}>
                                {item(CONVERSATION_SORT_LABELS.recent, 'recent')}
                                {item(CONVERSATION_SORT_LABELS.title, 'title')}
                            </MenuRadioGroup>
                        </MenuGroup>
                        <MenuGroup>
                            <MenuLabel>显示</MenuLabel>
                            <MenuRadioGroup value={preferences.display} onValueChange={value => update({ display: value as typeof preferences.display })}>
                                {item(CONVERSATION_DISPLAY_LABELS.all, 'all')}
                                {item(CONVERSATION_DISPLAY_LABELS.pinned, 'pinned')}
                                {item(CONVERSATION_DISPLAY_LABELS.running, 'running')}
                            </MenuRadioGroup>
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuItem className="chat-recents-menu-item" onClick={() => saveConversationListPreferences(userId, CONVERSATION_LIST_DEFAULTS)}>
                            <span>恢复默认设置</span>
                        </MenuItem>
                    </MenuContent>
                </Menu>
                <Button unstyled type="button" className="chat-recents-tool" aria-label="新建会话" title="新建会话"
                    onClick={() => { void handleNewChat(); router.push(newChatHref(currentMode)); }}><Plus size={14} aria-hidden="true" /></Button>
            </div>
        </div>
    </>;
}

interface SidebarConversationsProps {
    markers?: ReadonlyMap<string, ConversationAgentMarker>;
    /** Inside a modal drawer the row menu renders in the dialog's top layer. */
    withinModal?: boolean;
}

/** 最近对话默认列出的条数；其余点「查看更多」展开。 */
const RECENT_VISIBLE = 10;

export function SidebarConversations({ markers, withinModal = false }: SidebarConversationsProps = {}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
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

    const [conversationMenu] = useState<MenuHandle<ConversationListItem>>(() => createMenuHandle<ConversationListItem>());
    const [pendingDelete, setPendingDelete] = useState<ConversationListItem | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [sidebarTargetCount, setSidebarTargetCount] = useState<number | null>(null);
    const listViewportRef = useRef<HTMLDivElement | null>(null);

    // Determine active conversation from URL search params
    const activeId = useMemo(() => {
        if (!pathname?.startsWith('/chat')) return undefined;
        return searchParams.get('id') ?? undefined;
    }, [pathname, searchParams]);

    const { user } = useSessionSafe();
    const userId = user?.id ?? null;
    // claude Pinned 组与「分组和排序」：纯前端偏好（localStorage，按用户隔离）。
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    // 组头的「最近使用」菜单写在全局侧栏里（Sidebar.tsx），这里只订阅同一份偏好。
    const listPreferences = useConversationListPreferences(userId);
    const [prevPinnedUserId, setPrevPinnedUserId] = useState<string | null | undefined>(undefined);
    if (prevPinnedUserId !== userId) {
        setPrevPinnedUserId(userId);
        setPinnedIds(loadPinnedConversations(userId));
    }
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
    // 全站都按当前对话方式过滤（/chat 内取页内控件，其它页面取本地偏好），换页或从设置返回不会把两类记录混在一起。
    const chatMode = useCurrentChatMode(userId);
    const visibleConversations = useMemo(() => {
        const wantsAgent = chatMode === 'agent';
        return conversations.filter(conv => {
            if (conv.hasAgentRun !== undefined && conv.hasAgentRun !== wantsAgent) return false;
            if (listPreferences.display === 'pinned') return pinnedSet.has(conv.id) || conv.id === activeId;
            if (listPreferences.display === 'running') return markers?.get(conv.id) === 'running' || markers?.get(conv.id) === 'awaiting' || conv.id === activeId;
            return true;
        });
    }, [conversations, chatMode, activeId, listPreferences.display, pinnedSet, markers]);
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
    // 前端过滤（对话方式、置顶、运行中）会藏掉已加载的会话：此时服务端「还有下一页」不代表
    // 还有能显示出来的会话，先不给「查看更多」，免得点开只翻出被过滤掉的条目。
    const filtersDropped = visibleConversations.length < conversations.length;
    // 还有没列出来的（本地或服务端）就只给「查看更多」；全都列完了才给「收起」。
    const hasMoreToShow = visibleConversations.length > 0 && (hasHiddenRecents || (hasMoreConversations && !filtersDropped));
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

    // Action menu helpers
    const startInlineRename = useCallback((conv: ConversationListItem) => {
        if (conv.sourceType !== 'chat') return;
        setEditingId(conv.id);
        setEditTitle(conv.title);
    }, []);

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
        if (!pendingDelete) return Promise.resolve();

        setDeleteLoading(true);
        return handleDeleteConversation(pendingDelete.id).finally(() => {
            setDeleteLoading(false);
            setPendingDelete(null);
        });
    }, [pendingDelete, handleDeleteConversation]);

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

    useEffect(() => {
        if (typeof window === 'undefined') {
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
    }, [getScrollContainer, getSidebarConversationTargetCount]);

    useEffect(() => {
        if (!hasLoadedConversations || sidebarTargetCount == null) {
            return;
        }

        triggerConversationListLoad(sidebarTargetCount);
    }, [hasLoadedConversations, sidebarTargetCount, triggerConversationListLoad]);

    return (
        <>
            {/* 对话区域 — 紧凑内嵌在 Chat 项下方；只有「最近使用」这一段滚动，「已置顶」停在上面。 */}
            <div className="flex min-h-0 flex-1 flex-col">
                {pinnedConversations.length > 0 ? (
                    <div className="chat-nav-pinned-block">
                        <section className="chat-nav-group" aria-label="已置顶">
                            <div className="chat-recents-head chat-pinned-head">
                                <Button unstyled type="button" className="chat-recents-toggle" aria-expanded={pinnedOpen}
                                    onClick={() => setPinnedOpen(value => !value)}>
                                    <span>已置顶</span>
                                    <span className="chat-recents-caret" aria-hidden="true">{pinnedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                                </Button>
                            </div>
                            {pinnedOpen && pinnedConversations.map(conv => (
                                <ConversationNavItem
                                    key={conv.id}
                                    conv={conv}
                                    isActive={activeId === conv.id}
                                    marker={markers?.get(conv.id)}
                                    menu={conversationMenu}
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
                {!withinModal ? (
                    <div className="chat-recents-block">
                        <RecentsHead userId={userId} recentsOpen={recentsOpen} onToggleRecents={() => setRecentsOpen(value => !value)}
                            onToggleBlocked={recentsOpen && !!activeId && unpinnedConversations.some(conv => conv.id === activeId) ? true : undefined} />
                    </div>
                ) : null}
                <div ref={listViewportRef} className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                    {conversationListError && !hasLoadedConversations && !conversationsLoading ? (
                        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-3 text-xs text-warning">
                            <div>{conversationListError}</div>
                            <Button variant="ghost" size="xs" className="mt-2 text-warning hover:bg-warning/10 hover:text-warning"
                                onClick={() => { void retryConversationListLoad(); }}>
                                重试
                            </Button>
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
                        <section className="chat-nav-group" aria-label="最近使用">
                            {recentsOpen && <div className="text-center text-foreground-secondary text-[11px] py-3">暂无对话</div>}
                        </section>
                    ) : (
                        <>
                            {conversationListError ? (
                                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                                    <span className="min-w-0 flex-1">{conversationListError}</span>
                                    <Button variant="ghost" size="xs" className="shrink-0 text-warning hover:bg-warning/10 hover:text-warning"
                                        onClick={() => { void retryConversationListLoad(); }}>
                                        重试
                                    </Button>
                                </div>
                            ) : null}
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
                                        marker={markers?.get(conv.id)}
                                        menu={conversationMenu}
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
                        </>
                    )}
                    {/* 「最近使用」收起时，展开/收起一并隐藏。 */}
                    {hasLoadedConversations && recentsOpen && hasMoreToShow && (
                        <div className="mt-1 px-2">
                            <Button unstyled type="button" className="flex items-center gap-1 text-[14px] text-foreground-secondary transition-colors hover:text-foreground"
                                onClick={() => { if (!hasHiddenRecents && hasMoreConversations) void loadMoreConversations(); setRecentsLimit(limit => limit + RECENT_VISIBLE); }}
                                aria-busy={loadingMoreConversations || undefined}>
                                查看更多
                                {loadingMoreConversations ? <SoundWaveLoader variant="inline" /> : <ChevronDown size={15} aria-hidden="true" />}
                            </Button>
                        </div>
                    )}
                    {hasLoadedConversations && visibleConversations.length > 0 && recentsOpen && !hasMoreToShow && recentsLimit > RECENT_VISIBLE && (
                        <div className="mt-1 mb-1 px-2">
                            <Button unstyled type="button" className="flex items-center gap-1 text-[14px] text-foreground-secondary transition-colors hover:text-foreground"
                                onClick={() => { setRecentsLimit(RECENT_VISIBLE); listViewportRef.current?.parentElement?.scrollTo({ top: 0 }); }}>
                                收起<ChevronUp size={15} aria-hidden="true" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <ConversationMenu menu={conversationMenu} onRename={startInlineRename} onDelete={setPendingDelete}
                onPin={togglePin} pinned={conv => pinnedSet.has(conv.id)} knowledgeBaseEnabled={knowledgeBaseEnabled} />
            <ConfirmDialog isOpen={pendingDelete !== null} onClose={() => { if (!deleteLoading) setPendingDelete(null); }}
                onConfirm={async () => { await confirmDelete(); }} loading={deleteLoading} title="删除此聊天"
                description={`删除“${pendingDelete ? formatConversationMenuTitle(pendingDelete) : ''}”后无法恢复。`} confirmText="确认删除" />
        </>
    );
}
