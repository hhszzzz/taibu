import { NextRequest } from 'next/server';
import { getAuthContext, jsonOk } from '@/lib/api-utils';
import { readFeatureTogglesState } from '@/lib/app-settings';
import { getNotificationRetentionCutoffIso } from '@/lib/notification-server';
import { buildMembershipInfo, type MembershipInfo, type MembershipInfoSource } from '@/lib/user/membership';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import type { AppBootstrapData, AppBootstrapViewerSummary } from '@/lib/app/bootstrap';

type UserRow = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  is_admin: boolean | null;
  membership: MembershipInfoSource['membership'];
  membership_expires_at: string | null;
  ai_chat_count: number | null;
};

function buildViewerSummary(row: UserRow, membership: MembershipInfo): AppBootstrapViewerSummary {
  return {
    userId: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    isAdmin: !!row.is_admin,
    membershipType: membership.type,
    membershipExpiresAt: membership.expiresAt ? membership.expiresAt.toISOString() : null,
    aiChatCount: membership.aiChatCount,
  };
}

async function loadViewerProfile(auth: Awaited<ReturnType<typeof getAuthContext>>) {
  const profileResult = await auth.db
    .from('users')
    .select('id, nickname, avatar_url, is_admin, membership, membership_expires_at, ai_chat_count')
    .eq('id', auth.user!.id)
    .maybeSingle();

  if (profileResult.error || profileResult.data || !auth.user) {
    return profileResult;
  }

  const ensured = await ensureUserRecordRow(auth.scoped, auth.user);
  if (!ensured.ok) {
    return {
      data: null,
      error: ensured.error,
    };
  }

  return await auth.db
    .from('users')
    .select('id, nickname, avatar_url, is_admin, membership, membership_expires_at, ai_chat_count')
    .eq('id', auth.user.id)
    .maybeSingle();
}

async function loadViewerState(auth: Awaited<ReturnType<typeof getAuthContext>>) {
  if (auth.authError) {
    return {
      viewerLoaded: false,
      viewerSummary: null,
      viewerErrorMessage: auth.authError.message,
      membership: null,
      unreadCount: 0,
      unreadCountLoaded: false,
    };
  }

  if (!auth.user) {
    return {
      viewerLoaded: true,
      viewerSummary: null,
      viewerErrorMessage: null,
      membership: null,
      unreadCount: 0,
      unreadCountLoaded: true,
    };
  }

  const [profileResult, unreadResult] = await Promise.all([
    loadViewerProfile(auth),
    auth.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .gte('created_at', getNotificationRetentionCutoffIso())
      .eq('is_read', false),
  ]);

  if (profileResult.error) {
    return {
      viewerLoaded: false,
      viewerSummary: null,
      viewerErrorMessage: '加载账户状态失败',
      membership: null,
      unreadCount: unreadResult.count ?? 0,
      unreadCountLoaded: !unreadResult.error,
    };
  }

  const row = (profileResult.data ?? null) as UserRow | null;
  if (!row || typeof row.ai_chat_count !== 'number' || Number.isNaN(row.ai_chat_count)) {
    return {
      viewerLoaded: false,
      viewerSummary: null,
      viewerErrorMessage: '加载账户状态失败',
      membership: null,
      unreadCount: unreadResult.count ?? 0,
      unreadCountLoaded: !unreadResult.error,
    };
  }

  const membership = buildMembershipInfo({
    membership: row.membership,
    membership_expires_at: row.membership_expires_at,
    ai_chat_count: row.ai_chat_count,
  });
  const viewerSummary = buildViewerSummary(row, membership);

  return {
    viewerLoaded: true,
    viewerSummary,
    viewerErrorMessage: null,
    membership,
    unreadCount: unreadResult.count ?? 0,
    unreadCountLoaded: !unreadResult.error,
  };
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);

  const [featureToggleState, viewerState] = await Promise.all([
    readFeatureTogglesState(),
    loadViewerState(auth),
  ]);

  const data: AppBootstrapData = {
    viewerLoaded: viewerState.viewerLoaded,
    viewerSummary: viewerState.viewerSummary,
    viewerErrorMessage: viewerState.viewerErrorMessage,
    membership: viewerState.membership,
    featureToggles: featureToggleState.toggles,
    featureTogglesLoaded: featureToggleState.loaded,
    featureTogglesErrorMessage: featureToggleState.loaded ? null : '功能状态加载失败',
    unreadCount: viewerState.unreadCount,
    unreadCountLoaded: viewerState.unreadCountLoaded,
  };

  const hasPartialFailure = !!data.viewerErrorMessage
    || !data.featureTogglesLoaded
    || !data.unreadCountLoaded;

  return jsonOk({ data }, hasPartialFailure ? 207 : 200);
}
