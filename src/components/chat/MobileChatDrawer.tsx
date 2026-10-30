/**
 * 移动端导航抽屉：对话页标题栏左侧的 ≡ 打开，内容与桌面对话侧栏相同
 * （新对话、搜索、命盘、命理记录、按日期分组的对话与任务标记、账户）。
 *
 * 'use client' 标记说明：
 * - 需要抽屉开关状态与任务状态轮询
 */
'use client';

import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/auth/AuthModal';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { ChatSidebarPanel } from '@/components/chat/sidebar/ChatSidebar';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';

export function MobileChatDrawer() {
    const { triggerConversationListLoad } = useConversationList();
    const [open, setOpen] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const close = useCallback(() => setOpen(false), []);
    const login = useCallback(() => setShowAuthModal(true), []);

    return (
        <>
            <Button unstyled ref={triggerRef} type="button" className="chat-nav-trigger" aria-label="打开聊天列表" aria-haspopup="dialog" aria-expanded={open}
                onClick={() => { setOpen(true); triggerConversationListLoad(); }}>
                <Menu size={20} aria-hidden="true" />
            </Button>
            <Dialog bare open={open} onClose={close} returnFocusRef={triggerRef} labelledBy={titleId} className="chat-conversation-drawer">
                <Suspense fallback={null}>
                    <DrawerPanel titleId={titleId} onClose={close} onLogin={login} />
                </Suspense>
            </Dialog>
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
}

/** Mounted only while the drawer is open, so task markers are read only then. */
function DrawerPanel({ titleId, onClose, onLogin }: { titleId: string; onClose: () => void; onLogin: () => void }) {
    const { user } = useSessionSafe();
    const pathname = usePathname();
    const params = useSearchParams();
    const conversationId = params.get('id');
    const markers = useAgentActivity(user?.id ?? null, conversationId);
    // A link inside the drawer may stop the click before it reaches the panel; the committed route still closes it.
    const routeKey = `${pathname}?${params.toString()}`;
    const previousRoute = useRef(routeKey);
    useEffect(() => {
        if (previousRoute.current === routeKey) return;
        previousRoute.current = routeKey;
        onClose();
    }, [onClose, routeKey]);
    return <ChatSidebarPanel markers={markers} onClose={onClose} onLogin={onLogin} heading={<h2 id={titleId} className="sr-only">聊天列表</h2>} />;
}
