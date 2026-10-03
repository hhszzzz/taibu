'use client';

import { useCallback } from 'react';
import { useSessionSafe } from '@/lib/hooks/session-context';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';

export function useSessionMembership() {
  const { session, user, loading: sessionLoading } = useSessionSafe();
  const bootstrap = useAppBootstrap();
  const membershipResolved = !user || bootstrap.viewerStateResolved;

  const refreshMembership = useCallback(async () => {
    const nextBootstrap = await bootstrap.refresh();
    return nextBootstrap.viewerLoaded ? nextBootstrap.membership : null;
  }, [bootstrap]);

  return {
    session,
    user,
    userId: user?.id ?? null,
    sessionLoading,
    membershipInfo: bootstrap.viewerStateLoaded ? bootstrap.data.membership : null,
    membershipLoading: sessionLoading || (!!user && !bootstrap.viewerStateResolved),
    membershipResolved,
    refreshMembership,
  };
}
