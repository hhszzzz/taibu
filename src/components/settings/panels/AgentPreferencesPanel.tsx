'use client';
// 需要 useState/useEffect 管理记忆偏好与记忆数量
import { useEffect, useRef, useState } from 'react';
import { SettingsChoiceCards, SettingsRow, SettingsSaveBar, SettingsSwitch } from '@/components/settings/SettingsControls';
import { useToast } from '@/components/ui/Toast';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { Button } from '@/components/ui/Button';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { requestBrowserJson } from '@/lib/browser-api';
import type { ChatPreferences, RunningSendMode } from '@/lib/chat/preferences';
import type { AgentMemory } from '@/lib/agent/memory';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { CollaborationSettings } from '@/components/settings/CollaborationSettings';
import { MemoryManagerDialog } from '@/components/settings/MemoryManagerDialog';

export function AgentPreferencesPanel({ userId }: { userId: string }) {
    const [preferences, setPreferences] = useState<ChatPreferences | null>(null), [memoryEnabled, setMemoryEnabled] = useState(false);
    const [runningSendMode, setRunningSendMode] = useState<RunningSendMode>('supplement');
    const [memoryCount, setMemoryCount] = useState<number | null>(null), [managerOpen, setManagerOpen] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const { showToast } = useToast();
    const { isFeatureEnabled, loaded: featureTogglesLoaded } = useFeatureToggles();
    // 记忆开关关闭时整段设置隐藏，接口同时返回 403。
    const memoryAvailable = !featureTogglesLoaded || isFeatureEnabled('memory');
    const memoryDirty = !!preferences && memoryEnabled !== (preferences.memoryEnabled === true);
    const sendModeDirty = !!preferences && runningSendMode !== (preferences.runningSendMode ?? 'supplement');
    const dirty = memoryDirty || sendModeDirty;
    useUnsavedSettingsGuard(dirty);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        void Promise.all([
            getCurrentUserSettings({ expectedUserId: userId, signal: abort.signal }),
            memoryAvailable
                ? requestBrowserJson<{ memories: AgentMemory[] }>('/api/user/agent-memory', { headers: { 'X-Expected-User-Id': userId }, signal: abort.signal })
                : Promise.resolve({ data: { memories: [] }, error: null }),
        ]).then(([settings, memory]) => {
            if (abort.signal.aborted) return;
            if (settings.error || !settings.settings) { setError('读取记忆设置失败，请刷新后重试'); return; }
            const prefs = settings.settings.chatPreferences;
            setPreferences(prefs); setMemoryEnabled(prefs.memoryEnabled === true);
            setRunningSendMode(prefs.runningSendMode ?? 'supplement');
            if (!memory.error) setMemoryCount(memory.data?.memories?.length ?? 0);
        }).catch(() => { if (!abort.signal.aborted) setError('读取记忆设置失败，请刷新后重试'); });
        return () => { abort.abort(); controller.current = null; };
    }, [userId, memoryAvailable]);
    const save = async () => {
        const active = controller.current;
        if (!preferences) return;
        setBusy(true);
        try {
            // 带上完整的 chatPreferences：PATCH 会整列覆盖，缺字段会被归一化成默认值。
            const result = await updateCurrentUserSettings({ chatPreferences: { ...preferences, memoryEnabled, runningSendMode } }, undefined, { expectedUserId: userId, signal: controller.current?.signal });
            if (!active || active.signal.aborted) return;
            if (!result) showToast('error', '保存设置失败');
            else {
                setPreferences(result.chatPreferences);
                setMemoryEnabled(result.chatPreferences.memoryEnabled === true);
                setRunningSendMode(result.chatPreferences.runningSendMode ?? 'supplement');
                showToast('success', '设置已保存');
            }
        } catch { if (active && !active.signal.aborted) showToast('error', '保存设置失败'); }
        finally { if (active && !active.signal.aborted) setBusy(false); }
    };
    return <>{memoryAvailable ? <section className="settings-form-section settings-form-section-divided" data-settings-highlight="personalization-memory" aria-label="记忆设置">
        <div className="settings-form-heading">
            <h3>记忆<BetaBadge /></h3>
            <p>让太卜记住你的偏好和事实，随时可以查看或删除。</p>
        </div>
        <div className="settings-form-body">
          {error && <p role="alert" className="settings-alert">{error}</p>}
          <div className="settings-group">
              <SettingsRow
                  label="长期记忆"
                  description="开启后可检索过往对话，并把值得记忆的经历写入，关闭不会删除已保存内容。"
                  control={<SettingsSwitch label="允许太卜使用长期记忆" checked={memoryEnabled} disabled={busy || !preferences} onToggle={() => setMemoryEnabled(enabled => !enabled)} />}
              />
              <SettingsRow
                  label="已保存记忆"
                  description={memoryCount == null ? '查看、添加或删除记忆。' : `已保存 ${memoryCount} 条。`}
                  control={<Button variant="secondary" size="lg" disabled={!preferences} onClick={() => setManagerOpen(true)}>管理记忆</Button>}
              />
          </div>
        </div>
    </section> : null}
    <section className="settings-form-section settings-form-section-divided" aria-label="任务进行中的发送方式">
        <div className="settings-form-heading">
            <h3>任务进行中的发送</h3>
            <p>任务还没结束时输入的新内容，不选按钮时默认按这里的方式处理。</p>
        </div>
        <div className="settings-form-body">
          <div className="settings-group">
              <div className="settings-field-block">
                  <span id="agent-running-send-label" className="settings-label">默认方式</span>
                  <SettingsChoiceCards
                      labelledBy="agent-running-send-label"
                      value={runningSendMode}
                      onChange={setRunningSendMode}
                      options={[
                          { value: 'supplement', label: '立即发送', preview: null },
                          { value: 'follow_up', label: '结束后续问', preview: null },
                      ]}
                  />
              </div>
          </div>
          {dirty ? <SettingsSaveBar
              message="Agent 设置有未保存的更改"
              saving={busy}
              saveDisabled={!preferences}
              saveLabel="保存设置"
              sticky={false}
              onCancel={() => {
                  setMemoryEnabled(preferences?.memoryEnabled === true);
                  setRunningSendMode(preferences?.runningSendMode ?? 'supplement');
              }}
              onSave={() => void save()}
          /> : null}
        </div>
    </section>
    <CollaborationSettings userId={userId} />
    <MemoryManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} userId={userId} onCountChange={setMemoryCount} />
    </>;
}
