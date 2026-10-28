import type { SettingsRequestScope } from '@/lib/user/settings';
import { requestBrowserJson, type BrowserApiError } from '@/lib/browser-api';

export type ReminderType = 'solar_term' | 'fortune' | 'key_date';

export type ReminderSubscriptionSnapshot = {
  reminderType: ReminderType;
  enabled: boolean;
  notifyEmail: boolean;
  notifySite: boolean;
};

export type ReminderSubscriptionsResult =
  | { ok: true; subscriptions: ReminderSubscriptionSnapshot[] }
  | { ok: false; error: BrowserApiError };

const DEFAULT_REMINDER_ERROR = '加载提醒状态失败';

export async function loadReminderSubscriptions(scope: SettingsRequestScope = {}): Promise<ReminderSubscriptionsResult> {
  const result = await requestBrowserJson<{
    subscriptions?: ReminderSubscriptionSnapshot[];
  }>('/api/reminders', {
    method: 'GET',
    signal: scope.signal,
    headers: scope.expectedUserId ? { 'X-Expected-User-Id': scope.expectedUserId } : undefined,
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error,
    };
  }

  if (!Array.isArray(result.data?.subscriptions)) {
    return {
      ok: false,
      error: { message: DEFAULT_REMINDER_ERROR },
    };
  }

  return {
    ok: true,
    subscriptions: result.data.subscriptions,
  };
}

export async function updateReminderSubscriptionClient(input: {
  reminderType: ReminderType;
  enabled: boolean;
  notifySite?: boolean;
  notifyEmail?: boolean;
}, scope: SettingsRequestScope = {}): Promise<{ ok: true } | { ok: false; error: BrowserApiError }> {
  const result = await requestBrowserJson<{ scheduled?: number }>('/api/reminders', {
    method: 'POST',
    signal: scope.signal,
    headers: scope.expectedUserId ? { 'Content-Type': 'application/json', 'X-Expected-User-Id': scope.expectedUserId } : undefined,
    body: JSON.stringify({
      reminderType: input.reminderType,
      enabled: input.enabled,
      notifySite: input.notifySite ?? true,
      notifyEmail: input.notifyEmail ?? false,
    }),
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error,
    };
  }

  return { ok: true };
}
