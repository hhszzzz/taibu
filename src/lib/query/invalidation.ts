import { getBrowserQueryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { invalidateLocalCaches, type LocalCacheScope } from '@/lib/cache/local-storage';

export type MutationEffects = {
  queryKeys: ReadonlyArray<ReturnType<(typeof queryKeys)[keyof typeof queryKeys]>>;
  storageScopes: readonly LocalCacheScope[];
  exact?: boolean;
  cancelPending?: boolean;
};

export const mutationEffects = {
  userCharts: (userId: string): MutationEffects => ({
    queryKeys: [queryKeys.userCharts(userId)],
    storageScopes: ['data_sources', 'default_bazi_chart'],
    exact: true,
    cancelPending: true,
  }),
  userSettings: (userId: string): MutationEffects => ({
    queryKeys: [queryKeys.chatBootstrap(userId), queryKeys.userSettings(userId)],
    storageScopes: ['default_bazi_chart'],
  }),
};

// Explicit effects replace URL inference; legacy events remain in browser-api.
export function applyMutationEffects(effects: MutationEffects): LocalCacheScope[] {
  invalidateQueryKeys(effects.queryKeys, effects);
  const scopes = Array.from(new Set(effects.storageScopes));
  try {
    invalidateLocalCaches(scopes);
  } catch {
    // Storage may be unavailable; compatibility events must still be delivered.
  }
  return scopes;
}

function resolveInvalidationKeys(pathname: string): ReadonlyArray<readonly unknown[]> {
  if (pathname.startsWith('/api/admin/announcements') || pathname.startsWith('/api/announcements')) {
    return [queryKeys.announcementsPrefix()];
  }

  if (pathname.startsWith('/api/notifications')) {
    return [queryKeys.notificationsPrefix(), queryKeys.appBootstrapPrefix()];
  }

  if (pathname.startsWith('/api/feature-toggles')) {
    return [queryKeys.appBootstrapPrefix()];
  }

  if (pathname.startsWith('/api/user/profile')) {
    return [queryKeys.appBootstrapPrefix()];
  }

  if (pathname.startsWith('/api/user/settings')) {
    return [queryKeys.chatBootstrapPrefix(), queryKeys.userSettingsPrefix()];
  }

  if (
    pathname.startsWith('/api/user/membership')
    || pathname.startsWith('/api/membership')
    || pathname.startsWith('/api/credits')
    || pathname.startsWith('/api/checkin')
    || pathname.startsWith('/api/activation-keys')
    || pathname.startsWith('/api/auth')
  ) {
    return [
      queryKeys.appBootstrapPrefix(),
      queryKeys.chatBootstrapPrefix(),
      queryKeys.modelsPrefix(),
    ];
  }

  if (pathname.startsWith('/api/admin/ai-models')) {
    return [queryKeys.modelsPrefix()];
  }

  return [];
}

export function invalidateQueriesForPath(pathname: string) {
  invalidateQueryKeys(resolveInvalidationKeys(pathname));
}

function invalidateQueryKeys(
  keys: ReadonlyArray<readonly unknown[]>,
  options: Pick<MutationEffects, 'exact' | 'cancelPending'> = {},
) {
  if (typeof window === 'undefined') {
    return;
  }

  const queryClient = getBrowserQueryClient();
  if (!queryClient) {
    return;
  }

  const seen = new Set<string>();
  for (const key of keys) {
    const identity = JSON.stringify(key);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const filter = options.exact ? { queryKey: key, exact: true } : { queryKey: key };
    if (options.cancelPending) {
      // invalidateQueries alone reuses an initial in-flight read with no data.
      // Retire that pre-write snapshot before requesting the committed state.
      void queryClient.cancelQueries(filter)
        .then(() => queryClient.invalidateQueries(filter))
        .catch(() => { /* A refresh failure must not fail a committed mutation. */ });
    } else {
      void queryClient.invalidateQueries(filter).catch(() => {});
    }
  }
}
