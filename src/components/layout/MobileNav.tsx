/**
 * 移动端底部导航 + 「全部占术」底部抽屉
 *
 * 设计说明：
 * - 仅在移动端显示（lg 以下屏幕），固定在底部
 * - 底栏：长按抽屉中的占术可固定一项到最前（默认六爻），其后是新聊天、日运与「更多」
 * - 抽屉按占术分组并支持搜索；日运 · 黄历 / 月运固定在底部，工具与「我的」入口排在占术之后
 */
'use client';
// 需要 usePathname + 抽屉开合/搜索状态 + 长按计时器（pointer 事件）

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useActiveSettingsCenterTab } from '@/lib/hooks/useSettingsCenterRouteState';
import { DEFAULT_MOBILE_MAIN_ITEMS, DEFAULT_MOBILE_DRAWER_ORDER } from '@/lib/user/settings';
import { filterNavItems, getNavItemById, groupDivinationItems, toFeatureId, type NavItemDef } from '@/lib/navigation/registry';
import { isMobileNavPinnable, resolveMobileNavPin, useMobileNavPins } from '@/lib/navigation/mobile-nav-pins';
import {
    getSettingsCenterTabFromRouteTarget,
    openSettingsCenter,
} from '@/lib/settings-center';

const LONG_PRESS_MS = 500;
/** 手指移动超过该距离视为滚动，取消长按 */
const LONG_PRESS_SLOP_PX = 10;

const GRID_COLS_CLASS: Record<number, string> = {
    0: 'grid-cols-1',
    1: 'grid-cols-2',
    2: 'grid-cols-3',
    3: 'grid-cols-4',
};

function isMergedMembershipNavEnabled(id: string, isFeatureEnabled: (featureId: string) => boolean) {
    if (id === 'settings-personalization') {
        return isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization');
    }
    return isFeatureEnabled(toFeatureId(id));
}

function resolveEnabledItems(ids: readonly string[], isFeatureEnabled: (featureId: string) => boolean): NavItemDef[] {
    return ids
        .filter(id => isMergedMembershipNavEnabled(id, isFeatureEnabled))
        .map(id => getNavItemById(id))
        .filter((item): item is NavItemDef => !!item);
}

/** 当前路径命中 href 或其子路径，且没有更具体的兄弟入口（如 /user 与 /user/notifications）抢先命中 */
function isPathActive(pathname: string | null, href: string, siblings: readonly NavItemDef[]) {
    if (!pathname) return false;
    const within = (target: string) => pathname === target || pathname.startsWith(`${target}/`);
    if (!within(href)) return false;
    return pathname === href || !siblings.some(other => other.href !== href && other.href.startsWith(`${href}/`) && within(other.href));
}

interface PressState {
    id: string;
    x: number;
    y: number;
    timer: number;
    fired: boolean;
}

/**
 * 长按识别：按住 LONG_PRESS_MS 触发 onLongPress；滑动、抬起或取消即作废。
 * 安卓长按会先派发 contextmenu，与计时器只取先到者；触发后随之而来的一次 click 被吞掉，避免顺带跳转。
 */
function useLongPress(onLongPress: (id: string) => void) {
    const pressRef = useRef<PressState | null>(null);
    const suppressClickRef = useRef<string | null>(null);

    const cancel = useCallback(() => {
        if (pressRef.current) window.clearTimeout(pressRef.current.timer);
        pressRef.current = null;
    }, []);

    useEffect(() => cancel, [cancel]);

    const fire = (id: string) => {
        const press = pressRef.current;
        if (press?.id === id) {
            window.clearTimeout(press.timer);
            press.fired = true;
            suppressClickRef.current = id;
        }
        onLongPress(id);
    };

    const bind = (id: string) => ({
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
            // 新的一次按压开始：上一次长按若没有产生 click，不能连累这次点击
            suppressClickRef.current = null;
            cancel();
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const timer = window.setTimeout(() => fire(id), LONG_PRESS_MS);
            pressRef.current = { id, x: event.clientX, y: event.clientY, timer, fired: false };
        },
        onPointerMove: (event: PointerEvent<HTMLElement>) => {
            const press = pressRef.current;
            if (press && !press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) {
                cancel();
            }
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            if (pressRef.current?.fired) return;
            fire(id);
        },
    });

    /** 若这次 click 来自刚完成的长按则返回 true（调用方应阻止跳转） */
    const consumeClick = (id: string) => {
        if (suppressClickRef.current !== id) return false;
        suppressClickRef.current = null;
        return true;
    };

    return { bind, consumeClick };
}

const TILE_BASE_CLASS = 'relative flex flex-col items-center gap-1.5 rounded-[14px] border-[0.5px] px-0.5 pb-[9px] pt-2.5 transition-colors duration-200';

export function MobileNav() {
    const pathname = usePathname();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [query, setQuery] = useState('');
    const { isFeatureEnabled, isLoading: featureLoading, loaded: featureLoaded, error: featureError, refresh: refreshFeatures } = useFeatureToggles();
    const activeSettingsTab = useActiveSettingsCenterTab();
    const { pins, togglePin } = useMobileNavPins();
    const { showToast } = useToast();
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    const pinnedItem = useMemo(
        () => resolveMobileNavPin(pins, id => isMergedMembershipNavEnabled(id, isFeatureEnabled)),
        [pins, isFeatureEnabled],
    );

    // 底栏：固定占术（可为空）+ 新聊天 + 日运
    const mainNavItems = useMemo(() => {
        const fixedItems = resolveEnabledItems(DEFAULT_MOBILE_MAIN_ITEMS, isFeatureEnabled);
        return pinnedItem ? [pinnedItem, ...fixedItems] : fixedItems;
    }, [pinnedItem, isFeatureEnabled]);

    const drawerNavItems = useMemo(() => resolveEnabledItems(DEFAULT_MOBILE_DRAWER_ORDER, isFeatureEnabled), [isFeatureEnabled]);
    const activeSiblings = useMemo(() => [...mainNavItems, ...drawerNavItems], [mainNavItems, drawerNavItems]);

    const divinationGroups = useMemo(
        () => groupDivinationItems(filterNavItems(drawerNavItems.filter(isMobileNavPinnable), query)),
        [drawerNavItems, query],
    );
    const fortuneItems = useMemo(() => drawerNavItems.filter(item => item.group === 'fortune'), [drawerNavItems]);
    const extraSections = useMemo(() => {
        const sections: { key: string; label: string; items: NavItemDef[] }[] = [];
        const tools = drawerNavItems.filter(item => item.category === 'tool');
        const user = drawerNavItems.filter(item => item.category === 'user');
        if (tools.length > 0) sections.push({ key: 'tool', label: '工具', items: tools });
        if (user.length > 0) sections.push({ key: 'user', label: '我的', items: user });
        return sections;
    }, [drawerNavItems]);
    const isSearching = query.trim().length > 0;

    const closeDrawer = useCallback(() => {
        setIsDrawerOpen(false);
        setQuery('');
    }, []);

    const handleTogglePin = useCallback((id: string) => {
        const item = getNavItemById(id);
        if (!item) return;
        const wasPinned = pins.includes(id);
        togglePin(id);
        if (wasPinned) {
            showToast('info', `已取消固定「${item.label}」`);
        } else {
            showToast('success', `已将「${item.label}」固定到底部导航`);
        }
    }, [pins, togglePin, showToast]);

    const longPress = useLongPress(handleTogglePin);

    // 打开时锁定背景滚动、聚焦关闭按钮并支持 Esc；关闭后焦点回到「更多」
    useEffect(() => {
        if (!isDrawerOpen) return;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus({ preventScroll: true });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeDrawer();
        };
        document.addEventListener('keydown', handleKeyDown);
        const moreButton = moreButtonRef.current;
        return () => {
            document.body.style.overflow = '';
            document.removeEventListener('keydown', handleKeyDown);
            moreButton?.focus({ preventScroll: true });
        };
    }, [isDrawerOpen, closeDrawer]);

    const getItemTarget = (item: NavItemDef) => {
        const settingsTab = getSettingsCenterTabFromRouteTarget(item.href);
        const isActive = settingsTab
            ? activeSettingsTab === settingsTab
            : isPathActive(pathname, item.href, activeSiblings);
        return { settingsTab, isActive };
    };

    const renderDrawerTile = (item: NavItemDef, pinnable: boolean) => {
        const { settingsTab, isActive } = getItemTarget(item);
        const isPinned = pinnable && pinnedItem?.id === item.id;
        const Icon = item.icon;

        return (
            <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                draggable={false}
                {...(pinnable ? longPress.bind(item.id) : {})}
                className={`${TILE_BASE_CLASS} select-none [-webkit-touch-callout:none] ${isActive
                    ? 'border-accent/50 bg-accent-light text-accent-strong'
                    : 'border-border bg-background text-foreground active:bg-background-secondary'}`}
                onClick={(event) => {
                    if (pinnable && longPress.consumeClick(item.id)) {
                        event.preventDefault();
                        return;
                    }
                    closeDrawer();
                    if (settingsTab) {
                        event.preventDefault();
                        openSettingsCenter(settingsTab);
                    }
                }}
            >
                {isPinned && (
                    <span aria-hidden className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full bg-clay" />
                )}
                <span className={`flex h-9 w-9 items-center justify-center rounded-[11px] ${isActive
                    ? 'bg-accent-soft text-accent'
                    : 'bg-background-secondary text-foreground/80'}`}>
                    <Icon className="h-[22px] w-[22px]" />
                </span>
                <span className="text-center text-[13px] leading-tight">{item.label}</span>
                {isPinned && <span className="sr-only">（已固定到底部导航）</span>}
            </Link>
        );
    };

    if (featureError && !featureLoading) {
        return (
            <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md lg:hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                    <span className="text-xs text-foreground-secondary">导航状态加载失败</span>
                    <button
                        type="button"
                        onClick={() => { void refreshFeatures(); }}
                        className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
                    >
                        重试
                    </button>
                </div>
            </nav>
        );
    }

    if (featureLoading || !featureLoaded) {
        return (
            <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md lg:hidden">
                <div className="grid grid-cols-4 gap-1 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="flex flex-col items-center gap-2 py-2">
                            <div className="h-10 w-10 animate-pulse rounded-full bg-background-secondary" />
                            <div className="h-3 w-8 animate-pulse rounded bg-background-secondary" />
                        </div>
                    ))}
                </div>
            </nav>
        );
    }

    return (
        <>
            {/* 抽屉遮罩 */}
            <div
                aria-hidden
                onClick={closeDrawer}
                className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden ${isDrawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            />

            {/* 全部占术抽屉：visibility 只在收起时随动画延后切换，展开时立即可见以便聚焦 */}
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-all-divinations-title"
                aria-hidden={!isDrawerOpen}
                inert={!isDrawerOpen}
                className={`fixed inset-x-0 bottom-0 top-[calc(var(--mobile-header-height)+1.5rem)] z-50 mx-auto flex max-w-[640px] flex-col overflow-hidden rounded-t-[22px] bg-surface shadow-[0_-8px_30px_rgba(20,20,19,0.12)] duration-300 ease-out lg:hidden ${isDrawerOpen ? 'visible translate-y-0 transition-transform' : 'invisible translate-y-full transition-[transform,visibility]'}`}
            >
                <span aria-hidden className="mt-2 h-1 w-9 shrink-0 self-center rounded-full bg-foreground/15" />
                <div className="flex shrink-0 items-center justify-between pl-5 pr-2 pt-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h2 id="mobile-all-divinations-title" className="font-display text-xl font-medium text-foreground">全部占术</h2>
                        <p className="flex items-center gap-1 text-xs text-foreground-secondary">
                            长按可固定到底部导航 ·
                            <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-clay" />
                            已固定
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={closeDrawer}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-foreground/80 transition-colors hover:bg-background-secondary"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" strokeWidth={1.7} />
                    </button>
                </div>

                <div className="mx-4 mt-3 flex h-10 shrink-0 items-center rounded-[10px] bg-background-secondary pl-3 pr-1 text-foreground-tertiary focus-within:ring-2 focus-within:ring-accent/40">
                    <label className="flex h-full min-w-0 flex-1 items-center gap-2">
                        <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} aria-hidden />
                        <span className="sr-only">搜索占术</span>
                        <input
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="搜索占术"
                            enterKeyHint="search"
                            autoComplete="off"
                            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-tertiary focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
                        />
                    </label>
                    {isSearching && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:text-foreground"
                            aria-label="清除搜索"
                        >
                            <X className="h-4 w-4" strokeWidth={1.7} />
                        </button>
                    )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3">
                    {divinationGroups.length === 0 ? (
                        <p className="py-8 text-center text-sm text-foreground-secondary">没有匹配的占术</p>
                    ) : divinationGroups.map(group => (
                        <section key={group.id} aria-label={group.label} className="flex flex-col gap-2">
                            <h3 className="px-0.5 text-xs text-foreground-secondary">{group.label}</h3>
                            <div className="grid grid-cols-4 gap-2">
                                {group.items.map(item => renderDrawerTile(item, true))}
                            </div>
                        </section>
                    ))}
                    {!isSearching && extraSections.map(section => (
                        <section key={section.key} aria-label={section.label} className="flex flex-col gap-2">
                            <h3 className="px-0.5 text-xs text-foreground-secondary">{section.label}</h3>
                            <div className="grid grid-cols-4 gap-2">
                                {section.items.map(item => renderDrawerTile(item, false))}
                            </div>
                        </section>
                    ))}
                </div>

                {fortuneItems.length > 0 && (
                    <div className="grid shrink-0 grid-cols-2 gap-2 border-t-[0.5px] border-border/70 px-4 pt-3 pb-[max(1.75rem,var(--sab))]">
                        {fortuneItems.map(item => {
                            const Icon = item.icon;
                            const { isActive } = getItemTarget(item);
                            return (
                                <Link
                                    key={item.id}
                                    href={item.href}
                                    onClick={closeDrawer}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm transition-colors ${item.id === 'daily'
                                        ? 'bg-accent-light text-accent-strong active:bg-accent-soft'
                                        : 'bg-background-secondary text-foreground/80 active:bg-background-tertiary'}`}
                                >
                                    <Icon className="h-[18px] w-[18px]" />
                                    {item.description ?? item.label}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 底部导航栏 */}
            <nav
                className={`fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md safe-area-inset-bottom transition-transform duration-300 lg:hidden ${isDrawerOpen ? 'translate-y-full' : 'translate-y-0'}`}
            >
                <ul className={`grid px-2 py-1 ${GRID_COLS_CLASS[mainNavItems.length] ?? 'grid-cols-5'}`}>
                    {mainNavItems.map((item) => {
                        const { settingsTab, isActive } = getItemTarget(item);
                        const Icon = item.icon;

                        return (
                            <li key={item.id}>
                                <Link
                                    href={item.href}
                                    onClick={(event) => {
                                        if (!settingsTab) return;
                                        event.preventDefault();
                                        openSettingsCenter(settingsTab);
                                    }}
                                    className={`flex h-14 w-full flex-col items-center justify-center transition-colors duration-200 ${isActive ? 'text-accent' : 'text-foreground-secondary'}`}
                                    aria-current={isActive ? 'page' : undefined}
                                >
                                    <Icon className="h-5 w-5" />
                                    <span className="mt-1 text-[10px] font-medium">{item.label}</span>
                                </Link>
                            </li>
                        );
                    })}

                    {/* 更多按钮 */}
                    <li>
                        <button
                            ref={moreButtonRef}
                            type="button"
                            onClick={() => setIsDrawerOpen(true)}
                            className="flex h-14 w-full flex-col items-center justify-center text-foreground-secondary transition-colors duration-200"
                            aria-label="展开更多功能"
                            aria-haspopup="dialog"
                            aria-expanded={isDrawerOpen}
                        >
                            <Plus className="h-5 w-5" />
                            <span className="mt-1 text-[10px] font-medium">更多</span>
                        </button>
                    </li>
                </ul>
            </nav>
        </>
    );
}
