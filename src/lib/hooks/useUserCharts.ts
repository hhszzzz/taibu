'use client';

// Query owns saved rows; hooks below keep only user-scoped selection and request UI state.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import {
  getUserCharts,
  listSavedBaziCharts,
  selectPrimarySavedBaziChart,
  type ChartRequestScope,
} from '@/lib/user/charts-client';

type UserChartsOptions = { enabled?: boolean };

export function useUserCharts(userId?: string | null, options: UserChartsOptions = {}) {
  return useQuery({
    queryKey: queryKeys.userCharts(userId),
    queryFn: ({ signal }) => getUserCharts({ expectedUserId: userId ?? undefined, signal }),
    enabled: !!userId && (options.enabled ?? true),
    // Re-entering an account must reconcile writes that committed after their
    // owner was aborted (those intentionally emit no success effects).
    staleTime: 0,
  });
}

export function useSelectedBaziChart(userId?: string | null, options: UserChartsOptions = {}) {
  const query = useUserCharts(userId, options);
  const [selection, setSelection] = useState<{ userId: string; id: string } | null>(null);
  const charts = useMemo(() => listSavedBaziCharts(query.data), [query.data]);
  const selectedId = selection?.userId === userId ? selection?.id : null;
  const chart = useMemo(() => {
    if (!userId || options.enabled === false) return null;
    // Query retains its last authoritative bundle on network errors. Only a
    // successful bundle without this ID can cause the fallback below.
    return charts.find(item => item.id === selectedId) ?? selectPrimarySavedBaziChart(query.data);
  }, [charts, options.enabled, query.data, selectedId, userId]);

  if (selection && selection.userId !== userId) setSelection(null);

  const selectChart = useCallback((id: string) => {
    if (userId && charts.some(item => item.id === id)) setSelection({ userId, id });
  }, [charts, userId]);

  return { ...query, chart, selectChart };
}

/** A single in-flight write per mounted owner, fenced by the initiating identity. */
export function useChartMutation(userId?: string | null) {
  const lifecycle = useRef<{ userId: string; controller: AbortController; pending: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const [prevUserId, setPrevUserId] = useState(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setPending(false);
  }

  useLayoutEffect(() => {
    const current = userId ? { userId, controller: new AbortController(), pending: false } : null;
    lifecycle.current = current;
    return () => {
      current?.controller.abort();
      lifecycle.current = null;
    };
  }, [userId]);

  const run = useCallback(async <T,>(
    operation: (scope: ChartRequestScope) => Promise<T>,
    onSuccess: (result: T) => void,
    onError: (error: unknown) => void,
  ) => {
    const current = lifecycle.current;
    if (!current || current.userId !== userId || current.pending || current.controller.signal.aborted) return;
    current.pending = true;
    setPending(true);
    const isCurrent = () => lifecycle.current === current && !current.controller.signal.aborted;
    try {
      const result = await operation({ expectedUserId: current.userId, signal: current.controller.signal });
      if (isCurrent()) onSuccess(result);
      return result;
    } catch (error) {
      if (isCurrent()) onError(error);
      return undefined;
    } finally {
      if (isCurrent()) {
        current.pending = false;
        setPending(false);
      }
    }
  }, [userId]);

  return { pending, run };
}
