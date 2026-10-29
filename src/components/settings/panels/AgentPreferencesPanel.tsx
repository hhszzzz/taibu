'use client';
// 需要 useState/useEffect 管理记忆偏好与记忆数量
import { useEffect, useRef, useState } from 'react';
import { SettingsRow, SettingsSaveBar, SettingsSwitch } from '@/components/settings/SettingsControls';
import { useToast } from '@/components/ui/Toast';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { requestBrowserJson } from '@/lib/browser-api';
import type { ChatPreferences } from '@/lib/chat/preferences';
import type { AgentMemory } from '@/lib/agent/memory';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { CollaborationSettings } from '@/components/settings/CollaborationSettings';
import { MemoryManagerDialog } from '@/components/settings/MemoryManagerDialog';

export function AgentPreferencesPanel({ userId }: { userId: string }) {
    const [preferences, setPreferences] = useState<ChatPreferences | null>(null), [memoryEnabled, setMemoryEnabled] = useState(false);
    const [memoryCount, setMemoryCount] = useState<number | null>(null), [managerOpen, setManagerOpen] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const { showToast } = useToast();
    const dirty = !!preferences && memoryEnabled !== (preferences.memoryEnabled === true);
    useUnsavedSettingsGuard(dirty);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        void Promise.all([
            getCurrentUserSettings({ expectedUserId: userId, signal: abort.signal }),
            requestBrowserJson<{ memories: AgentMemory[] }>('/api/user/agent-memory', { headers: { 'X-Expected-User-Id': userId }, signal: abort.signal }),
        ]).then(([settings, memory]) => {
            if (abort.signal.aborted) return;
            if (settings.error || !settings.settings) { setError('读取记忆设置失败，请刷新后重试'); return; }
            const prefs = settings.settings.chatPreferences;
            setPreferences(prefs); setMemoryEnabled(prefs.memoryEnabled === true);
            if (!memory.error) setMemoryCount(memory.data?.memories?.length ?? 0);
        }).catch(() => { if (!abort.signal.aborted) setError('读取记忆设置失败，请刷新后重试'); });
        return () => { abort.abort(); controller.current = null; };
    }, [userId]);
    const save = async () => {
        const active = controller.current;
        if (!preferences) return;
        setBusy(true);
        try {
            // PATCH 只带变更字段；服务端与存储中的其它偏好（如旧版遗留的模板数据）原样保留。
            const result = await updateCurrentUserSettings({ chatPreferences: { memoryEnabled } }, undefined, { expectedUserId: userId, signal: controller.current?.signal });
            if (!active || active.signal.aborted) return;
            if (!result) showToast('error', '保存记忆设置失败');
            else { setPreferences(result.chatPreferences); setMemoryEnabled(result.chatPreferences.memoryEnabled === true); showToast('success', '记忆设置已保存'); }
        } catch { if (active && !active.signal.aborted) showToast('error', '保存记忆设置失败'); }
        finally { if (active && !active.signal.aborted) setBusy(false); }
    };
    return <><section className="settings-form-section settings-form-section-divided" aria-label="记忆设置">
        <div className="settings-form-heading">
            <h3>记忆</h3>
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
                  control={<button type="button" className="settings-button" disabled={!preferences} onClick={() => setManagerOpen(true)}>管理记忆</button>}
              />
          </div>
          {dirty ? <SettingsSaveBar
              message="记忆设置有未保存的更改"
              saving={busy}
              saveDisabled={!preferences}
              saveLabel="保存设置"
              sticky={false}
              onCancel={() => setMemoryEnabled(preferences?.memoryEnabled === true)}
              onSave={() => void save()}
          /> : null}
        </div>
    </section>
    <CollaborationSettings userId={userId} />
    <MemoryManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} userId={userId} onCountChange={setMemoryCount} />
    </>;
}
