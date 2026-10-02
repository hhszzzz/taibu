import { invalidateLocalCaches, type LocalCacheScope } from '@/lib/cache/local-storage';
import { applyMutationEffects, invalidateQueriesForPath, type MutationEffects } from '@/lib/query/invalidation';

export type BrowserRequestInit = RequestInit & {
  mutationEffects?: MutationEffects;
};

export const DATA_INDEX_INVALIDATED_EVENT = 'taibu:data-index:invalidate';
export const HISTORY_SUMMARY_DELETED_EVENT = 'taibu:history-summary:deleted';
export const KNOWLEDGE_BASE_SYNC_EVENT = 'taibu:knowledge-base:sync';

export type BrowserApiError = {
  message: string;
  code?: string;
};

export type BrowserApiPayload<T = unknown> = {
  data: T | null;
  error: BrowserApiError | null;
  count?: number | null;
  status?: number;
  statusText?: string;
};

function isAbortError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError';
}

type BrowserApiWriteEventDetail = {
  pathname: string;
  method: string;
  cacheScopes: LocalCacheScope[];
  requestBody: Record<string, unknown> | null;
  responseData: Record<string, unknown> | null;
};

type HistorySummaryDeletedEventDetail = {
  type: string | null;
  id: string | null;
  conversationId: string | null;
};

export function normalizeBrowserApiError(raw: unknown): BrowserApiError | null {
  if (!raw) return null;
  if (typeof raw === 'object' && raw && 'message' in raw) {
    const message = String((raw as { message?: unknown }).message ?? 'Unknown error');
    const code = 'code' in raw ? String((raw as { code?: unknown }).code ?? '') : undefined;
    return code ? { message, code } : { message };
  }
  return { message: String(raw) };
}

function shouldHandleApiWrite(pathname: string, method: string) {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/supabase/')) return false;
  if (pathname.startsWith('/api/chat')) return false;
  if (pathname.startsWith('/api/dify/')) return false;
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function resolveCacheScopesByPath(pathname: string): LocalCacheScope[] {
  if (pathname.startsWith('/api/knowledge-base')) return ['knowledge_bases', 'data_sources'];
  if (pathname.startsWith('/api/data-sources')) return ['data_sources', 'knowledge_bases'];
  if (pathname.startsWith('/api/records')) return ['data_sources'];
  if (pathname.startsWith('/api/bazi')) return ['data_sources', 'default_bazi_chart'];
  if (
    pathname.startsWith('/api/hepan')
    || pathname.startsWith('/api/liuyao')
    || pathname.startsWith('/api/tarot')
    || pathname.startsWith('/api/face')
    || pathname.startsWith('/api/palm')
    || pathname.startsWith('/api/mbti')
    || pathname.startsWith('/api/ziwei')
    || pathname.startsWith('/api/qimen')
    || pathname.startsWith('/api/daliuren')
    || pathname.startsWith('/api/meihua')
    || pathname.startsWith('/api/xiaoliuren')
  ) {
    return ['data_sources'];
  }
  if (pathname.startsWith('/api/user/settings')) return ['default_bazi_chart'];
  return [];
}

function toEventRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseRequestBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') {
    return null;
  }

  try {
    return toEventRecord(JSON.parse(body));
  } catch {
    return null;
  }
}

export function dispatchApiWriteEvents(
  pathname: string,
  method: string,
  options: {
    mutationEffects?: MutationEffects;
    requestBody?: Record<string, unknown> | null;
    responseData?: Record<string, unknown> | null;
  } = {},
) {
  if (typeof window === 'undefined' || !shouldHandleApiWrite(pathname, method)) {
    return;
  }

  let cacheScopes: LocalCacheScope[];
  if (options.mutationEffects) {
    cacheScopes = applyMutationEffects(options.mutationEffects);
  } else {
    invalidateQueriesForPath(pathname);
    cacheScopes = resolveCacheScopesByPath(pathname);
    if (cacheScopes.length > 0) {
      try {
        invalidateLocalCaches(cacheScopes);
      } catch {
        // ignore local cache invalidation failures so global sync events still fire
      }
    }
  }

  const detail: BrowserApiWriteEventDetail = {
    pathname,
    method,
    cacheScopes,
    requestBody: options.requestBody ?? null,
    responseData: options.responseData ?? null,
  };

  if (
    pathname.startsWith('/api/knowledge-base')
    || pathname.startsWith('/api/data-sources')
    || pathname.startsWith('/api/records')
    || pathname.startsWith('/api/community')
    || pathname.startsWith('/api/bazi')
    || pathname.startsWith('/api/hepan')
    || pathname.startsWith('/api/liuyao')
    || pathname.startsWith('/api/tarot')
    || pathname.startsWith('/api/face')
    || pathname.startsWith('/api/palm')
    || pathname.startsWith('/api/mbti')
    || pathname.startsWith('/api/ziwei')
    || pathname.startsWith('/api/qimen')
    || pathname.startsWith('/api/daliuren')
    || pathname.startsWith('/api/meihua')
    || pathname.startsWith('/api/xiaoliuren')
  ) {
    window.dispatchEvent(new CustomEvent(DATA_INDEX_INVALIDATED_EVENT, { detail }));
  }

  if (pathname.startsWith('/api/knowledge-base')) {
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_BASE_SYNC_EVENT, { detail }));
  }

  if (pathname.startsWith('/api/history-summaries') && method === 'DELETE') {
    const responseData = options.responseData ?? null;
    const historyDetail: HistorySummaryDeletedEventDetail = {
      type: typeof responseData?.type === 'string' ? responseData.type : null,
      id: typeof responseData?.id === 'string' ? responseData.id : null,
      conversationId: typeof responseData?.conversationId === 'string' ? responseData.conversationId : null,
    };
    window.dispatchEvent(new CustomEvent(HISTORY_SUMMARY_DELETED_EVENT, {
      detail: historyDetail,
    }));
  }
}

export async function fetchBrowserJson<T>(input: RequestInfo, init?: BrowserRequestInit): Promise<{
  ok: boolean;
  status: number;
  result: BrowserApiPayload<T>;
}> {
  const { mutationEffects, ...requestInit } = init ?? {};
  const requestBody = parseRequestBody(requestInit.body);

  try {
    const response = await fetch(input, {
      credentials: 'include',
      headers: {
        ...(requestInit.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(requestInit.headers || {}),
      },
      ...requestInit,
    });

    const payload = await response.json().catch(() => null) as
      | { data?: T | null; error?: unknown; count?: number | null; status?: number; statusText?: string }
      | T
      | null;

    const hasEnvelope = !!payload
      && typeof payload === 'object'
      && (
        'data' in payload
        || 'error' in payload
        || 'count' in payload
        || 'status' in payload
        || 'statusText' in payload
      );

    const normalizedError = hasEnvelope
      ? normalizeBrowserApiError((payload as { error?: unknown }).error ?? null)
      : (!response.ok ? normalizeBrowserApiError(payload ?? null) : null);
    const resolvedError = !response.ok && !normalizedError
      ? { message: response.statusText || `Request failed (${response.status})` }
      : normalizedError;
    const responseData = hasEnvelope
      ? toEventRecord((payload as { data?: unknown }).data ?? null)
      : toEventRecord(payload ?? null);

    try {
      const method = (
        requestInit.method
        || (input instanceof Request ? input.method : 'GET')
        || 'GET'
      ).toUpperCase();
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (response.ok && (!mutationEffects || !resolvedError)) {
        dispatchApiWriteEvents(url.pathname, method, {
          mutationEffects,
          requestBody,
          responseData,
        });
      }
    } catch {
      // ignore client-side invalidation failures
    }

    return {
      ok: response.ok,
      status: response.status,
      result: {
        data: (hasEnvelope
          ? ((payload as { data?: T | null }).data ?? null)
          : ((payload ?? null) as T | null)),
        error: resolvedError,
        count: hasEnvelope ? ((payload as { count?: number | null }).count ?? null) : null,
        status: response.status,
        statusText: response.statusText || (hasEnvelope ? (payload as { statusText?: string }).statusText : undefined),
      },
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return {
      ok: false,
      status: 500,
      result: {
        data: null,
        error: normalizeBrowserApiError(error) || { message: 'Request failed' },
        status: 500,
        statusText: 'Request failed',
      },
    };
  }
}

export async function requestBrowserJson<T>(url: string, init?: BrowserRequestInit): Promise<BrowserApiPayload<T>> {
  const { result } = await fetchBrowserJson<T>(url, init);
  return result;
}

export async function requestBrowserPayloadOrThrow<T>(
  url: string,
  init?: BrowserRequestInit,
  fallbackMessage = '请求失败',
): Promise<BrowserApiPayload<T>> {
  const result = await requestBrowserJson<T>(url, init);
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }
  return result;
}

export async function requestBrowserData<T>(
  url: string,
  init: BrowserRequestInit | undefined,
  options: {
    fallbackMessage?: string;
    allowNotFound: true;
  },
): Promise<T | null>;
export async function requestBrowserData<T>(
  url: string,
  init?: BrowserRequestInit,
  options?: {
    fallbackMessage?: string;
    allowNotFound?: false | undefined;
  },
): Promise<T>;
export async function requestBrowserData<T>(
  url: string,
  init?: BrowserRequestInit,
  options: {
    fallbackMessage?: string;
    allowNotFound?: boolean;
  } = {},
): Promise<T | null> {
  const { allowNotFound = false, fallbackMessage = '请求失败' } = options;
  const { ok, status, result } = await fetchBrowserJson<T>(url, init);

  if (!ok || result.error) {
    if (allowNotFound && status === 404) {
      return null;
    }
    throw new Error(result.error?.message || fallbackMessage);
  }

  if (result.data == null) {
    if (allowNotFound && status === 404) {
      return null;
    }
    throw new Error(fallbackMessage);
  }

  return result.data;
}
