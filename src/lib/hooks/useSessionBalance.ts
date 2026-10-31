'use client';

import { useCallback } from 'react';
import { useSessionSafe } from '@/lib/hooks/session-context';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';

export function useSessionBalance() {
  const { session, user, loading: sessionLoading } = useSessionSafe();
  const bootstrap = useAppBootstrap();
  const balanceResolved = !user || bootstrap.viewerStateResolved;

  const refreshBalance = useCallback(async () => {
    const nextBootstrap = await bootstrap.refresh();
    return nextBootstrap.viewerLoaded ? nextBootstrap.billing : null;
  }, [bootstrap]);

  return {
    session,
    user,
    userId: user?.id ?? null,
    sessionLoading,
    balance: bootstrap.viewerStateLoaded ? bootstrap.data.billing : null,
    balanceLoading: sessionLoading || (!!user && !bootstrap.viewerStateResolved),
    balanceResolved,
    refreshBalance,
  };
}
