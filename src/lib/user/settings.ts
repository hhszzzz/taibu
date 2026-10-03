import { requestBrowserJson, type BrowserApiError } from '@/lib/browser-api';
import type { MutationEffects } from '@/lib/query/invalidation';
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

export const DEFAULT_MOBILE_MAIN_ITEMS = [
  'liuyao', 'chat', 'daily',
] as const;

export const DEFAULT_MOBILE_DRAWER_ORDER = [
  'bazi', 'records', 'community', 'hepan', 'ziwei', 'tarot', 'meihua', 'qimen', 'daliuren', 'xiaoliuren',
  'face', 'palm', 'mbti', 'monthly', 'settings-profile', 'settings-general',
  'settings-upgrade',
  'settings-personalization', 'settings-knowledge-base', 'settings-help',
  'settings-charts',
] as const;

type UserSettingsRow = {
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
