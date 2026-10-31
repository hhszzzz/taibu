import { requestBrowserJson } from '@/lib/browser-api';
import { normalizeBillingBalance, type BillingBalance } from '@/lib/billing/config';

export type AppBootstrapViewerSummary = {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export type AppBootstrapData = {
  viewerLoaded: boolean;
  viewerSummary: AppBootstrapViewerSummary | null;
  viewerErrorMessage: string | null;
  /** Null for a visitor, or when the balance could not be read. */
  billing: BillingBalance | null;
  featureToggles: Record<string, boolean>;
  featureTogglesLoaded: boolean;
  featureTogglesErrorMessage: string | null;
  unreadCount: number;
  unreadCountLoaded: boolean;
};

export type AppBootstrapViewerState = {
  loaded: boolean;
  resolved: boolean;
  error: Error | null;
};

export const EMPTY_APP_BOOTSTRAP: AppBootstrapData = {
  viewerLoaded: false,
  viewerSummary: null,
  viewerErrorMessage: null,
  billing: null,
  featureToggles: {},
  featureTogglesLoaded: false,
  featureTogglesErrorMessage: null,
  unreadCount: 0,
  unreadCountLoaded: false,
};

export const APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE = '加载账户状态失败';

export function deriveAppBootstrapViewerState(options: {
  hasUser: boolean;
  hasBootstrapData: boolean;
  data: AppBootstrapData | null;
  requestError?: Error | null;
}): AppBootstrapViewerState {
  const requestError = options.requestError instanceof Error ? options.requestError : null;

  if (!options.hasUser) {
    return {
      loaded: true,
      resolved: true,
      error: null,
    };
  }

  if (options.hasBootstrapData && options.data?.viewerLoaded === true) {
    return {
      loaded: true,
      resolved: true,
      error: null,
    };
  }

  if (requestError) {
    return {
      loaded: false,
      resolved: true,
      error: requestError,
    };
  }

  if (options.hasBootstrapData) {
    return {
      loaded: false,
      resolved: true,
      error: new Error(options.data?.viewerErrorMessage || APP_BOOTSTRAP_VIEWER_ERROR_MESSAGE),
    };
  }

  return {
    loaded: false,
    resolved: false,
    error: null,
  };
}

export async function loadAppBootstrap(): Promise<AppBootstrapData> {
  const result = await requestBrowserJson<AppBootstrapData>('/api/app/bootstrap', {
    method: 'GET',
  });

  if (result.error) {
    throw new Error(result.error.message || '加载应用缓存引导数据失败');
  }

  if (!result.data) {
    throw new Error('应用缓存引导数据缺失');
  }

  return {
    viewerLoaded: result.data.viewerLoaded === true,
    viewerSummary: result.data.viewerSummary ?? null,
    viewerErrorMessage: typeof result.data.viewerErrorMessage === 'string'
      ? result.data.viewerErrorMessage
      : null,
    billing: normalizeBillingBalance(result.data.billing),
    featureToggles: result.data.featureToggles ?? {},
    featureTogglesLoaded: result.data.featureTogglesLoaded === true,
    featureTogglesErrorMessage: typeof result.data.featureTogglesErrorMessage === 'string'
      ? result.data.featureTogglesErrorMessage
      : null,
    unreadCount: result.data.unreadCount ?? 0,
    unreadCountLoaded: result.data.unreadCountLoaded === true,
  };
}
