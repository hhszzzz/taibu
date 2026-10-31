import { NextRequest } from 'next/server';
import { getAuthContext, jsonOk, type AppUser } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { readFeatureTogglesState } from '@/lib/app-settings';
import { getNotificationRetentionCutoffIso } from '@/lib/notification-server';
import { getBillingSummary } from '@/lib/billing/account.server';
import type { BillingBalance } from '@/lib/billing/config';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import type { AppBootstrapData, AppBootstrapViewerSummary } from '@/lib/app/bootstrap';

type UserRow = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  is_admin: boolean | null;
};

const PROFILE_COLUMNS = ['id', 'nickname', 'avatar_url', 'is_admin'] as const;

function buildViewerSummary(row: UserRow): AppBootstrapViewerSummary {
  return {
    userId: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    isAdmin: !!row.is_admin,
  };
}

async function loadBalance(db: ScopedDb, userId: string): Promise<BillingBalance | null> {
  try {
    const { walletMicros, subscriptionMicros, spendableMicros } = await getBillingSummary(userId, db);
    return { walletMicros, subscriptionMicros, spendableMicros };
  } catch (error) {
    console.error('[bootstrap] failed to load balance:', error);
    return null;
  }
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
  user: Pick<AppUser, 'id' | 'name' | 'image'>,
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
      billing: null,
      unreadCount: 0,
      unreadCountLoaded: false,
    };
  }

  if (!auth.user) {
    return {
      viewerLoaded: true,
      viewerSummary: null,
      viewerErrorMessage: null,
      billing: null,
      unreadCount: 0,
      unreadCountLoaded: true,
    };
  }

  const user = auth.user;
  const [profileOutcome, unreadOutcome, billing] = await Promise.all([
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
    loadBalance(auth.db, user.id),
  ]);

  const unreadCount = unreadOutcome.ok ? unreadOutcome.count : 0;
  const unreadCountLoaded = unreadOutcome.ok;
  const row = profileOutcome.ok ? profileOutcome.row : undefined;
  if (!row) {
    return {
      viewerLoaded: false,
      viewerSummary: null,
      viewerErrorMessage: '加载账户状态失败',
      billing: null,
      unreadCount,
      unreadCountLoaded,
    };
  }

  return {
    viewerLoaded: true,
    viewerSummary: buildViewerSummary(row),
    viewerErrorMessage: null,
    billing,
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
    billing: viewerState.billing,
    featureToggles: featureToggleState.toggles,
    featureTogglesLoaded: featureToggleState.loaded,
    featureTogglesErrorMessage: featureToggleState.loaded ? null : '功能状态加载失败',
    unreadCount: viewerState.unreadCount,
    unreadCountLoaded: viewerState.unreadCountLoaded,
  };

  const hasPartialFailure = !!data.viewerErrorMessage
    || (!!data.viewerSummary && !data.billing)
    || !data.featureTogglesLoaded
    || !data.unreadCountLoaded;

  return jsonOk({ data }, hasPartialFailure ? 207 : 200);
}
