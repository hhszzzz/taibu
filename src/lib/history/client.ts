import { requestBrowserData } from '@/lib/browser-api';
import { updateSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import type {
  HistoryRestorePayload,
  HistorySummaryItem,
  HistoryType,
} from '@/lib/history/registry';

type HistoryPagination = {
  hasMore: boolean;
  nextOffset: number | null;
};

const HISTORY_PAGE_SIZE = 100;

export async function loadHistorySummariesPage(
  type: HistoryType,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<{ items: HistorySummaryItem[]; pagination: HistoryPagination }> {
  const limit = options.limit ?? HISTORY_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const params = new URLSearchParams({
    type,
    limit: String(limit),
    offset: String(offset),
  });

  const data = await requestBrowserData<{ items?: HistorySummaryItem[]; pagination?: HistoryPagination }>(
    `/api/history-summaries?${params.toString()}`,
    { method: 'GET', signal: options.signal },
    { fallbackMessage: '加载历史记录失败' },
  );

  return {
    items: data.items || [],
    pagination: data.pagination || { hasMore: false, nextOffset: null },
  };
}

export async function loadHistoryRestore(
  type: HistoryType,
  id: string,
  timezone?: string,
  options: { signal?: AbortSignal } = {},
): Promise<HistoryRestorePayload | null> {
  const query = new URLSearchParams({
    type,
    id,
  });
  if (timezone) {
    query.set('timezone', timezone);
  }

  const data = await requestBrowserData<{ item?: HistoryRestorePayload | null }>(
    `/api/history-summaries?${query.toString()}`,
    { method: 'GET', signal: options.signal },
    { fallbackMessage: '加载历史记录失败' },
  );

  return data.item ?? null;
}

export async function deleteHistorySummary(type: HistoryType, id: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const query = new URLSearchParams({
    type,
    id,
  });

  const data = await requestBrowserData<{ success?: boolean }>(
    `/api/history-summaries?${query.toString()}`,
    { method: 'DELETE', signal: options.signal },
    { fallbackMessage: '删除历史记录失败' },
  );
  if (data.success !== true) {
    throw new Error('删除历史记录失败');
  }
}

export function applyHistoryRestorePayload(payload: HistoryRestorePayload) {
  writeSessionJSON(payload.sessionKey, payload.sessionData);
  if (payload.useTimestamp) {
    return `${payload.detailPath}?from=history&t=${Date.now()}`;
  }
  return payload.detailPath;
}

export async function resolveHistoryConversationId(
  type: HistoryType,
  id: string,
  sessionKey?: string,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  const payload = await loadHistoryRestore(type, id, undefined, options);
  options.signal?.throwIfAborted();
  const conversationId = typeof payload?.sessionData?.conversationId === 'string'
    ? payload.sessionData.conversationId
    : null;

  if (conversationId && sessionKey) {
    updateSessionJSON<Record<string, unknown>>(sessionKey, (prev) => ({
      ...(prev || {}),
      conversationId,
    }));
  }

  return conversationId;
}
