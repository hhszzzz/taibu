/**
 * 客户端 Providers 包装组件
 * 
 * 将需要客户端状态的 Provider 集中在一起
 */
'use client';

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionContext, type SessionState } from '@/lib/hooks/session-context';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ChatTaskToastBridge } from '@/components/providers/ChatTaskToastBridge';
import { AnnouncementPopupHost } from '@/components/providers/AnnouncementPopupHost';
import { authSessionCacheConstants, getSessionSnapshot, revalidateBrowserSession, subscribeToAuth } from '@/lib/auth';
import { getLinuxDoAuthErrorMessage } from '@/lib/auth-feedback';
import { createAppQueryClient, registerBrowserQueryClient } from '@/lib/query/client';
import { invalidateQueriesForPath } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/keys';
import dynamic from 'next/dynamic';
import { AgentNotificationBridge } from './AgentNotificationBridge';
import { AgentActivityProvider } from '@/lib/agent/use-agent-activity';
import { useIconHoverMotion } from '@/lib/motion/icon-hover';
const ConversationSearchHost = dynamic(() => import('./ConversationSearchHost').then(module => module.ConversationSearchHost), { ssr: false });

interface ClientProvidersProps {
    children: ReactNode;
}

// 保留现有 UI 调用方的兼容入口；基础 hooks 直接依赖会话模块。
export { useSessionSafe } from '@/lib/hooks/session-context';

function AuthCallbackFeedback() {
    const { showToast } = useToast();

    useEffect(() => {
        const url = new URL(window.location.href);
        const errorCode = url.searchParams.get('error');
        const message = getLinuxDoAuthErrorMessage(errorCode);

        if (!message) {
            return;
        }

        showToast('error', message, 5000);
        url.searchParams.delete('error');

        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState(window.history.state, '', nextUrl || '/');
    }, [showToast]);

    return null;
}

export function ClientProviders({ children }: ClientProvidersProps) {
    const [queryClient] = useState(() => createAppQueryClient());
    useIconHoverMotion();
    const [state, setState] = useState<SessionState>({
        session: null,
        user: null,
        loading: true,
    });

    const chartOwner = useRef<string | null>(null);
    useLayoutEffect(() => {
        const previous = chartOwner.current;
        chartOwner.current = state.user?.id ?? null;
        if (previous && previous !== chartOwner.current) {
            const filter = { queryKey: queryKeys.userCharts(previous), exact: true };
            // One owner handles account eviction; ordinary consumer unmounts keep shared data.
            // Cancel/remove synchronously so a later account transition cannot evict a new read.
            void queryClient.cancelQueries(filter);
            queryClient.removeQueries(filter);
        }
    }, [queryClient, state.user?.id]);

    useEffect(() => {
        registerBrowserQueryClient(queryClient);
    }, [queryClient]);

    useEffect(() => {
        let isMounted = true;
        let lastForcedSyncAt = 0;

        const syncSessionFromServer = async (force = false) => {
            const result = force
                ? await revalidateBrowserSession()
                : await getSessionSnapshot();
            if (!isMounted) return;
            setState((current) => {
                const session = result.data.session;
                if (result.error && !session) {
                    return {
                        ...current,
                        loading: false,
                    };
                }

                return {
                    session,
                    user: result.data.user,
                    loading: false,
                };
            });
        };

        void syncSessionFromServer();

        const unsubscribe = subscribeToAuth((event, { session, user }) => {
            if (!isMounted) return;
            setState({
                session,
                user,
                loading: false,
            });
            if (event !== 'initial') {
                invalidateQueriesForPath('/api/auth');
            }
        });

        const handleForcedSync = () => {
            const now = Date.now();
            if ((now - lastForcedSyncAt) < authSessionCacheConstants.SESSION_REVALIDATE_EVENT_COOLDOWN_MS) {
                return;
            }
            lastForcedSyncAt = now;
            void syncSessionFromServer(true);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                handleForcedSync();
            }
        };

        window.addEventListener('focus', handleForcedSync);
        window.addEventListener('pageshow', handleForcedSync);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMounted = false;
            window.removeEventListener('focus', handleForcedSync);
            window.removeEventListener('pageshow', handleForcedSync);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            unsubscribe();
        };
    }, []);

    return (
        <ToastProvider>
            <TooltipProvider>
                <QueryClientProvider client={queryClient}>
                    <AuthCallbackFeedback />
                    <ChatTaskToastBridge />
                    <SessionContext.Provider value={state}>
                        <ConversationSearchHost userId={state.user?.id ?? null} />
                        <AgentNotificationBridge userId={state.user?.id ?? null} />
                        <AgentActivityProvider userId={state.user?.id ?? null}>
                            <AnnouncementPopupHost userId={state.user?.id ?? null} authLoading={state.loading}>
                                {children}
                            </AnnouncementPopupHost>
                        </AgentActivityProvider>
                    </SessionContext.Provider>
                </QueryClientProvider>
            </TooltipProvider>
        </ToastProvider>
    );
}
