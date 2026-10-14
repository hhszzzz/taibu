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
import { Bell, LayoutGrid, LogIn, Plus, Search } from 'lucide-react';
import { useState, useCallback, useMemo, useRef, Suspense } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { SidebarConversations } from '@/components/layout/SidebarConversations';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useAnnouncementCenterSafe } from '@/components/providers/AnnouncementPopupHost';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useNotificationUnreadCount } from '@/lib/hooks/useNotificationUnreadCount';
import { getSidebarNavItems, getSidebarToolItems, type NavItemDef } from '@/lib/navigation/registry';
import { useSidebarPins } from '@/lib/navigation/sidebar-pins';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { AllDivinationsPanel } from '@/components/layout/AllDivinationsPanel';
import { useConversationList } from '@/lib/chat/ConversationListContext';

// Derive from registry once at module level
const navItems = getSidebarNavItems();
const toolItems = getSidebarToolItems();

const ASIDE_CLASS = 'hidden lg:flex flex-col h-screen sticky top-0 z-20 bg-sidebar border-r border-border w-[var(--sidebar-width)]';
const ITEM_BASE = 'flex items-center gap-2.5 h-9 px-2 rounded-lg text-sm transition-colors duration-150';
const ITEM_IDLE = 'text-foreground hover:bg-background-secondary';
const ITEM_ACTIVE = 'bg-background-tertiary text-foreground font-medium';
const SECTION_LABEL = 'px-2 pt-5 pb-2 text-xs text-foreground-secondary';
/** Opens the global conversation search (ConversationSearchHost listens for this event; ⌘K also works). */
const openConversationSearch = () => window.dispatchEvent(new Event('taibu:search'));

const isActivePath = (pathname: string | null, href: string) => pathname === href || !!pathname?.startsWith(href + '/');

function Brand() {
    return (
        <Link href="/" aria-label="太卜首页" className="flex items-center gap-2 min-w-0">
            <span aria-hidden className="w-[26px] h-[26px] rounded-[7px] bg-clay text-[#faf9f5] flex items-center justify-center flex-shrink-0 font-display text-base font-semibold leading-none">卜</span>
            <span className="font-display text-[19px] font-medium text-foreground whitespace-nowrap">太卜</span>
        </Link>
    );
}

function SidebarNavLink({ item, active, title }: { item: NavItemDef; active: boolean; title?: string }) {
    const Icon = item.icon;
    return (
        <Link href={item.href} title={title} aria-current={active ? 'page' : undefined} className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
            <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-accent' : 'text-foreground-secondary'}`} />
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
            <div className="flex items-center h-14 px-3 justify-between">
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
            <div className="flex items-center h-14 px-3">
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
    const { openAnnouncementCenter, announcementPromptCount } = useAnnouncementCenterSafe();
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [allOpen, setAllOpen] = useState(false);
    const allButtonRef = useRef<HTMLButtonElement>(null);
    const { pins, togglePin } = useSidebarPins();
    const isNavLoading = featureLoading;
    const notificationsEnabled = isFeatureEnabled('notifications');
    const unreadCount = useNotificationUnreadCount(user?.id ?? null, {
        enabled: notificationsEnabled,
    });
    const badgeCount = (notificationsEnabled ? (unreadCount ?? 0) : 0) + announcementPromptCount;

    // 当前是否在具体某个对话中
    const activeConvId = searchParams.get('id');

    // 根据 feature toggle 过滤导航项
    const filteredNavItems = useMemo(() => navItems
        .filter((item) => isFeatureEnabled(item.id)), [isFeatureEnabled]);

    // 已固定的占术按固定顺序展示；当前页属于未固定占术时临时追加
    const pinnedNavItems = useMemo(() => pins
        .map((id) => filteredNavItems.find((item) => item.id === id))
        .filter((item): item is NavItemDef => !!item), [filteredNavItems, pins]);
    const transientNavItem = useMemo(() => filteredNavItems
        .find((item) => !pins.includes(item.id) && isActivePath(pathname, item.href)) ?? null, [filteredNavItems, pathname, pins]);
    const allActive = !!transientNavItem;
    const divinationCount = useMemo(() => filteredNavItems.filter((item) => item.group !== 'fortune').length, [filteredNavItems]);
    const closeAll = useCallback(() => setAllOpen(false), []);

    const chatItem = useMemo(() => toolItems
        .find((item) => item.id === 'chat' && isFeatureEnabled('chat')), [isFeatureEnabled]);

    const filteredToolItems = useMemo(() => toolItems
        .filter((item) => item.id !== 'chat' && isFeatureEnabled(item.id)), [isFeatureEnabled]);

    const toggleAnnouncementCenter = useCallback(() => {
        openAnnouncementCenter({
            tab: user && notificationsEnabled ? 'notifications' : 'announcements',
        });
    }, [notificationsEnabled, openAnnouncementCenter, user]);

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
                <div className="flex items-center h-16 px-3.5 justify-between flex-shrink-0">
                    <Brand />
                    <button
                        onClick={toggleAnnouncementCenter}
                        className="relative w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 transition-colors duration-150 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
                        aria-label="打开公告中心"
                    >
                        <Bell className="w-[18px] h-[18px]" />
                        {badgeCount > 0 ? (
                            <span className="absolute -right-0.5 -top-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold leading-none flex items-center justify-center">
                                {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                        ) : null}
                    </button>
                </div>

                <div className="flex-shrink-0 px-2.5 space-y-1">
                    {chatItem ? (
                        <Link
                            href={chatItem.href}
                            aria-current={pathname === chatItem.href && !activeConvId ? 'page' : undefined}
                            className={`${ITEM_BASE} font-medium text-accent ${pathname === chatItem.href && !activeConvId ? 'bg-background-tertiary' : 'hover:bg-background-secondary'}`}
                            onClick={(event) => {
                                event.preventDefault();
                                handleNewChat().then(() => router.push('/chat'));
                            }}
                        >
                            <span className="w-6 h-6 -ml-0.5 rounded-full bg-clay text-white flex items-center justify-center flex-shrink-0">
                                <Plus className="w-3.5 h-3.5" strokeWidth={2.6} />
                            </span>
                            <span className="whitespace-nowrap">{chatItem.label}</span>
                        </Link>
                    ) : null}
                    {chatItem ? (
                        <button type="button" onClick={openConversationSearch} className={`${ITEM_BASE} w-full ${ITEM_IDLE}`}>
                            <Search className="w-[18px] h-[18px] flex-shrink-0 text-foreground-secondary" strokeWidth={1.6} />
                            <span>搜索</span>
                        </button>
                    ) : null}
                    {filteredToolItems.map((item) => (
                        <SidebarNavLink key={item.href} item={item} active={pathname === item.href} />
                    ))}
                </div>

                <div className="flex-shrink-0 px-2.5 pb-2">
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
                                className={`${ITEM_BASE} w-full ${allOpen ? 'bg-background-secondary text-foreground' : 'text-foreground-secondary hover:bg-background-secondary'}`}
                            >
                                <LayoutGrid className={`w-[18px] h-[18px] flex-shrink-0 ${allActive ? 'text-accent' : ''}`} strokeWidth={1.6} />
                                <span>全部占术</span>
                                <span className="ml-auto text-xs text-foreground-tertiary tabular-nums">{divinationCount}</span>
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

                <nav aria-label="最近对话" className="flex-1 min-h-0 overflow-y-auto px-2.5">
                    {chatItem && user ? (
                        <div>
                            <div className="sticky top-0 z-30 bg-sidebar px-2 pt-4 pb-2 text-xs text-foreground-secondary">
                                最近
                            </div>
                            <ul>
                                <li>
                                    <SidebarConversations />
                                </li>
                            </ul>
                        </div>
                    ) : null}
                </nav>
                <div className="border-t border-border px-2 py-2 flex-shrink-0">
                    {user ? (
                        <SidebarUserCard user={user} />
                    ) : (
                        <button
                            onClick={() => setShowAuthModal(true)}
                            className="
                                flex items-center gap-1.5 px-3 h-9 justify-center rounded-lg w-full
                                text-sm font-medium
                                bg-accent text-on-accent
                                hover:bg-accent-hover
                                transition-colors duration-150
                            "
                        >
                            <LogIn className="w-4 h-4 flex-shrink-0" />
                            <span>登录</span>
                        </button>
                    )}
                </div>
            </aside>
            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />
        </>
    );
}
