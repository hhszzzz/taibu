/**
 * 客户端 Providers 包装组件
 * 
 * 将需要客户端状态的 Provider 集中在一起
 */
'use client';

import { ReactNode, useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionContext, type SessionState } from '@/lib/hooks/session-context';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { ChatTaskToastBridge } from '@/components/providers/ChatTaskToastBridge';
import { AnnouncementPopupHost } from '@/components/providers/AnnouncementPopupHost';
import { authSessionCacheConstants, supabase } from '@/lib/auth';
import { getLinuxDoAuthErrorMessage } from '@/lib/auth-feedback';
import { createAppQueryClient, registerBrowserQueryClient } from '@/lib/query/client';
import { invalidateQueriesForPath } from '@/lib/query/invalidation';

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
    const [state, setState] = useState<SessionState>({
        session: null,
        user: null,
        loading: true,
    });

    useEffect(() => {
        registerBrowserQueryClient(queryClient);
    }, [queryClient]);

    useEffect(() => {
        let isMounted = true;
        let lastForcedSyncAt = 0;

        const syncSessionFromServer = async (force = false) => {
            const result = force
                ? await supabase.auth.revalidateSession()
                : await supabase.auth.getSession();
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
                    user: session?.user ?? null,
                    loading: false,
                };
            });
        };

        void syncSessionFromServer();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!isMounted) return;
            setState({
                session,
                user: session?.user ?? null,
                loading: false,
            });
            if (event !== 'INITIAL_SESSION') {
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
            subscription.unsubscribe();
        };
    }, []);

    return (
        <ToastProvider>
            <QueryClientProvider client={queryClient}>
                <AuthCallbackFeedback />
                <ChatTaskToastBridge />
                <SessionContext.Provider value={state}>
                    <AnnouncementPopupHost userId={state.user?.id ?? null} authLoading={state.loading}>
                        {children}
                    </AnnouncementPopupHost>
                </SessionContext.Provider>
            </QueryClientProvider>
        </ToastProvider>
    );
}
