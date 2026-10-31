'use client';

import { useCallback, useMemo } from 'react';
import { useSessionSafe } from '@/lib/hooks/session-context';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';
import type { UserProfile } from '@/lib/user/profile';

function toUserProfile(bootstrap: ReturnType<typeof useAppBootstrap>['data']): UserProfile | null {
  if (!bootstrap.viewerSummary) {
    return null;
  }

  return {
    id: bootstrap.viewerSummary.userId,
    nickname: bootstrap.viewerSummary.nickname,
    avatar_url: bootstrap.viewerSummary.avatarUrl,
    is_admin: bootstrap.viewerSummary.isAdmin,
  };
}

export function useCurrentUserProfile(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { user, loading: sessionLoading } = useSessionSafe();
  const bootstrap = useAppBootstrap({ enabled });
  const profile = useMemo(() => toUserProfile(bootstrap.data), [bootstrap.data]);
  const profileResolved = bootstrap.viewerStateResolved;

  const refreshBootstrap = bootstrap.refresh;
  const refresh = useCallback(async () => {
    await refreshBootstrap();
  }, [refreshBootstrap]);

  return {
    profile: user ? profile : null,
    /** Wallet plus what subscriptions still hold; null until the viewer state loads. */
    balance: user && bootstrap.viewerStateLoaded ? bootstrap.data.billing : null,
    loading: enabled ? sessionLoading || (!!user && !bootstrap.viewerStateResolved) : false,
    resolved: profileResolved,
    error: bootstrap.viewerStateError,
    refresh,
  };
}
