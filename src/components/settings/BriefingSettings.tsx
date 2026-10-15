'use client';
import { useEffect, useState } from 'react';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { loadReminderSubscriptions, updateReminderSubscriptionClient } from '@/lib/reminders-client';
import { DEFAULT_BRIEFING_PREFERENCES, initialBriefingPreferences, validBriefingPreferences, type BriefingPreferences } from '@/lib/briefing-preferences';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
export function BriefingSettings({ userId, initialPreferences, initialEnabled = false }: { userId: string; initialPreferences?: BriefingPreferences; initialEnabled?: boolean }) {
    const [preferences, setPreferences] = useState<BriefingPreferences>(initialPreferences ?? DEFAULT_BRIEFING_PREFERENCES);
    const [savedPreferences, setSavedPreferences] = useState<BriefingPreferences>(initialPreferences ?? DEFAULT_BRIEFING_PREFERENCES);
    const [enabled, setEnabled] = useState(initialEnabled);
    const [busy, setBusy] = useState(!initialPreferences);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [retry, setRetry] = useState(0);
    useUnsavedSettingsGuard(loaded && JSON.stringify(preferences) !== JSON.stringify(savedPreferences));
    useEffect(() => {
        if (initialPreferences) {
            setPreferences(initialPreferences); setSavedPreferences(initialPreferences); setEnabled(initialEnabled); setLoaded(true); setBusy(false); setError('');
            return;
        }
        const controller = new AbortController(); const scope = { expectedUserId: userId, signal: controller.signal };
        setBusy(true); setLoaded(false); setError('');
        void Promise.all([getCurrentUserSettings(scope), loadReminderSubscriptions(scope)]).then(([settings, subscriptions]) => {
            if (controller.signal.aborted) return;
            if (!settings.settings || !subscriptions.ok) throw new Error('加载早报设置失败');
            let timezone = 'Asia/Shanghai'; try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch { /* fallback */ }
            const initial = initialBriefingPreferences(settings.settings.briefingPreferences, settings.settings.briefingConfigured ?? false, timezone);
            setPreferences(initial); setSavedPreferences(initial);
            setEnabled(subscriptions.subscriptions.find(item => item.reminderType === 'daily_briefing')?.enabled ?? false);
            setLoaded(true);
        }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
        return () => controller.abort();
    }, [userId, retry, initialPreferences, initialEnabled]);
    async function save(nextEnabled: boolean) {
        if (busy || !loaded || !validBriefingPreferences(preferences)) return;
        setBusy(true); setError('');
        try {
            const settings = await updateCurrentUserSettings({ briefingPreferences: preferences }, undefined, { expectedUserId: userId });
            if (!settings) throw new Error('保存投递时间失败');
            const result = await updateReminderSubscriptionClient({ reminderType: 'daily_briefing', enabled: nextEnabled, notifySite: true }, { expectedUserId: userId });
            if (!result.ok) throw new Error(result.error.message);
            setEnabled(nextEnabled);
            setSavedPreferences(preferences);
        } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
        finally { setBusy(false); }
    }
    const zones = [...new Set([preferences.timezone, 'Asia/Shanghai', 'UTC', ...Intl.supportedValuesOf('timeZone')])];
    return <section className="settings-section">
        <div className="settings-briefing-heading">
            <div>
                <h3>每日早报</h3>
                <p>每天按时生成一份早报，送入独立对话与站内通知。默认关闭；成功生成消耗 1 积分，余额不足当天跳过，最终失败会退回预占积分。</p>
            </div>
            <SettingsSwitch label="每日早报" checked={enabled} disabled={busy || !loaded} onToggle={() => void save(!enabled)} />
        </div>
        <div className="settings-card settings-briefing-form">
            <label className="settings-field">投递时间<input aria-label="早报投递时间" type="time" value={preferences.time} disabled={busy} onChange={event => setPreferences({ ...preferences, time: event.target.value })} className="settings-input" /></label>
            <label className="settings-field min-w-[12rem] flex-1">时区<select aria-label="早报时区" value={preferences.timezone} disabled={busy} onChange={event => setPreferences({ ...preferences, timezone: event.target.value })} className="settings-select w-full">{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
            <button type="button" disabled={busy || !loaded || !validBriefingPreferences(preferences)} onClick={() => void save(enabled)} className="settings-button">保存时间</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}{!loaded && <button type="button" className="ml-2 underline" disabled={busy} onClick={() => setRetry(value => value + 1)}>重试加载</button>}</p>}
    </section>;
}
