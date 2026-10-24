'use client';

// 需要 React Context，在基础 hooks 与应用 Provider 之间共享会话快照。
import { createContext, useContext } from 'react';
import type { AuthUser, Session } from '@/lib/auth';

export type SessionState = {
    session: Session | null;
    user: AuthUser | null;
    loading: boolean;
};

export const SessionContext = createContext<SessionState | undefined>(undefined);

export function useSessionSafe(): SessionState {
    return useContext(SessionContext) ?? { session: null, user: null, loading: false };
}
