'use client';

// Shared local pagination for history pages and drawers; no process-wide cache.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { DATA_INDEX_INVALIDATED_EVENT } from '@/lib/browser-api';
import { loadHistorySummariesPage } from '@/lib/history/client';
import type { HistorySummaryItem, HistoryType } from '@/lib/history/registry';

type ListState = {
    identity: string;
    items: HistorySummaryItem[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    nextOffset: number | null;
    appendError: string | null;
    errorMessage: string | null;
};

type ListScope = {
    identity: string;
    controller: AbortController;
    request: AbortController | null;
    deletedIds: Set<string>;
    state: ListState;
};

const emptyState = (identity: string): ListState => ({
    identity, items: [], loading: false, loadingMore: false,
    hasMore: false, nextOffset: null, appendError: null, errorMessage: null,
});

export function useHistoryList({
    type, userId, enabled, batchSize, onError,
}: {
    type: HistoryType;
    userId?: string | null;
    enabled: boolean;
    batchSize: number;
    onError: (message: string) => void;
}) {
    const identity = JSON.stringify([userId ?? null, type, enabled]);
    const lifecycle = useRef<ListScope | null>(null);
    const [state, setState] = useState<ListState>(() => emptyState(identity));

    const captureScope = useCallback((itemId?: string) => {
        const scope = lifecycle.current;
        if (!scope || scope.identity !== identity || scope.controller.signal.aborted || (itemId && scope.deletedIds.has(itemId))) return null;
        return {
            signal: scope.controller.signal,
            isCurrent: () => lifecycle.current === scope && !scope.controller.signal.aborted
                && (!itemId || !scope.deletedIds.has(itemId)),
        };
    }, [identity]);

    const loadItems = useCallback(async (options?: { append?: boolean; offset?: number }) => {
        const scope = lifecycle.current;
        if (!scope || scope.identity !== identity || scope.controller.signal.aborted) return;
        const append = options?.append === true;
        // A queued observer must not append to a refresh, or reuse a pre-delete cursor.
        if (append && (scope.request || !scope.state.hasMore || options?.offset !== scope.state.nextOffset)) return;
        scope.request?.abort();
        const request = new AbortController();
        scope.request = request;
        const isCurrent = () => lifecycle.current === scope
            && !scope.controller.signal.aborted && !request.signal.aborted && scope.request === request;
        const commit = (patch: Partial<ListState>) => {
            if (!isCurrent()) return;
            scope.state = { ...scope.state, ...patch };
            setState(scope.state);
        };
        commit({ loading: !append, loadingMore: append, appendError: null, errorMessage: null });

        try {
            // Revalidate the loaded prefix, not just its first page, after archive/delete events.
            const targetCount = append ? batchSize : Math.max(batchSize, scope.state.items.length);
            let offset = append ? scope.state.nextOffset ?? 0 : 0;
            let incoming: HistorySummaryItem[] = [];
            let pagination = { hasMore: false, nextOffset: null as number | null };
            let deletedCount = 0;
            do {
                const page = await loadHistorySummariesPage(type, {
                    limit: Math.min(100, Math.max(batchSize, targetCount - incoming.length)),
                    offset,
                    signal: request.signal,
                });
                if (!isCurrent()) return;
                const surviving = page.items.filter(item => !scope.deletedIds.has(item.id));
                deletedCount += page.items.length - surviving.length;
                incoming = [...incoming, ...surviving];
                pagination = page.pagination;
                if (!pagination.hasMore || pagination.nextOffset == null || pagination.nextOffset <= offset) break;
                offset = pagination.nextOffset;
            } while (!append && incoming.length < targetCount);

            const merged = new Map((append ? scope.state.items : []).map(item => [item.id, item]));
            for (const item of incoming) merged.set(item.id, item);
            commit({
                items: Array.from(merged.values()),
                hasMore: pagination.hasMore,
                // If a stale backend snapshot still contains a tombstone, retry its shifted
                // position rather than skipping the surviving row now occupying that offset.
                nextOffset: pagination.nextOffset == null ? null : Math.max(0, pagination.nextOffset - deletedCount),
            });
        } catch (error) {
            if (!isCurrent()) return;
            const message = error instanceof Error ? error.message : '加载历史记录失败';
            commit(append
                ? { appendError: message }
                : { errorMessage: message, hasMore: false, nextOffset: null });
            onError(message);
        } finally {
            if (isCurrent()) {
                commit({ loading: false, loadingMore: false });
                scope.request = null;
            }
        }
    }, [batchSize, identity, onError, type]);

    useLayoutEffect(() => {
        let mounted = true;
        let scope: ListScope | null = null;
        void Promise.resolve().then(() => {
            if (!mounted) return;
            scope = {
                identity, controller: new AbortController(), request: null,
                deletedIds: new Set(), state: emptyState(identity),
            };
            lifecycle.current = scope;
            setState(scope.state);
            if (enabled && userId) void loadItems();
            else scope.controller.abort();
        });
        return () => {
            mounted = false;
            scope?.controller.abort();
            scope?.request?.abort();
        };
    }, [enabled, identity, loadItems, userId]);

    useLayoutEffect(() => {
        if (!enabled || !userId) return;
        const handleDataIndexChanged = (event: Event) => {
            const pathname = (event as CustomEvent<{ pathname?: string }>).detail?.pathname;
            if (pathname === `/api/${type}` || pathname?.startsWith(`/api/${type}/`)) void loadItems();
        };
        window.addEventListener(DATA_INDEX_INVALIDATED_EVENT, handleDataIndexChanged);
        return () => window.removeEventListener(DATA_INDEX_INVALIDATED_EVENT, handleDataIndexChanged);
    }, [enabled, loadItems, type, userId]);

    const removeHistoryItem = useCallback((id: string) => {
        const scope = lifecycle.current;
        if (!scope || scope.identity !== identity || scope.controller.signal.aborted || scope.deletedIds.has(id)) return;
        // Update the ref and React state together, never derive effects from a queued updater.
        scope.deletedIds.add(id);
        scope.state = { ...scope.state, items: scope.state.items.filter(item => item.id !== id) };
        setState(scope.state);
        // Offsets belong to the pre-delete list. Abort that generation and re-read the prefix.
        // Both the mutation event and its caller may reach here; the tombstone dedupes them.
        void loadItems();
    }, [identity, loadItems]);

    const setErrorMessage = useCallback((message: string | null) => {
        const scope = lifecycle.current;
        if (!scope || scope.identity !== identity || scope.controller.signal.aborted) return;
        scope.state = { ...scope.state, errorMessage: message };
        setState(scope.state);
    }, [identity]);

    const visible = enabled && userId && state.identity === identity ? state : emptyState(identity);
    return { ...visible, loadItems, removeHistoryItem, setErrorMessage, captureScope };
}
