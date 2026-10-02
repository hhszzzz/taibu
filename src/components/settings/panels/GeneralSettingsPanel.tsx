/**
 * 用户设置页面内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理用户设置加载与保存
 * - 该模块供统一设置中心复用
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { loadReminderSubscriptions, type ReminderType, updateReminderSubscriptionClient } from '@/lib/reminders-client';
import { mutationEffects } from '@/lib/query/invalidation';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';

interface Settings {
  notifications: boolean;
  language: 'zh' | 'en';
}

type ReminderSettings = Record<ReminderType, boolean>;

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  solar_term: false,
  fortune: false,
  key_date: false,
};

const REMINDER_ITEMS: Array<{
  type: ReminderType;
  label: string;
}> = [
  {
    type: 'solar_term',
    label: '节气提醒',
  },
  {
    type: 'fortune',
    label: '运势提醒',
  },
  {
    type: 'key_date',
    label: '关键日提醒',
  },
];

const THEME_MODE_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '自动' },
] as const;

function SectionTitle({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-foreground/50">
      <span>{children}</span>
    </h2>
  );
}

function Row({
  title,
  control,
}: {
  title: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      {control}
    </div>
  );
}

function PreferenceSwitch({
  checked,
  onToggle,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-150 ${
        checked
          ? 'bg-[#2383e2]'
          : 'bg-[#d8d2c8] dark:bg-background-tertiary'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function GeneralSettingsPanel() {
  const { themeMode, setThemeMode } = useTheme();
  const { user, loading: sessionLoading } = useSessionSafe();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>({
    notifications: true,
    language: 'zh',
  });
  const [reminders, setReminders] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [reminderLoadError, setReminderLoadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initializedForUserId, setInitializedForUserId] = useState<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (sessionLoading) return;
    if (!userId) {
      setLoading(false);
      setRemindersLoading(false);
      setReminderLoadError(null);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setRemindersLoading(true);

    try {
      const [settingsResult, remindersResult] = await Promise.allSettled([
        getCurrentUserSettings(),
        loadReminderSubscriptions(),
      ]);

      if (settingsResult.status === 'rejected') {
        setLoadError('加载偏好设置失败');
        return;
      }

      if (settingsResult.value.error) {
        setLoadError(settingsResult.value.error.message || '加载偏好设置失败');
        return;
      }

      setLoadError(null);
      setSettings({
        notifications: settingsResult.value.settings?.notificationsEnabled ?? true,
        language: settingsResult.value.settings?.language ?? 'zh',
      });

      if (remindersResult.status === 'fulfilled') {
        if (remindersResult.value.ok) {
          setReminderLoadError(null);
          setReminders(
            remindersResult.value.subscriptions.reduce<ReminderSettings>((acc, item) => {
              acc[item.reminderType] = item.enabled;
              return acc;
            }, { ...DEFAULT_REMINDER_SETTINGS }),
          );
        } else {
          setReminderLoadError(remindersResult.value.error.message || '加载提醒状态失败');
          setReminders({ ...DEFAULT_REMINDER_SETTINGS });
        }
      } else {
        console.error('加载提醒状态失败:', remindersResult.reason);
        setReminderLoadError(
          remindersResult.reason instanceof Error
            ? remindersResult.reason.message
            : '加载提醒状态失败',
        );
        setReminders({ ...DEFAULT_REMINDER_SETTINGS });
      }
    } catch (error) {
      console.error('加载用户设置失败:', error);
      setLoadError('加载偏好设置失败');
    } finally {
      setLoading(false);
      setRemindersLoading(false);
    }
  }, [sessionLoading, userId]);

  useEffect(() => {
    if (sessionLoading) return;
    if (initializedForUserId === userId) return;

    setInitializedForUserId(userId);
    void load();
  }, [initializedForUserId, load, sessionLoading, userId]);

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (!userId || loadError) return;

    const previousSettings = settings;
    const nextSettings = { ...settings, [key]: value };
    setSettings(nextSettings);

    const saved = await updateCurrentUserSettings(
      key === 'notifications'
        ? { notificationsEnabled: value as boolean }
        : { language: value as Settings['language'] },
      mutationEffects.userSettings(userId),
    );

    if (!saved) {
      console.error('更新偏好设置失败');
      setSettings(previousSettings);
    }
  };

  const updateReminderSetting = async (type: ReminderType) => {
    if (!userId || loadError) return;

    const previousEnabled = reminders[type];
    const nextEnabled = !previousEnabled;
    setReminders((prev) => ({ ...prev, [type]: nextEnabled }));

    try {
      const result = await updateReminderSubscriptionClient({
        reminderType: type,
        enabled: nextEnabled,
        notifySite: true,
      });

      if (!result.ok) {
        throw new Error(result.error.message || '更新提醒状态失败');
      }
      setReminderLoadError(null);
    } catch (error) {
      console.error('更新提醒状态失败:', error);
      setReminders((prev) => ({ ...prev, [type]: previousEnabled }));
    }
  };

  if (loading || sessionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-border bg-background">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired />;
  }

  return (
    <div className="space-y-8">
      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {loadError}
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionTitle>基础偏好</SectionTitle>
        <div className="space-y-2">
          <Row
            title="外观界面"
            control={(
              <SegmentedChoice
                ariaLabel="外观界面"
                value={themeMode}
                onChange={setThemeMode}
                options={THEME_MODE_OPTIONS}
              />
            )}
          />

          <Row
            title="语言设置"
            control={(
              <select
                value={settings.language}
                onChange={(event) => updateSetting('language', event.target.value as 'zh' | 'en')}
                disabled={Boolean(loadError)}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground outline-none transition-colors duration-150 focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="zh">简体中文</option>
                <option value="en" disabled>English (即将上线)</option>
              </select>
            )}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>通知与提醒</SectionTitle>
        {reminderLoadError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <span className="min-w-0 flex-1">{reminderLoadError}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-md px-2 py-1 font-medium transition-colors hover:bg-amber-100"
            >
              重试
            </button>
          </div>
        ) : null}
        <div className="space-y-2">
          <Row
            title="推送通知"
            control={(
              <PreferenceSwitch
                checked={settings.notifications}
                onToggle={() => updateSetting('notifications', !settings.notifications)}
                disabled={Boolean(loadError)}
              />
            )}
          />

          {REMINDER_ITEMS.map((item) => {
            return (
              <Row
                key={item.type}
                title={item.label}
                control={(
                  <PreferenceSwitch
                    checked={reminders[item.type]}
                    onToggle={() => updateReminderSetting(item.type)}
                    disabled={Boolean(loadError) || Boolean(reminderLoadError) || remindersLoading}
                  />
                )}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
