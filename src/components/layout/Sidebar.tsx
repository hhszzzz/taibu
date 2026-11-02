/**
 * 左侧导航栏组件
 *
 * 设计说明：
 * - 顶部为新聊天与工具入口，「占术」只列出已固定的命理体系，其余收进「全部占术」浮层
 * - 当前页面属于未固定的占术时，临时插入列表并高亮
 * - 下方内嵌对话列表（滚动容器必须是 nav，见 SidebarConversations）
 * - 桌面端显示在左侧，移动端隐藏（使用 MobileNav 代替）
 * - 侧边栏固定展开，顶部入口改为公告中心
 * - 底部包含用户信息
 */
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { AllDivinationsIcon, LoginIcon, PlusIcon, SearchIcon } from '@/lib/navigation/nav-icons';
import { BrandMark } from '@/components/brand/BrandMark';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { Button } from '@/components/ui/Button';
import { useState, useCallback, useEffect, useMemo, Suspense, useSyncExternalStore } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { RecentsHead, SidebarConversations } from '@/components/layout/SidebarConversations';
import { AnnouncementBellButton } from '@/components/layout/AnnouncementBellButton';
import { VersionChip } from '@/components/layout/VersionChip';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getSidebarNavItems, getSidebarToolItems, type NavItemDef } from '@/lib/navigation/registry';
import { resolveSidebarPinnedIds, useSidebarPins } from '@/lib/navigation/sidebar-pins';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { AllDivinationsPanel } from '@/components/layout/AllDivinationsPanel';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { ChatSidebarConversations } from '@/components/chat/sidebar/ChatSidebarConversations';
import { ModeSwitch } from '@/components/chat/ModeSwitch';
import { newChatHref, useCurrentChatMode } from '@/lib/chat/mode-control-store';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';
import { persistStoredChatMode, useStoredChatMode } from '@/lib/chat/mode-control-store';

// Derive from registry once at module level
const navItems = getSidebarNavItems();
const toolItems = getSidebarToolItems();

const ASIDE_CLASS = 'relative hidden lg:flex flex-col h-screen sticky top-0 z-20 bg-sidebar border-r-[0.5px] border-border w-[var(--sidebar-width)]';
// 侧栏行 = 克隆站 shell/sidebar 的 Row 逐值：h-8 / px-0.5 / gap-2 / rounded-8 / 14px / 120ms；
// 前导槽固定 28px（Leading w-7）；悬停与选中使用克隆站实测实色（对应 --df-hover/--df-selected）+ primary（不加字重）。
const ITEM_BASE = 'group/row flex items-center gap-2 h-8 px-0.5 rounded-lg text-[14px] transition-colors duration-[120ms]';
const ITEM_IDLE = 'text-foreground-secondary hover:bg-[var(--df-hover)]';
const ITEM_ACTIVE = 'bg-[var(--df-selected)] text-foreground';
const SECTION_LABEL = 'px-1.5 pt-2 pb-1.5 text-[13px] font-normal text-foreground-tertiary';
/** Opens the global conversation search (ConversationSearchHost listens for this event; ⌘K also works). */
const openConversationSearch = () => window.dispatchEvent(new Event('taibu:search'));

const isActivePath = (pathname: string | null, href: string) => pathname === href || !!pathname?.startsWith(href + '/');

// 侧栏宽度拖拽 = 克隆站 shell/sidebar 的 separator：240–440、双击复位 288、键盘 ←/→ 每次 16。
const SIDEBAR_WIDTH_KEY = 'taibu:sidebar-width';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 440;
const SIDEBAR_DEFAULT = 288;
const clampSidebarWidth = (value: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));

const SIDEBAR_WIDTH_EVENT = 'taibu:sidebar-width';

function readStoredSidebarWidth() {
    try {
        const raw = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
        return Number.isFinite(raw) && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX ? clampSidebarWidth(raw) : SIDEBAR_DEFAULT;
    } catch {
        return SIDEBAR_DEFAULT;
    }
}

function subscribeSidebarWidth(onChange: () => void) {
    window.addEventListener(SIDEBAR_WIDTH_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(SIDEBAR_WIDTH_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

function useSidebarWidth() {
    const width = useSyncExternalStore(subscribeSidebarWidth, readStoredSidebarWidth, () => SIDEBAR_DEFAULT);
    useEffect(() => {
        document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    }, [width]);
    const setWidth = useCallback((value: number) => {
        try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(value))); } catch { /* 隐私模式下忽略 */ }
        window.dispatchEvent(new Event(SIDEBAR_WIDTH_EVENT));
    }, []);
    return [width, setWidth] as const;
}

function Brand() {
    return (
        <Link href="/" aria-label="太卜首页" className="flex items-center gap-2 min-w-0">
            <BrandMark className="h-[26px] w-[26px] flex-shrink-0 text-foreground" />
            <span className="font-brand text-[21px] font-medium text-foreground whitespace-nowrap">太卜</span>
        </Link>
    );
}

function SidebarNavLink({ item, active, title, onRequireLogin }: { item: NavItemDef; active: boolean; title?: string; onRequireLogin?: () => void }) {
    const Icon = item.icon;
    return (
        <Link href={item.href} title={title} aria-current={active ? 'page' : undefined} className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
            onClick={onRequireLogin ? event => { event.preventDefault(); onRequireLogin(); } : undefined}>
            <span className="flex w-7 flex-shrink-0 items-center justify-center">
                <Icon className={`w-5 h-5 ${active ? 'text-foreground' : 'text-foreground-secondary'}`} />
            </span>
            <span className="truncate">{item.label}</span>
            {item.beta ? <BetaBadge /> : null}
        </Link>
    );
}

export function Sidebar() {
    return (
        <Suspense fallback={<SidebarSkeleton />}>
            <SidebarInner />
        </Suspense>
    );
}

function SidebarSkeleton() {
    return (
        <aside className={ASIDE_CLASS}>
            <div className="flex items-center h-11 px-2 gap-2 justify-between">
                <div className="flex items-center gap-1 min-w-0">
                    <Brand />
                </div>
                <div className="w-8 h-8 rounded-lg bg-background-secondary animate-pulse" />
            </div>
            <div className="flex-1 py-3 px-2 space-y-2">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div key={index} className="rounded-lg bg-background-secondary animate-pulse h-9 w-full" />
                ))}
            </div>
        </aside>
    );
}

function SidebarLoadError({ onRetry }: { onRetry: () => void }) {
    return (
        <aside className={ASIDE_CLASS}>
            <div className="flex items-center h-11 px-2 gap-2">
                <div className="flex items-center gap-1 min-w-0">
                    <Brand />
                </div>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-sm text-foreground-secondary dark:text-foreground-secondary">导航状态加载失败</p>
                <Button size="sm" onClick={onRetry}>重试</Button>
            </div>
        </aside>
    );
}

function SidebarInner() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user } = useSessionSafe();
    const { isFeatureEnabled, isLoading: featureLoading, loaded: featureLoaded, error: featureError, refresh: refreshFeatures } = useFeatureToggles();
    const { handleNewChat } = useConversationList();
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [allOpen, setAllOpen] = useState(false);
    const [recentsOpen, setRecentsOpen] = useState(true);
    const { pins, togglePin } = useSidebarPins();
    const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
    // 全站常驻的「对话方式」：/chat 之外由侧栏回退控件显示本地偏好（页内由 store 接管）。
    const storedMode = useStoredChatMode(user?.id);
    const currentMode = useCurrentChatMode(user?.id);
    const newChat = newChatHref(currentMode);
    // 任务标记在/chat 内外都要显示：非聊天页也订阅同一份活动数据。
    const markers = useAgentActivity(user?.id ?? null, searchParams.get('id'));
    // /chat 里控件由页面发布；首帧还没发布时按地址里的方式显示，免得切换条先亮 Agent 再滑回来。
    const routeMode = searchParams.get('mode') === 'agent' ? 'agent' as const : 'plain' as const;
    // ⇧⌘O = 克隆站「新建」行的快捷键：新建会话并回到 /chat。
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
                event.preventDefault();
                handleNewChat().then(() => router.push(newChat));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleNewChat, router, newChat]);
    const isNavLoading = featureLoading;

    // 当前是否在具体某个对话中
    const activeConvId = searchParams.get('id');
    const isChatRoute = pathname === '/chat';

    // 根据 feature toggle 过滤导航项
    const filteredNavItems = useMemo(() => navItems
        .filter((item) => isFeatureEnabled(item.id)), [isFeatureEnabled]);

    // 固定项（含默认固定的日运 / 月运）按 registry 固定顺序展示；
    // 当前页属于未固定占术时临时追加，不改变其余项的相对顺序。
    const pinnedIds = useMemo(() => resolveSidebarPinnedIds(pins), [pins]);
    const pinnedNavItems = useMemo(() => pinnedIds
        .map((id) => filteredNavItems.find((item) => item.id === id))
        .filter((item): item is NavItemDef => !!item), [filteredNavItems, pinnedIds]);
    const pinnedIdSet = useMemo(() => new Set(pinnedNavItems.map((item) => item.id)), [pinnedNavItems]);
    const transientNavItem = useMemo(() => filteredNavItems
        .find((item) => !pinnedIdSet.has(item.id) && isActivePath(pathname, item.href)) ?? null, [filteredNavItems, pathname, pinnedIdSet]);
    const allActive = !!transientNavItem;
    const closeAll = useCallback(() => setAllOpen(false), []);

    const chatItem = useMemo(() => toolItems
        .find((item) => item.id === 'chat' && isFeatureEnabled('chat')), [isFeatureEnabled]);

    // 所有入口都展示；未登录时点开需要账号的页面会先提示登录。
    const filteredToolItems = useMemo(() => toolItems
        .filter((item) => item.id !== 'chat' && isFeatureEnabled(item.id)), [isFeatureEnabled]);

    if (isNavLoading) {
        return <SidebarSkeleton />;
    }

    if (featureError && !featureLoading) {
        return <SidebarLoadError onRetry={() => { void refreshFeatures(); }} />;
    }

    if (!featureLoaded) {
        return <SidebarSkeleton />;
    }

    return (
        <>
            <aside className={ASIDE_CLASS}>
                <div className="flex items-center h-11 px-2 gap-2 justify-between flex-shrink-0">
                    <div className="flex items-center gap-1 min-w-0">
                        <Brand />
                        <VersionChip />
                    </div>
                    <ModeSwitch fallback={{
                        mode: isChatRoute ? routeMode : storedMode,
                        onSelect: (mode) => {
                            persistStoredChatMode(user?.id, mode);
                            router.push(mode === 'agent' ? '/chat?mode=agent' : '/chat');
                        },
                    }} />
                </div>

                <div className="flex-shrink-0 px-2 pt-2 space-y-0.5">
                    {chatItem ? (
                        <Button unstyled type="button" onClick={openConversationSearch} className={`${ITEM_BASE} chat-nav-search w-full`}>
                            <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                <SearchIcon size={16} aria-hidden="true" />
                            </span>
                            <span>搜索</span>
                            <kbd className="chat-nav-keycap" aria-hidden="true">⌘K</kbd>
                        </Button>
                    ) : null}
                    {chatItem ? (
                        <Link
                            href={newChat}
                            aria-current={pathname === chatItem.href && !activeConvId ? 'page' : undefined}
                            className={`${ITEM_BASE} chat-nav-new ${pathname === chatItem.href && !activeConvId ? ITEM_ACTIVE : ITEM_IDLE}`}
                            onClick={(event) => {
                                event.preventDefault();
                                handleNewChat().then(() => router.push(newChat));
                            }}
                        >
                            {/* claude 实测：新建行 = 前导槽 28px + 22px 空槽（icon 16/2，无圆形底），文字随选中 primary/secondary */}
                            <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                <span className="chat-nav-new-icon" aria-hidden="true">
                                    <PlusIcon size={16} />
                                </span>
                            </span>
                            <span className="whitespace-nowrap">{chatItem.label}</span>
                            <kbd className="chat-nav-keycap" aria-hidden="true">⇧⌘O</kbd>
                        </Link>
                    ) : null}
                    {filteredToolItems.map((item) => (
                        <SidebarNavLink key={item.href} item={item} active={pathname === item.href}
                            onRequireLogin={item.requiresAuth && !user ? () => setShowAuthModal(true) : undefined} />
                    ))}
                </div>

                <div className="flex-shrink-0 px-2 pb-[7px]">
                    <div className={SECTION_LABEL}>占术</div>
                    <ul className="space-y-0.5">
                        {pinnedNavItems.map((item) => (
                            <li key={item.id}>
                                <SidebarNavLink item={item} active={isActivePath(pathname, item.href)} />
                            </li>
                        ))}
                        {transientNavItem ? (
                            <li>
                                <SidebarNavLink item={transientNavItem} active title="未固定，可在「全部占术」中固定到侧栏" />
                            </li>
                        ) : null}
                        <li>
                            <Popover open={allOpen} onOpenChange={setAllOpen}>
                                <PopoverTrigger className={`${ITEM_BASE} w-full ${allOpen ? 'bg-[var(--df-selected)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--df-hover)]'}`}>
                                    <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                        <AllDivinationsIcon size={20} className={allActive ? 'text-foreground' : ''} />
                                    </span>
                                    <span>全部占术</span>
                                </PopoverTrigger>
                                <PopoverContent side="right" align="start" sideOffset={6} className="all-divinations-panel" aria-label="全部占术">
                                    <AllDivinationsPanel
                                        items={filteredNavItems}
                                        pins={pins}
                                        pathname={pathname}
                                        onTogglePin={togglePin}
                                        onNavigate={closeAll}
                                    />
                                </PopoverContent>
                            </Popover>
                        </li>
                    </ul>
                </div>

                {/* /chat 里只有「最近使用」列表自己滚动（已置顶固定在其上方），其余页面整段滚动。 */}
                <nav aria-label="最近对话" className={`flex flex-1 min-h-0 flex-col px-2 ${isChatRoute ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    {chatItem && user ? (
                        isChatRoute ? (
                            /* Chat 侧栏自带「已置顶 / 最近使用」组头（claude 同构图），不再叠加外层组头。 */
                            <ChatSidebarConversations />
                        ) : (
                            <div>
                                <RecentsHead userId={user?.id ?? null} recentsOpen={recentsOpen} onToggleRecents={() => setRecentsOpen(value => !value)} />
                                {recentsOpen && <ul>
                                    <li>
                                        <SidebarConversations markers={markers} />
                                    </li>
                                </ul>}
                            </div>
                        )
                    ) : null}
                </nav>
                <div className="border-t border-border px-2 py-1.5 flex-shrink-0">
                    {user ? (
                        <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1"><SidebarUserCard user={user} /></div>
                            <AnnouncementBellButton iconSize={18} className="relative w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 text-foreground-secondary transition-colors duration-150 hover:bg-fill-ghost-hover hover:text-foreground" />
                        </div>
                    ) : (
                        <Button size="sm" className="w-full" onClick={() => setShowAuthModal(true)}>
                            <LoginIcon size={16} className="flex-shrink-0" />
                            <span>登录</span>
                        </Button>
                    )}
                </div>
                {/* 宽度拖拽 = 克隆站侧栏右缘热区：12px 热区 + 3px 胶囊，悬停/聚焦显现 */}
                <div role="separator" aria-orientation="vertical" aria-label="调整侧边栏宽度"
                    aria-valuenow={sidebarWidth} aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX}
                    tabIndex={0} className="sidebar-resizer"
                    onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
                    onKeyDown={event => {
                        if (event.key === 'ArrowLeft') { event.preventDefault(); setSidebarWidth(sidebarWidth - 16); }
                        if (event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth(sidebarWidth + 16); }
                    }}
                    onPointerDown={event => {
                        event.preventDefault();
                        const startX = event.clientX;
                        const startWidth = sidebarWidth;
                        const target = event.currentTarget;
                        target.setPointerCapture(event.pointerId);
                        const onMove = (move: PointerEvent) => setSidebarWidth(startWidth + move.clientX - startX);
                        const onUp = () => {
                            target.releasePointerCapture(event.pointerId);
                            window.removeEventListener('pointermove', onMove);
                            window.removeEventListener('pointerup', onUp);
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                    }}>
                    <span aria-hidden="true" />
                </div>
            </aside>
            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />
        </>
    );
}
