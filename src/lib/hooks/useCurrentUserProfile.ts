'use client';

import { useCallback } from 'react';
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
    membership: bootstrap.viewerSummary.membershipType,
    membership_expires_at: bootstrap.viewerSummary.membershipExpiresAt,
    ai_chat_count: bootstrap.viewerSummary.aiChatCount,
  };
}

export function useCurrentUserProfile(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { user, loading: sessionLoading } = useSessionSafe();
  const bootstrap = useAppBootstrap({ enabled });
  const profile = toUserProfile(bootstrap.data);
  const profileResolved = bootstrap.viewerStateResolved;

  const refresh = useCallback(async () => {
    await bootstrap.refresh();
  }, [bootstrap]);

  return {
    profile: user ? profile : null,
    loading: enabled ? sessionLoading || (!!user && !bootstrap.viewerStateResolved) : false,
    resolved: profileResolved,
    error: bootstrap.viewerStateError,
    refresh,
  };
}
