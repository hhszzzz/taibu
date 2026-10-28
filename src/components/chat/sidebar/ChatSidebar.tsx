/**
 * 手机抽屉的对话侧栏面板（设计稿“对话与导航”）：新对话、搜索、对话 / 命盘 /
 * 命理记录、按日期分组的对话列表（含 Agent 任务标记）与账户。桌面端由全站
 * Sidebar 呈现（/chat 的「最近」列表见 ChatSidebarConversations）。
 *
 * 'use client' 标记说明：
 * - 需要路由、搜索快捷键与交互事件
 */
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { BookOpen, LogIn, MessageSquare, PanelLeft, Plus, Search, X } from 'lucide-react';
import { AnnouncementBellButton } from '@/components/layout/AnnouncementBellButton';
import { ModeSwitch } from '@/components/chat/ModeSwitch';
import { BrandMark } from '@/components/brand/BrandMark';
import { SidebarConversations } from '@/components/layout/SidebarConversations';
import { SidebarUserCard } from '@/components/layout/UserMenu';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { collapseChatSidebar } from '@/lib/chat/chat-sidebar';
import type { ConversationAgentMarker } from '@/lib/agent/activity';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
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
                    <BrandMark className="chat-nav-logo" />
                    <span className="chat-nav-name">太卜</span>
                </Link>
                {heading}
                <ModeSwitch />
                {onClose ? <button type="button" className="chat-nav-icon" aria-label="关闭聊天列表" title="关闭" onClick={onClose}>
                    <X size={18} aria-hidden="true" />
                </button> : <button type="button" className="chat-nav-icon" aria-label="收起侧栏" title="收起侧栏" onClick={collapseChatSidebar}>
                    <PanelLeft size={18} aria-hidden="true" />
                </button>}
            </div>
            <button type="button" className="chat-nav-link chat-nav-search" onClick={search}>
                <Search size={16} aria-hidden="true" />搜索对话{onClose ? null : <kbd>{shortcut}</kbd>}
            </button>
            <Link href="/chat" className="chat-nav-link is-new" aria-current={onChat && !conversationId ? 'page' : undefined} onClick={startNewChat}>
                <span className="chat-nav-new-icon" aria-hidden="true"><Plus size={16} strokeWidth={2} /></span>新对话
            </Link>
            <button type="button" className="chat-nav-link" aria-current={conversationId ? 'true' : undefined} onClick={showConversations}>
                <MessageSquare size={18} aria-hidden="true" />对话
            </button>
            {isFeatureEnabled('charts') ? <Link href={CHARTS_HREF} className="chat-nav-link"><ChartIcon size={18} />命盘</Link> : null}
            {isFeatureEnabled('records') ? <Link href="/records" className="chat-nav-link"><BookOpen size={18} aria-hidden="true" />命理记录</Link> : null}
            {user ? <div className="chat-recents-head"><span>最近使用</span></div> : null}
            <div ref={listRef} className="chat-nav-list" data-conversation-scroll="true">
                {user ? <SidebarConversations grouping="date" markers={markers} withinModal={Boolean(onClose)} /> : <p className="chat-nav-hint">登录后在这里查看对话与任务进度。</p>}
            </div>
            <div className="chat-nav-footer">{user ? (
                <div className="chat-nav-footer-row">
                    <div className="min-w-0 flex-1"><SidebarUserCard user={user} appearance="account" collapsed={false} /></div>
                    <AnnouncementBellButton className="chat-nav-icon" iconSize={18} />
                </div>
            ) : <LoginButton rail={false} onLogin={login} />}</div>
        </div>
    );
}
