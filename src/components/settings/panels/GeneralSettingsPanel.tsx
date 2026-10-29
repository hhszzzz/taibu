/**
 * 用户设置页面内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理用户设置加载与保存
 * - 该模块供统一设置中心复用
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { SettingsSelect } from '@/components/settings/SettingsSelect';
import { SettingsChoiceCards, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsControls';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { loadReminderSubscriptions, type ReminderType, updateReminderSubscriptionClient } from '@/lib/reminders-client';
import { mutationEffects } from '@/lib/query/invalidation';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { FONT_SCALES, type FontScale } from '@/lib/chat/preferences';
import {
  canEnableBrowserNotifications,
  getBrowserNotificationAvailability,
  type BrowserNotificationAvailability,
} from '@/lib/notification';

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
  description: string;
}> = [
  { type: 'solar_term', label: '节气提醒', description: '交节当天早上提醒，附养生建议' },
  { type: 'fortune', label: '运势提醒', description: '按默认命盘，遇大吉日或低谷日时提醒' },
  { type: 'key_date', label: '关键日提醒', description: '按默认命盘排出当月关键日，当天早上提醒' },
];

const THEME_MODE_OPTIONS = [
  { value: 'light', label: '浅色', preview: ['is-light is-sidebar', 'is-light'] },
  { value: 'dark', label: '深色', preview: ['is-dark is-sidebar', 'is-dark'] },
  { value: 'system', label: '跟随系统', preview: ['is-light', 'is-dark'] },
] as const;

const FONT_SCALE_LABELS: Record<FontScale, string> = { 85: '小', 100: '标准', 115: '大', 125: '特大' };
const FONT_SCALE_OPTIONS = FONT_SCALES.map(scale => ({ value: String(scale), label: FONT_SCALE_LABELS[scale] }));

/** 浏览器通知是否可用只取决于浏览器能力与授权状态。 */
function readBrowserNotificationAvailability(): BrowserNotificationAvailability {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return getBrowserNotificationAvailability({ supported: true, permission: window.Notification.permission });
}

export default function GeneralSettingsPanel() {
  const { user } = useSessionSafe();
  return <AccountGeneralSettingsPanel key={user?.id ?? 'visitor'} />;
}

function AccountGeneralSettingsPanel() {
  const { themeMode, setThemeMode, fontScale, setFontScale } = useTheme();
  const { user, loading: sessionLoading } = useSessionSafe();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [desktopNotifications, setDesktopNotifications] = useState(false);
  const [desktopError, setDesktopError] = useState('');
  const [browserNotificationAvailability, setBrowserNotificationAvailability] = useState<BrowserNotificationAvailability>('unsupported');
  const [settings, setSettings] = useState<Settings>({
    notifications: true,
    language: 'zh',
  });
  const [reminders, setReminders] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [reminderLoadError, setReminderLoadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const operations = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [initializedForUserId, setInitializedForUserId] = useState<string | null | undefined>(undefined);

  // 浏览器能力/授权只在客户端可读；设置面板挂载后同步一次。
  useEffect(() => {
    setBrowserNotificationAvailability(readBrowserNotificationAvailability());
  }, [userId]);

  const load = useCallback(async () => {
    if (sessionLoading) return;
    if (!userId) {
      setLoading(false);
      setRemindersLoading(false);
      setReminderLoadError(null);
      setLoadError(null);
      return;
    }

    lifecycle.current?.abort();
    const controller = new AbortController();
    lifecycle.current = controller;
    const scope = { expectedUserId: userId, signal: controller.signal };
    setLoading(true);
    setRemindersLoading(true);

    try {
      const [settingsResult, remindersResult] = await Promise.allSettled([
        getCurrentUserSettings(scope),
        loadReminderSubscriptions(scope),
      ]);

      if (controller.signal.aborted) return;
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
      setDesktopNotifications(settingsResult.value.settings?.chatPreferences?.desktopNotifications ?? false);

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
      if (controller.signal.aborted) return;
      console.error('加载用户设置失败:', error);
      setLoadError('加载偏好设置失败');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRemindersLoading(false);
      }
    }
  }, [sessionLoading, userId]);

  useEffect(() => {
    if (sessionLoading) return;
    if (initializedForUserId === userId) return;

    setInitializedForUserId(userId);
    void load();
  }, [initializedForUserId, load, sessionLoading, userId]);

  useEffect(() => () => lifecycle.current?.abort(), []);

  const beginOperation = (key: string) => {
    if (operations.current.has(key)) return false;
    operations.current.add(key);
    setPending(new Set(operations.current));
    return true;
  };
  const finishOperation = (key: string) => {
    operations.current.delete(key);
    setPending(new Set(operations.current));
  };

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const controller = lifecycle.current;
    if (!userId || loadError || loading || !controller || controller.signal.aborted || !beginOperation(key)) return;
    const previousValue = settings[key];
    setSettings(current => ({ ...current, [key]: value }));

    const saved = await updateCurrentUserSettings(
      key === 'notifications'
        ? { notificationsEnabled: value as boolean }
        : { language: value as Settings['language'] },
      mutationEffects.userSettings(userId),
      { expectedUserId: userId, signal: controller.signal },
    ).catch(() => null);
    if (controller.signal.aborted) return;
    finishOperation(key);

    if (!saved) {
      console.error('更新偏好设置失败');
      setSettings(current => ({ ...current, [key]: previousValue }));
    }
  };

  const updateReminderSetting = async (type: ReminderType) => {
    const controller = lifecycle.current;
    if (!userId || loadError || loading || !controller || controller.signal.aborted || !beginOperation(type)) return;

    const previousEnabled = reminders[type];
    const nextEnabled = !previousEnabled;
    setReminders((prev) => ({ ...prev, [type]: nextEnabled }));

    try {
      const result = await updateReminderSubscriptionClient({
        reminderType: type,
        enabled: nextEnabled,
        notifySite: true,
      }, { expectedUserId: userId, signal: controller.signal });
      if (controller.signal.aborted) return;

      if (!result.ok) {
        throw new Error(result.error.message || '更新提醒状态失败');
      }
      setReminderLoadError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('更新提醒状态失败:', error);
      setReminders((prev) => ({ ...prev, [type]: previousEnabled }));
    } finally {
      if (!controller.signal.aborted) finishOperation(type);
    }
  };

  const toggleDesktopNotifications = async () => {
    if (!userId || loadError || loading || !beginOperation('desktopNotifications')) return;
    setDesktopError('');
    try {
      const next = !desktopNotifications;
      if (next) {
        const availability = readBrowserNotificationAvailability();
        setBrowserNotificationAvailability(availability);
        if (!canEnableBrowserNotifications(availability)) {
          setDesktopError(availability === 'unsupported'
            ? '当前浏览器不支持系统通知'
            : '浏览器已拒绝通知权限，请在浏览器设置中允许后重试');
          return;
        }
        if (availability === 'prompt') {
          let permission: string;
          try {
            permission = await window.Notification.requestPermission();
          } catch {
            setDesktopError('浏览器通知授权失败，请重试');
            return;
          }
          const resolved = getBrowserNotificationAvailability({ supported: true, permission });
          setBrowserNotificationAvailability(resolved);
          if (resolved !== 'granted') {
            setDesktopError('浏览器通知需要授权才能开启');
            return;
          }
        }
      }
      const current = await getCurrentUserSettings({ expectedUserId: userId });
      const saved = current.settings
        ? await updateCurrentUserSettings({ chatPreferences: { ...current.settings.chatPreferences, desktopNotifications: next } }, mutationEffects.userSettings(userId), { expectedUserId: userId })
        : null;
      if (saved) setDesktopNotifications(next);
      else setDesktopError('保存浏览器通知偏好失败');
    } finally {
      finishOperation('desktopNotifications');
    }
  };

  const changeFontScale = (value: string) => {
    const scale = Number(value) as FontScale;
    setFontScale(scale);
    if (!userId) return;
    void getCurrentUserSettings({ expectedUserId: userId }).then(current => current.settings && updateCurrentUserSettings({ chatPreferences: { ...current.settings.chatPreferences, fontScale: scale } }, mutationEffects.userSettings(userId), { expectedUserId: userId }));
  };

  if (loading || sessionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired />;
  }

  return (
    <div>
      {loadError ? <div role="alert" className="settings-alert">{loadError}</div> : null}

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3 className="settings-section-title">外观</h3>
          <p className="settings-section-description">选择适合阅读环境的界面明暗。</p>
        </div>
        <div className="settings-section-body">
          <SettingsChoiceCards
            ariaLabel="外观"
            value={themeMode}
            onChange={setThemeMode}
            options={THEME_MODE_OPTIONS.map(option => ({
              value: option.value,
              label: option.label,
              preview: (
                <span aria-hidden="true" className={`settings-theme-preview is-${option.value}`}>
                  <span className="settings-theme-preview-bar"><i /><i /><i /></span>
                  <span className="settings-theme-preview-body">
                    {option.preview.map(part => <span key={part} className={part} />)}
                  </span>
                </span>
              ),
            }))}
          />
        </div>
      </section>

      <SettingsSection title="基础偏好">
        <SettingsRow
          label="全站字号"
          description="页面、命盘与对话文字一起缩放"
          control={<SegmentedChoice ariaLabel="全站字号" value={String(fontScale)} onChange={changeFontScale} options={FONT_SCALE_OPTIONS} maxWidth={260} />}
        />
        <SettingsRow
          label="语言"
          description="English 即将上线"
          controlId="settings-language"
          control={(
            <SettingsSelect
              id="settings-language"
              ariaLabel="语言"
              value={settings.language}
              onChange={(value) => updateSetting('language', value)}
              disabled={Boolean(loadError) || pending.has('language')}
              options={[
                { value: 'zh', label: '简体中文' },
                { value: 'en', label: 'English (即将上线)', disabled: true },
              ]}
            />
          )}
        />
      </SettingsSection>

      <SettingsSection title="通知与提醒">
        {reminderLoadError ? (
          <div role="alert" className="settings-alert">
            <span className="min-w-0 flex-1">{reminderLoadError}</span>
            <button type="button" disabled={pending.size > 0} onClick={() => void load()}>重试</button>
          </div>
        ) : null}
        <SettingsRow
          label="推送通知"
          description="关闭后，提醒和后台任务完成通知都不再推送"
          control={(
            <SettingsSwitch
              label="推送通知"
              checked={settings.notifications}
              onToggle={() => updateSetting('notifications', !settings.notifications)}
              disabled={Boolean(loadError) || pending.has('notifications')}
            />
          )}
        />
        <SettingsRow
          label="浏览器通知"
          description={desktopError
            ? <span role="alert" className="text-danger">{desktopError}</span>
            : browserNotificationAvailability === 'unsupported'
              ? '当前浏览器不支持系统通知'
              : browserNotificationAvailability === 'denied'
                ? '浏览器已拒绝通知权限，请在浏览器设置中允许后重试'
                : desktopNotifications
                  ? '任务完成或失败时发送系统通知'
                  : '开启后，任务完成或失败时发送系统通知；需要浏览器授权'}
          control={(
            <SettingsSwitch
              label="浏览器通知"
              checked={desktopNotifications}
              onToggle={() => void toggleDesktopNotifications()}
              disabled={Boolean(loadError) || pending.has('desktopNotifications') || (!desktopNotifications && !canEnableBrowserNotifications(browserNotificationAvailability))}
            />
          )}
        />
        {REMINDER_ITEMS.map((item) => (
          <SettingsRow
            key={item.type}
            label={item.label}
            description={item.description}
            control={(
              <SettingsSwitch
                label={item.label}
                checked={reminders[item.type]}
                onToggle={() => updateReminderSetting(item.type)}
                disabled={Boolean(loadError) || Boolean(reminderLoadError) || remindersLoading || pending.has(item.type)}
              />
            )}
          />
        ))}
      </SettingsSection>
    </div>
  );
}
