/**
 * 对话页侧栏（设计稿“对话与导航”）：新对话、搜索、对话 / 命盘 / 命理记录、
 * 按日期分组的对话列表（含 Agent 任务标记）与账户。收起后是 60px 图标导轨；
 * 任务工作区打开时自动收起，关闭后恢复用户自己的选择。手机抽屉复用同一面板。
 *
 * 'use client' 标记说明：
 * - 需要路由、折叠状态、任务状态轮询与交互事件
 */
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { BookOpen, LogIn, MessageSquare, PanelLeft, Plus, Search, X } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { AnnouncementBellButton } from '@/components/layout/AnnouncementBellButton';
import { SidebarConversations } from '@/components/layout/SidebarConversations';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { collapseChatSidebar, expandChatSidebar, useChatSidebarCollapsed } from '@/lib/chat/chat-sidebar';
import type { ConversationAgentMarker } from '@/lib/agent/activity';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';
import './chat-sidebar.css';

const CHARTS_HREF = getSettingsCenterRouteTarget('charts');
const noSubscription = () => () => {};
const getSearchShortcut = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K');
const getServerSearchShortcut = () => '⌘K';

/** 命盘 mark from the design: a circle divided by the yin-yang curve. */
function ChartIcon({ size }: { size: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9" /><circle cx="12" cy="7.5" r="1" /><circle cx="12" cy="16.5" r="1" />
        </svg>
    );
}

/** The conversation on screen: only /chat has one. */
function useViewingConversation() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const onChat = pathname === '/chat';
    return { onChat, conversationId: onChat ? searchParams.get('id') : null };
}

export function ChatSidebar() {
    return (
        <Suspense fallback={<nav className="chat-nav" aria-label="对话与导航" />}>
            <ChatSidebarInner />
        </Suspense>
    );
}

function ChatSidebarInner() {
    const { user } = useSessionSafe();
    const collapsed = useChatSidebarCollapsed();
    const desktop = useIsDesktopLayout();
    const { conversationId } = useViewingConversation();
    const [showAuthModal, setShowAuthModal] = useState(false);
    const markers = useAgentActivity(user?.id ?? null, conversationId, desktop);
    const login = useCallback(() => setShowAuthModal(true), []);

    return (
        <>
            {collapsed ? <ChatSidebarRail markers={markers} onLogin={login} />
                : <nav className="chat-nav" aria-label="对话与导航"><ChatSidebarPanel markers={markers} onLogin={login} /></nav>}
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
}

function useSidebarActions() {
    const router = useRouter();
    const { handleNewChat } = useConversationList();
    const startNewChat = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
        // Modified clicks open /chat in a new tab as a plain link would.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        void handleNewChat().then(() => router.push('/chat'));
    }, [handleNewChat, router]);
    const openSearch = useCallback(() => { window.dispatchEvent(new Event('taibu:search')); }, []);
    return { startNewChat, openSearch };
}

function LoginButton({ rail, onLogin }: { rail: boolean; onLogin: () => void }) {
    return (
        <button type="button" className={rail ? 'chat-rail-button' : 'chat-nav-login'} aria-label={rail ? '登录' : undefined} title={rail ? '登录' : undefined} onClick={onLogin}>
            <LogIn size={rail ? 19 : 16} aria-hidden="true" />{rail ? null : <span>登录</span>}
        </button>
    );
}

/** 60px icon rail; its 对话 button carries a dot for answers or questions waiting in other conversations. */
function ChatSidebarRail({ markers, onLogin }: { markers: ReadonlyMap<string, ConversationAgentMarker>; onLogin: () => void }) {
    const { user } = useSessionSafe();
    const { isFeatureEnabled } = useFeatureToggles();
    const { onChat, conversationId } = useViewingConversation();
    const { startNewChat, openSearch } = useSidebarActions();
    const shortcut = useSyncExternalStore(noSubscription, getSearchShortcut, getServerSearchShortcut);
    const waiting = [...markers].some(([id, marker]) => marker !== 'running' && id !== conversationId);
    return (
        <nav className="chat-nav is-rail" aria-label="主导航">
            <Link href="/" className="chat-rail-logo" aria-label="太卜首页">卜</Link>
            <Link href="/chat" className="chat-rail-button" aria-label="新建对话" title="新建对话" aria-current={onChat && !conversationId ? 'page' : undefined} onClick={startNewChat}>
                <Plus size={20} aria-hidden="true" />
            </Link>
            <button type="button" className="chat-rail-button" aria-label="搜索对话" title={`搜索对话 ${shortcut}`} onClick={openSearch}>
                <Search size={19} aria-hidden="true" />
            </button>
            <button type="button" className="chat-rail-button" aria-label={waiting ? '对话，有任务等待查看' : '对话'} title="对话" aria-current={conversationId ? 'true' : undefined} onClick={expandChatSidebar}>
                <MessageSquare size={19} aria-hidden="true" />
                {waiting ? <span className="chat-rail-dot" aria-hidden="true" /> : null}
            </button>
            {isFeatureEnabled('charts') ? <Link href={CHARTS_HREF} className="chat-rail-button" aria-label="命盘" title="命盘"><ChartIcon size={19} /></Link> : null}
            {isFeatureEnabled('records') ? <Link href="/records" className="chat-rail-button" aria-label="命理记录" title="命理记录"><BookOpen size={19} aria-hidden="true" /></Link> : null}
            <div className="chat-rail-spacer" />
            <AnnouncementBellButton className="chat-rail-button" iconSize={19} />
            <button type="button" className="chat-rail-button" aria-label="展开侧栏" title="展开侧栏" onClick={expandChatSidebar}>
                <PanelLeft size={19} aria-hidden="true" />
            </button>
            {user ? <SidebarUserCard user={user} appearance="account" collapsed /> : <LoginButton rail onLogin={onLogin} />}
        </nav>
    );
}

/**
 * The full sidebar: brand, entries, dated conversations and account. In the
 * phone drawer it closes instead of folding, and any link or entry that
 * leaves the drawer's view closes it too.
 */
export function ChatSidebarPanel({ markers, onLogin, onClose, heading }: {
    markers: ReadonlyMap<string, ConversationAgentMarker>;
    onLogin: () => void;
    /** Present in the drawer: replaces 收起侧栏 and runs after navigating. */
    onClose?: () => void;
    /** Names the drawer dialog. */
    heading?: ReactNode;
}) {
    const { user } = useSessionSafe();
    const { isFeatureEnabled } = useFeatureToggles();
    const { onChat, conversationId } = useViewingConversation();
    const { startNewChat, openSearch } = useSidebarActions();
    const shortcut = useSyncExternalStore(noSubscription, getSearchShortcut, getServerSearchShortcut);
    const listRef = useRef<HTMLDivElement>(null);
    const showConversations = useCallback(() => { listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
    const search = useCallback(() => { onClose?.(); openSearch(); }, [onClose, openSearch]);
    const login = useCallback(() => { onClose?.(); onLogin(); }, [onClose, onLogin]);
    // Links navigate away from what the drawer covers; buttons (menus, the list) keep it open.
    const closeOnLink = onClose && ((event: MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest('a[href]')) onClose();
    });

    return (
        <div className="chat-nav-panel" onClick={closeOnLink}>
            <div className="chat-nav-brand">
                <Link href="/" className="chat-nav-home" aria-label="太卜首页">
                    <span className="chat-nav-logo" aria-hidden="true">卜</span>
                    <span className="chat-nav-name">太卜</span>
                </Link>
                {heading}
                <AnnouncementBellButton className="chat-nav-icon" iconSize={18} />
                {onClose ? <button type="button" className="chat-nav-icon" aria-label="关闭聊天列表" title="关闭" onClick={onClose}>
                    <X size={18} aria-hidden="true" />
                </button> : <button type="button" className="chat-nav-icon" aria-label="收起侧栏" title="收起侧栏" onClick={collapseChatSidebar}>
                    <PanelLeft size={18} aria-hidden="true" />
                </button>}
            </div>
            <Link href="/chat" className="chat-nav-link is-new" aria-current={onChat && !conversationId ? 'page' : undefined} onClick={startNewChat}>
                <span className="chat-nav-new-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.6} /></span>新对话
            </Link>
            <button type="button" className="chat-nav-link" onClick={search}>
                <Search size={18} aria-hidden="true" />搜索对话{onClose ? null : <kbd>{shortcut}</kbd>}
            </button>
            <button type="button" className="chat-nav-link" aria-current={conversationId ? 'true' : undefined} onClick={showConversations}>
                <MessageSquare size={18} aria-hidden="true" />对话
            </button>
            {isFeatureEnabled('charts') ? <Link href={CHARTS_HREF} className="chat-nav-link"><ChartIcon size={18} />命盘</Link> : null}
            {isFeatureEnabled('records') ? <Link href="/records" className="chat-nav-link"><BookOpen size={18} aria-hidden="true" />命理记录</Link> : null}
            <div ref={listRef} className="chat-nav-list" data-conversation-scroll="true">
                {user ? <SidebarConversations grouping="date" markers={markers} withinModal={Boolean(onClose)} /> : <p className="chat-nav-hint">登录后在这里查看对话与任务进度。</p>}
            </div>
            <div className="chat-nav-footer">{user ? <SidebarUserCard user={user} appearance="account" collapsed={false} /> : <LoginButton rail={false} onLogin={login} />}</div>
        </div>
    );
}
