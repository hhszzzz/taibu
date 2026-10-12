/**
 * 左侧导航栏组件
 *
 * 设计说明：
 * - 包含所有命理体系入口（八字、紫微、塔罗等）
 * - AI 区域下方内嵌对话列表（新聊天/搜索/对话列表）
 * - 桌面端显示在左侧，移动端隐藏（使用 MobileNav 代替）
 * - 侧边栏固定展开，顶部入口改为公告中心
 * - 底部包含用户信息
 */
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { useState, useMemo, Suspense } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { SidebarConversations } from '@/components/layout/SidebarConversations';
import { AnnouncementBellButton } from '@/components/layout/AnnouncementBellButton';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getSidebarNavItems, getSidebarToolItems } from '@/lib/navigation/registry';
import { useConversationList } from '@/lib/chat/ConversationListContext';

// Derive from registry once at module level
const navItems = getSidebarNavItems();
const toolItems = getSidebarToolItems();

export function Sidebar() {
    return (
        <Suspense fallback={<SidebarSkeleton />}>
            <SidebarInner />
        </Suspense>
    );
}

function SidebarSkeleton() {
    return (
        <aside className="
            hidden lg:flex flex-col h-screen sticky top-0 z-20
            bg-background-secondary border-r border-border
            transition-all duration-150 ease-in-out
            w-[var(--sidebar-width)]
        ">
            <div className="flex items-center h-16 px-4 border-b border-border justify-between">
                <Link href="/" className="flex items-center gap-2 min-w-0">
                    <Image src="/Logo.svg" alt="太卜 Logo" width={28} height={28} className="rounded-md flex-shrink-0 dark:invert" />
                    <span className="font-bold text-base text-foreground dark:text-foreground whitespace-nowrap">太卜</span>
                </Link>
                <div className="w-8 h-8 rounded-md bg-background-secondary dark:bg-white/10 animate-pulse" />
            </div>
            <div className="flex-1 py-4 px-2 space-y-3">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div key={index} className="rounded-md bg-background-secondary dark:bg-white/10 animate-pulse h-10 w-full" />
                ))}
            </div>
        </aside>
    );
}

function SidebarLoadError({ onRetry }: { onRetry: () => void }) {
    return (
        <aside className="
            hidden lg:flex flex-col h-screen sticky top-0 z-20
            bg-background-secondary border-r border-border
            w-[var(--sidebar-width)]
        ">
            <div className="flex items-center h-16 px-4 border-b border-border">
                <Link href="/" className="flex items-center gap-2 min-w-0">
                    <Image src="/Logo.svg" alt="太卜 Logo" width={28} height={28} className="rounded-md flex-shrink-0 dark:invert" />
                    <span className="font-bold text-base text-foreground dark:text-foreground whitespace-nowrap">太卜</span>
                </Link>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-sm text-foreground-secondary dark:text-foreground-secondary">导航状态加载失败</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-md bg-accent px-3 py-2 text-sm text-on-accent transition-colors hover:bg-accent-hover"
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
    const isNavLoading = featureLoading;

    // 当前是否在具体某个对话中
    const activeConvId = searchParams.get('id');

    // 根据 feature toggle 过滤导航项
    const filteredNavItems = useMemo(() => navItems
        .filter((item) => isFeatureEnabled(item.id)), [isFeatureEnabled]);

    const chatItem = useMemo(() => toolItems
        .find((item) => item.id === 'chat' && isFeatureEnabled('chat')), [isFeatureEnabled]);

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
            <aside
                className="
                    hidden lg:flex flex-col h-screen sticky top-0 z-20
                    bg-background-secondary border-r border-border
                    transition-all duration-150 ease-in-out
                    w-[var(--sidebar-width)]
                "
            >
                <div className="flex items-center h-16 px-4 border-b border-border justify-between transition-all duration-150 flex-shrink-0">
                    <Link href="/" className="flex items-center gap-2 min-w-0">
                        <Image
                            src="/Logo.svg"
                            alt="太卜 Logo"
                            width={28}
                            height={28}
                            className="rounded-md flex-shrink-0 dark:invert"
                        />
                        <span className="font-bold text-base text-foreground dark:text-foreground whitespace-nowrap">
                            太卜
                        </span>
                    </Link>
                    <AnnouncementBellButton className="relative p-1.5 rounded-md flex-shrink-0 transition-all duration-150 text-foreground-secondary dark:text-foreground-secondary hover:bg-background-secondary dark:hover:bg-white/8 hover:text-foreground dark:hover:text-foreground" />
                </div>

                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="pt-4 px-2 flex-shrink-0 border-b border-border/60">
                        <div className="px-3 text-[11px] font-semibold text-foreground-secondary dark:text-foreground-secondary uppercase tracking-wider mb-1">
                            命理体系
                        </div>
                        <ul className="space-y-0.5">
                            {filteredNavItems.map((item) => {
                                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                                const Icon = item.icon;

                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className={`
                                                flex items-center px-3 gap-2 py-1.5 rounded-md
                                                transition-colors duration-150
                                                ${isActive
                                                    ? 'bg-accent-light text-accent'
                                                    : 'text-foreground-secondary hover:bg-background-tertiary'
                                                }
                                            `}
                                        >
                                            <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? 'text-foreground dark:text-foreground' : 'text-foreground/70 dark:text-foreground/70'}`} />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium truncate">{item.label}</div>
                                            </div>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <nav className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10 px-2">
                        {chatItem && (
                            <div>
                                <div className="sticky top-0 z-30 bg-background-secondary px-3 pt-3 pb-1.5 text-[11px] font-semibold text-foreground-secondary dark:text-foreground-secondary uppercase tracking-wider">
                                    AI
                                </div>
                                <ul className="space-y-0.5">
                                    <li>
                                        <Link
                                            href={chatItem.href}
                                            className={`flex items-center px-3 gap-2 py-1.5 rounded-md transition-colors duration-150 ${pathname === chatItem.href && !activeConvId ? 'bg-accent-light text-accent' : 'text-foreground-secondary hover:bg-background-tertiary'}`}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                handleNewChat().then(() => router.push('/chat'));
                                            }}
                                        >
                                            <chatItem.icon className="w-4.5 h-4.5 flex-shrink-0 text-foreground/70 dark:text-foreground/70" />
                                            <span className="text-sm font-medium whitespace-nowrap">{chatItem.label}</span>
                                        </Link>
                                        {user ? <SidebarConversations /> : null}
                                    </li>
                                </ul>
                            </div>
                        )}

                        {filteredToolItems.length > 0 && <div className="sticky top-0 z-20 bg-background-secondary px-3 pt-3 pb-1.5 text-[11px] font-semibold text-foreground-secondary dark:text-foreground-secondary uppercase tracking-wider">工具</div>}
                        <ul className="space-y-0.5">
                            {filteredToolItems.map((item) => {
                                const isActive = pathname === item.href;
                                const Icon = item.icon;

                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className={`
                                                flex items-center px-3 gap-2 py-1.5 rounded-md
                                                transition-colors duration-150
                                                ${isActive
                                                    ? 'bg-accent-light text-accent'
                                                    : 'text-foreground-secondary hover:bg-background-tertiary'
                                                }
                                            `}
                                        >
                                            <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? 'text-foreground dark:text-foreground' : 'text-foreground/70 dark:text-foreground/70'}`} />
                                            <span className="text-sm font-medium whitespace-nowrap">
                                                {item.label}
                                            </span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>
                </div>

                <div className="border-t border-border p-2 flex-shrink-0">
                    {user ? (
                        <SidebarUserCard user={user} />
                    ) : (
                        <button
                            onClick={() => setShowAuthModal(true)}
                            className="
                                flex items-center gap-1.5 px-3 py-2 justify-center rounded-md w-full
                                text-sm font-medium
                                bg-accent text-on-accent
                                hover:bg-accent/90 active:bg-accent-hover
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
