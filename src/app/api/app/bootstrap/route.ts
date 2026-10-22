import { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getAuthContext, jsonOk } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
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

const PROFILE_COLUMNS = ['id', 'nickname', 'avatar_url', 'is_admin', 'membership', 'membership_expires_at', 'ai_chat_count'] as const;

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

async function loadUserRow(db: ScopedDb, userId: string): Promise<UserRow | undefined> {
  return await db.tx((trx) => trx
    .selectFrom('users')
    .select(PROFILE_COLUMNS)
    .where('id', '=', userId)
    .executeTakeFirst()) as UserRow | undefined;
}

async function loadViewerProfile(
  db: ScopedDb,
  user: Pick<User, 'id' | 'user_metadata'>,
): Promise<UserRow | undefined> {
  const row = await loadUserRow(db, user.id);
  if (row) {
    return row;
  }

  const ensured = await ensureUserRecordRow(db, user);
  if (!ensured.ok) {
    throw ensured.error;
  }

  return await loadUserRow(db, user.id);
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

  const user = auth.user;
  const [profileOutcome, unreadOutcome] = await Promise.all([
    loadViewerProfile(auth.db, user).then(
      (row) => ({ ok: true as const, row }),
      (error: unknown) => {
        console.error('[bootstrap] failed to load viewer profile:', error);
        return { ok: false as const };
      },
    ),
    getUnreadNotificationCount(auth.db, user.id).then(
      (count) => ({ ok: true as const, count }),
      (error: unknown) => {
        console.error('[bootstrap] failed to load unread notifications:', error);
        return { ok: false as const };
      },
    ),
  ]);

  const unreadCount = unreadOutcome.ok ? unreadOutcome.count : 0;
  const unreadCountLoaded = unreadOutcome.ok;
  const row = profileOutcome.ok ? profileOutcome.row : undefined;
  if (!row || typeof row.ai_chat_count !== 'number' || Number.isNaN(row.ai_chat_count)) {
    return {
      viewerLoaded: false,
      viewerSummary: null,
      viewerErrorMessage: '加载账户状态失败',
      membership: null,
      unreadCount,
      unreadCountLoaded,
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
    unreadCount,
    unreadCountLoaded,
  };
}

async function getUnreadNotificationCount(db: ScopedDb, userId: string): Promise<number> {
  const row = await db.tx((trx) => trx
    .selectFrom('notifications')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('user_id', '=', userId)
    .where('created_at', '>=', getNotificationRetentionCutoffIso())
    .where('is_read', '=', false)
    .executeTakeFirst());
  return Number(row?.count ?? 0);
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
