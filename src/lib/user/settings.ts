import type { QueryClient } from '@tanstack/react-query';
import { requestBrowserJson, type BrowserApiError } from '@/lib/browser-api';
import { normalizeChatPreferences, type ChatPreferences } from '@/lib/chat/preferences';
import { normalizeBriefingPreferences, validBriefingPreferences, type BriefingPreferences } from '@/lib/briefing-preferences';
import type { MutationEffects } from '@/lib/query/invalidation';
import { queryKeys } from '@/lib/query/keys';
import {
  normalizeVisualizationSettings,
  type VisualizationSettings,
} from '@/lib/visualization/settings';

export type ExpressionStyle = 'direct' | 'gentle';
export type AppLanguage = 'zh' | 'en';
export type ChartPromptDetailLevel = 'default' | 'more' | 'full';
export type UserIdentityProfile = {
  identity: string;
};

export const DEFAULT_NAV_ORDER = [
  'bazi', 'hepan', 'ziwei', 'liuyao', 'meihua', 'qimen', 'daliuren', 'xiaoliuren', 'tarot', 'face', 'palm', 'mbti', 'daily', 'monthly',
] as const;

export const DEFAULT_TOOL_ORDER = [
  'chat', 'records', 'community',
] as const;

/** Fixed bottom-bar entries; the pinned divination slot in front of them lives in `mobile-nav-pins.ts`. */
export const DEFAULT_MOBILE_MAIN_ITEMS = [
  'chat', 'daily',
] as const;

/** Mobile "全部占术" sheet order: every divination (grouped, fortune pair as footer), then tools and account entries. */
export const DEFAULT_MOBILE_DRAWER_ORDER = [
  'bazi', 'hepan', 'ziwei', 'liuyao', 'meihua', 'xiaoliuren', 'tarot', 'qimen', 'daliuren',
  'face', 'palm', 'mbti', 'daily', 'monthly',
  'records', 'community',
  'settings-profile', 'settings-general', 'settings-upgrade',
  'settings-personalization', 'settings-knowledge-base', 'settings-help',
  'settings-charts',
] as const;

type UserSettingsRow = {
  daily_briefing_settings?: unknown;
  chat_preferences?: unknown;
  expression_style?: unknown;
  custom_instructions?: unknown;
  chart_prompt_detail_level?: unknown;
  user_profile?: unknown;
  prompt_kb_ids?: unknown;
  visualization_settings?: unknown;
  notifications_enabled?: unknown;
  notify_email?: unknown;
  notify_site?: unknown;
  language?: unknown;
  default_bazi_chart_id?: unknown;
  default_ziwei_chart_id?: unknown;
};

type UserSettingsQueryResult = PromiseLike<{
  data: UserSettingsRow | null;
  error: unknown;
}>;

type UserSettingsReader = {
  from(table: 'user_settings'): {
    select(columns: string): {
      eq(column: 'user_id', userId: string): {
        maybeSingle(): UserSettingsQueryResult;
      };
    };
  };
};

export type UserSettingsSnapshot = {
  briefingConfigured?: boolean;
  briefingPreferences: BriefingPreferences;
  chatPreferences: ChatPreferences;
  expressionStyle: ExpressionStyle;
  customInstructions: string;
  chartPromptDetailLevel: ChartPromptDetailLevel;
  userProfile: UserIdentityProfile | null;
  promptKbIds: string[];
  visualizationSettings: VisualizationSettings | undefined;
  notificationsEnabled: boolean;
  notifyEmail: boolean;
  notifySite: boolean;
  language: AppLanguage;
  defaultBaziChartId: string | null;
  defaultZiweiChartId: string | null;
};

export type UserSettingsLoadResult = {
  settings: UserSettingsSnapshot | null;
  error: BrowserApiError | null;
};

export type DefaultChartIds = {
  bazi: string | null;
  ziwei: string | null;
};

export type UserSettingsUpdateInput = Partial<{
  briefingPreferences: BriefingPreferences;
  chatPreferences: Partial<ChatPreferences>;
  expressionStyle: ExpressionStyle;
  customInstructions: string | null;
  chartPromptDetailLevel: ChartPromptDetailLevel;
  userProfile: UserIdentityProfile | null;
  promptKbIds: string[];
  visualizationSettings: VisualizationSettings | null;
  notificationsEnabled: boolean;
  language: AppLanguage;
  defaultBaziChartId: string | null;
  defaultZiweiChartId: string | null;
}>;

export const USER_SETTINGS_SELECT = `
  daily_briefing_settings,
  chat_preferences,
  expression_style,
  custom_instructions,
  chart_prompt_detail_level,
  user_profile,
  prompt_kb_ids,
  visualization_settings,
  notifications_enabled,
  notify_email,
  notify_site,
  language,
  default_bazi_chart_id,
  default_ziwei_chart_id
`;

export function normalizeIdentityUserProfile(raw: unknown): UserIdentityProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const identity = typeof (raw as { identity?: unknown }).identity === 'string'
    ? (raw as { identity: string }).identity.trim()
    : '';

  return identity ? { identity } : null;
}

export function normalizeUserSettings(row: UserSettingsRow | null | undefined): UserSettingsSnapshot {
  return {
    briefingPreferences: normalizeBriefingPreferences(row?.daily_briefing_settings),
    briefingConfigured: validBriefingPreferences(row?.daily_briefing_settings),
    chatPreferences: normalizeChatPreferences(row?.chat_preferences),
    expressionStyle: row?.expression_style === 'gentle' ? 'gentle' : 'direct',
    customInstructions: typeof row?.custom_instructions === 'string' ? row.custom_instructions : '',
    chartPromptDetailLevel: row?.chart_prompt_detail_level === 'full'
      ? 'full'
      : row?.chart_prompt_detail_level === 'more'
        ? 'more'
        : 'default',
    userProfile: normalizeIdentityUserProfile(row?.user_profile),
    promptKbIds: Array.isArray(row?.prompt_kb_ids)
      ? row.prompt_kb_ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
    visualizationSettings: normalizeVisualizationSettings(row?.visualization_settings),
    notificationsEnabled: row?.notifications_enabled !== false,
    notifyEmail: row?.notify_email !== false,
    notifySite: row?.notify_site !== false,
    language: row?.language === 'en' ? 'en' : 'zh',
    defaultBaziChartId: typeof row?.default_bazi_chart_id === 'string' ? row.default_bazi_chart_id : null,
    defaultZiweiChartId: typeof row?.default_ziwei_chart_id === 'string' ? row.default_ziwei_chart_id : null,
  };
}

export function toDefaultChartIds(
  settings: Pick<UserSettingsSnapshot, 'defaultBaziChartId' | 'defaultZiweiChartId'>,
): DefaultChartIds {
  return {
    bazi: settings.defaultBaziChartId,
    ziwei: settings.defaultZiweiChartId,
  };
}

export function sanitizeDefaultChartIds(
  defaults: DefaultChartIds,
  availableCharts: { bazi: Iterable<string>; ziwei: Iterable<string> },
): DefaultChartIds {
  const baziIds = new Set(availableCharts.bazi);
  const ziweiIds = new Set(availableCharts.ziwei);
  return {
    bazi: defaults.bazi && baziIds.has(defaults.bazi) ? defaults.bazi : null,
    ziwei: defaults.ziwei && ziweiIds.has(defaults.ziwei) ? defaults.ziwei : null,
  };
}

export function buildDefaultChartSettingsPayload(
  userId: string,
  type: 'bazi' | 'ziwei',
  chartId: string | null,
): Record<string, unknown> {
  return buildUserSettingsUpdatePayload(userId, type === 'bazi'
    ? { defaultBaziChartId: chartId }
    : { defaultZiweiChartId: chartId });
}

export function getUserSettingsRow(
  client: unknown,
  userId: string,
): UserSettingsQueryResult {
  return (client as UserSettingsReader)
    .from('user_settings')
    .select(USER_SETTINGS_SELECT)
    .eq('user_id', userId)
    .maybeSingle();
}

export async function getUserSettingsSnapshot(
  client: unknown,
  userId: string,
): Promise<{ settings: UserSettingsSnapshot; error: unknown }> {
  const result = await getUserSettingsRow(client, userId);
  return {
    settings: normalizeUserSettings(result.data),
    error: result.error,
  };
}

export async function getChartPromptDetailLevel(
  client: UserSettingsReader,
  userId: string,
): Promise<ChartPromptDetailLevel> {
  const { settings } = await getUserSettingsSnapshot(client, userId);
  return settings.chartPromptDetailLevel;
}

export function buildUserSettingsUpdatePayload(
  userId: string,
  body: UserSettingsUpdateInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (body.chatPreferences !== undefined) payload.chat_preferences = normalizeChatPreferences(body.chatPreferences);
  if (body.briefingPreferences !== undefined) payload.daily_briefing_settings = normalizeBriefingPreferences(body.briefingPreferences);

  if (body.expressionStyle === 'direct' || body.expressionStyle === 'gentle') {
    payload.expression_style = body.expressionStyle;
  }
  if (body.customInstructions === null || typeof body.customInstructions === 'string') {
    payload.custom_instructions = body.customInstructions;
  }
  if (body.chartPromptDetailLevel === 'default' || body.chartPromptDetailLevel === 'more' || body.chartPromptDetailLevel === 'full') {
    payload.chart_prompt_detail_level = body.chartPromptDetailLevel;
  }
  if (body.userProfile !== undefined) {
    payload.user_profile = normalizeIdentityUserProfile(body.userProfile);
  }
  if (Array.isArray(body.promptKbIds)) {
    payload.prompt_kb_ids = body.promptKbIds.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }
  if (body.visualizationSettings !== undefined) {
    if (body.visualizationSettings === null) {
      payload.visualization_settings = null;
    } else {
      const normalizedVisualizationSettings = normalizeVisualizationSettings(body.visualizationSettings);
      if (normalizedVisualizationSettings) {
        payload.visualization_settings = normalizedVisualizationSettings;
      }
    }
  }
  if (typeof body.notificationsEnabled === 'boolean') {
    payload.notifications_enabled = body.notificationsEnabled;
    payload.notify_email = body.notificationsEnabled;
    payload.notify_site = body.notificationsEnabled;
  }
  if (body.language === 'zh' || body.language === 'en') {
    payload.language = body.language;
  }
  if (body.defaultBaziChartId === null || typeof body.defaultBaziChartId === 'string') {
    payload.default_bazi_chart_id = body.defaultBaziChartId;
  }
  if (body.defaultZiweiChartId === null || typeof body.defaultZiweiChartId === 'string') {
    payload.default_ziwei_chart_id = body.defaultZiweiChartId;
  }

  return payload;
}

export function hasEffectiveUserSettingsUpdate(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some((key) => key !== 'user_id' && key !== 'updated_at');
}

export type SettingsRequestScope = { expectedUserId?: string; signal?: AbortSignal };

export async function getCurrentUserSettings(scope: SettingsRequestScope = {}): Promise<UserSettingsLoadResult> {
  const result = await requestBrowserJson<{ settings: UserSettingsSnapshot }>('/api/user/settings', {
    method: 'GET',
    signal: scope.signal,
    headers: scope.expectedUserId ? { 'X-Expected-User-Id': scope.expectedUserId } : undefined,
  });
  return {
    settings: result.error ? null : result.data?.settings ?? normalizeUserSettings(null),
    error: result.error,
  };
}

/**
 * 读取当前用户设置，staleTime 内复用 TanStack 缓存；设置写入经 mutationEffects.userSettings 立即失效。
 * 读取失败时抛错且不写入缓存，由调用方下一轮重试。
 */
export async function fetchCachedUserSettings(
  queryClient: QueryClient,
  userId: string,
  staleTime: number,
): Promise<UserSettingsSnapshot> {
  return await queryClient.fetchQuery({
    queryKey: queryKeys.userSettings(userId),
    queryFn: async ({ signal }) => {
      const result = await getCurrentUserSettings({ expectedUserId: userId, signal });
      if (!result.settings) {
        throw new Error(result.error?.message || '读取用户设置失败');
      }
      return result.settings;
    },
    staleTime,
    // 轮询本身就是重试节奏；再叠加查询重试会在接口故障时成倍放大请求
    retry: false,
  });
}

export async function updateCurrentUserSettings(
  input: UserSettingsUpdateInput,
  mutationEffects?: MutationEffects,
  scope: SettingsRequestScope = {},
): Promise<UserSettingsSnapshot | null> {
  const result = await requestBrowserJson<{ settings: UserSettingsSnapshot }>('/api/user/settings', {
    method: 'PATCH',
    signal: scope.signal,
    headers: scope.expectedUserId ? { 'Content-Type': 'application/json', 'X-Expected-User-Id': scope.expectedUserId } : undefined,
    body: JSON.stringify(input),
    mutationEffects,
  });
  if (result.error) {
    return null;
  }

  // browser-api owns both declared effects and the legacy inference fallback.

  return result.data?.settings ?? null;
}
