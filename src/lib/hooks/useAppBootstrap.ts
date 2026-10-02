'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionSafe } from '@/lib/hooks/session-context';
import {
  APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE,
  type AppBootstrapData,
  deriveAppBootstrapViewerState,
  EMPTY_APP_BOOTSTRAP,
  loadAppBootstrap,
} from '@/lib/app/bootstrap';
import { queryKeys } from '@/lib/query/keys';

const VIEWER_STATE_RETRY_INTERVAL_MS = 800;
const VIEWER_STATE_ERROR_GRACE_MS = 3_000;

export function useAppBootstrap(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();
  const { user, loading: sessionLoading } = useSessionSafe();
  const queryKey = queryKeys.appBootstrap(user?.id ?? null);
  const cachedData = queryClient.getQueryData<AppBootstrapData>(queryKey);
  const [timedOutViewerKey, setTimedOutViewerKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: loadAppBootstrap,
    enabled: enabled && !sessionLoading,
    staleTime: 30_000,
    ...(cachedData ? { initialData: cachedData } : {}),
  });

  const data = useMemo<AppBootstrapData | null>(() => {
    if (query.data) {
      return query.data;
    }
    if (cachedData) {
      return cachedData;
    }
    return null;
  }, [cachedData, query.data]);

  const hasBootstrapData = data !== null;
  const rawViewerState = useMemo(() => deriveAppBootstrapViewerState({
    hasUser: !!user,
    hasBootstrapData,
    data,
    requestError: query.error instanceof Error ? query.error : null,
  }), [data, hasBootstrapData, query.error, user]);
  const viewerPendingKey = enabled && user?.id && data?.viewerLoaded === false && rawViewerState.error
    ? `${user.id}:${data.viewerErrorMessage || APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE}`
    : null;
  const viewerFailureTimedOut = viewerPendingKey !== null && timedOutViewerKey === viewerPendingKey;

  useEffect(() => {
    if (!viewerPendingKey || viewerFailureTimedOut) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTimedOutViewerKey(viewerPendingKey);
    }, VIEWER_STATE_ERROR_GRACE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [viewerFailureTimedOut, viewerPendingKey]);

  const viewerState = useMemo(() => {
    if (viewerPendingKey && !viewerFailureTimedOut) {
      return {
        loaded: false,
        resolved: false,
        error: null,
      };
    }

    return rawViewerState;
  }, [rawViewerState, viewerFailureTimedOut, viewerPendingKey]);

  useEffect(() => {
    if (!viewerPendingKey || viewerFailureTimedOut || query.isFetching) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void query.refetch();
    }, VIEWER_STATE_RETRY_INTERVAL_MS);

    return () => window.clearTimeout(retryTimer);
  }, [query, viewerFailureTimedOut, viewerPendingKey]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: loadAppBootstrap,
      staleTime: 30_000,
    });
  }, [queryClient, queryKey]);

  const markCreditsExhausted = useCallback(() => {
    queryClient.setQueryData(queryKey, (previous: AppBootstrapData | undefined) => ({
      ...(previous ?? EMPTY_APP_BOOTSTRAP),
      membership: previous?.membership
        ? {
          ...previous.membership,
          aiChatCount: 0,
        }
        : previous?.membership ?? null,
      viewerSummary: previous?.viewerSummary
        ? {
          ...previous.viewerSummary,
          aiChatCount: 0,
        }
        : previous?.viewerSummary ?? null,
    }));
  }, [queryClient, queryKey]);

  return {
    ...query,
    data: data ?? EMPTY_APP_BOOTSTRAP,
    hasBootstrapData,
    viewerStateLoaded: viewerState.loaded,
    viewerStateResolved: viewerState.resolved,
    viewerStateError: viewerState.error,
    refresh,
    markCreditsExhausted,
  };
}
