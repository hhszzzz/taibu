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
import { useState, useCallback, useEffect, useMemo, useRef, Suspense, useSyncExternalStore } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { RecentsHead, SidebarConversations } from '@/components/layout/SidebarConversations';
import { AnnouncementBellButton } from '@/components/layout/AnnouncementBellButton';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getSidebarNavItems, getSidebarToolItems, visibleNavItems, type NavItemDef } from '@/lib/navigation/registry';
import { resolveSidebarPinnedIds, useSidebarPins } from '@/lib/navigation/sidebar-pins';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { AllDivinationsPanel } from '@/components/layout/AllDivinationsPanel';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { ChatSidebarConversations } from '@/components/chat/sidebar/ChatSidebarConversations';
import { ModeSwitch } from '@/components/chat/ModeSwitch';
import { persistStoredChatMode, useStoredChatMode } from '@/lib/chat/mode-control-store';

// Derive from registry once at module level
const navItems = getSidebarNavItems();
const toolItems = getSidebarToolItems();

const ASIDE_CLASS = 'relative hidden lg:flex flex-col h-screen sticky top-0 z-20 bg-sidebar border-r-[0.5px] border-border w-[var(--sidebar-width)]';
// 侧栏行 = 克隆站 shell/sidebar 的 Row 逐值：h-8 / px-0.5 / gap-2 / rounded-8 / 14px / 120ms；
// 前导槽固定 28px（Leading w-7）；悬停 #f0efec、选中 #edece8（克隆站 --df-hover/--df-selected 实色）+ primary（不加字重）。
const ITEM_BASE = 'group/row flex items-center gap-2 h-8 px-0.5 rounded-lg text-[14px] transition-colors duration-[120ms]';
const ITEM_IDLE = 'text-foreground-secondary hover:bg-[var(--df-hover)]';
const ITEM_ACTIVE = 'bg-[var(--df-selected)] text-foreground';
const SECTION_LABEL = 'px-1.5 pt-4 pb-1.5 text-[13px] font-normal text-foreground-tertiary';
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
            <span aria-hidden className="w-[26px] h-[26px] rounded-[7px] bg-clay text-[var(--on-accent)] flex items-center justify-center flex-shrink-0 font-display text-base font-semibold leading-none">卜</span>
            <span className="font-display text-[19px] font-medium text-foreground whitespace-nowrap">太卜</span>
        </Link>
    );
}

function SidebarNavLink({ item, active, title }: { item: NavItemDef; active: boolean; title?: string }) {
    const Icon = item.icon;
    return (
        <Link href={item.href} title={title} aria-current={active ? 'page' : undefined} className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
            <span className="flex w-7 flex-shrink-0 items-center justify-center">
                <Icon className={`w-5 h-5 ${active ? 'text-foreground' : 'text-foreground-secondary'}`} />
            </span>
            <span className="truncate">{item.label}</span>
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
            <div className="flex items-center h-11 px-2 justify-between">
                <Brand />
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
            <div className="flex items-center h-11 px-2">
                <Brand />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-sm text-foreground-secondary dark:text-foreground-secondary">导航状态加载失败</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-lg bg-accent px-3 py-2 text-sm text-on-accent transition-colors hover:bg-accent-hover"
                >
                    重试
                </button>
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
    const allButtonRef = useRef<HTMLButtonElement>(null);
    const { pins, togglePin } = useSidebarPins();
    const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
    // 全站常驻的「对话方式」：/chat 之外由侧栏回退控件显示本地偏好（页内由 store 接管）。
    const storedMode = useStoredChatMode(user?.id);
    // ⇧⌘O = 克隆站「新建」行的快捷键：新建会话并回到 /chat。
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
                event.preventDefault();
                handleNewChat().then(() => router.push('/chat'));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleNewChat, router]);
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

    // 未登录不显示命理记录等个人数据入口；其余工具照常。
    const filteredToolItems = useMemo(() => visibleNavItems(toolItems, !!user)
        .filter((item) => item.id !== 'chat' && isFeatureEnabled(item.id)), [isFeatureEnabled, user]);

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
                    <Brand />
                    <ModeSwitch fallback={{
                        mode: storedMode,
                        onSelect: (mode) => {
                            persistStoredChatMode(user?.id, mode);
                            router.push('/chat');
                        },
                    }} />
                </div>

                <div className="flex-shrink-0 px-2 pt-2 space-y-0.5">
                    {chatItem ? (
                        <button type="button" onClick={openConversationSearch} className={`${ITEM_BASE} chat-nav-search w-full`}>
                            <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                <SearchIcon size={16} aria-hidden="true" />
                            </span>
                            <span>搜索</span>
                            <kbd className="chat-nav-keycap" aria-hidden="true">⌘K</kbd>
                        </button>
                    ) : null}
                    {chatItem ? (
                        <Link
                            href={chatItem.href}
                            aria-current={pathname === chatItem.href && !activeConvId ? 'page' : undefined}
                            className={`${ITEM_BASE} chat-nav-new ${pathname === chatItem.href && !activeConvId ? ITEM_ACTIVE : ITEM_IDLE}`}
                            onClick={(event) => {
                                event.preventDefault();
                                handleNewChat().then(() => router.push('/chat'));
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
                        <SidebarNavLink key={item.href} item={item} active={pathname === item.href} />
                    ))}
                </div>

                <div className="flex-shrink-0 px-2 pb-2">
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
                            <button
                                ref={allButtonRef}
                                type="button"
                                onClick={() => setAllOpen((open) => !open)}
                                aria-expanded={allOpen}
                                aria-haspopup="dialog"
                                className={`${ITEM_BASE} w-full ${allOpen ? 'bg-[var(--df-selected)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--df-hover)]'}`}
                            >
                                <span className="flex w-7 flex-shrink-0 items-center justify-center">
                                    <AllDivinationsIcon size={20} className={allActive ? 'text-foreground' : ''} />
                                </span>
                                <span>全部占术</span>
                            </button>
                        </li>
                    </ul>
                    <FloatingPanel
                        open={allOpen}
                        anchorRef={allButtonRef}
                        onClose={closeAll}
                        label="全部占术"
                        role="dialog"
                        side="right"
                        initialFocus="first"
                        className="all-divinations-panel"
                    >
                        <AllDivinationsPanel
                            items={filteredNavItems}
                            pins={pins}
                            pathname={pathname}
                            onTogglePin={togglePin}
                            onNavigate={closeAll}
                        />
                    </FloatingPanel>
                </div>

                <nav aria-label="最近对话" className="flex-1 min-h-0 overflow-y-auto px-2">
                    {chatItem && user ? (
                        isChatRoute ? (
                            /* Chat 侧栏自带「已置顶 / 最近使用」组头（claude 同构图），不再叠加外层组头。 */
                            <ChatSidebarConversations />
                        ) : (
                            <div>
                                <RecentsHead userId={user?.id ?? null} recentsOpen={recentsOpen} onToggleRecents={() => setRecentsOpen(value => !value)} />
                                {recentsOpen && <ul>
                                    <li>
                                        <SidebarConversations />
                                    </li>
                                </ul>}
                            </div>
                        )
                    ) : null}
                </nav>
                <div className="border-t border-border px-2 py-2 flex-shrink-0">
                    {user ? (
                        <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1"><SidebarUserCard user={user} /></div>
                            <AnnouncementBellButton iconSize={18} className="relative w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 text-foreground-secondary transition-colors duration-150 hover:bg-fill-ghost-hover hover:text-foreground" />
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowAuthModal(true)}
                            className="
                                flex items-center gap-1.5 px-3 h-8 justify-center rounded-lg w-full
                                text-[13.5px] font-medium
                                bg-accent text-on-accent
                                hover:bg-accent-hover
                                transition-colors duration-150
                            "
                        >
                            <LoginIcon size={16} className="flex-shrink-0" />
                            <span>登录</span>
                        </button>
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
