'use client';
// 需要 useState/useEffect 管理任务助手偏好与记忆数量
import { useEffect, useRef, useState } from 'react';
import { SettingsRow, SettingsSwitch } from '@/components/settings/SettingsControls';
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
    useUnsavedSettingsGuard(!!preferences && memoryEnabled !== (preferences.memoryEnabled === true));
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        void Promise.all([
            getCurrentUserSettings({ expectedUserId: userId, signal: abort.signal }),
            requestBrowserJson<{ memories: AgentMemory[] }>('/api/user/agent-memory', { headers: { 'X-Expected-User-Id': userId }, signal: abort.signal }),
        ]).then(([settings, memory]) => {
            if (abort.signal.aborted) return;
            if (settings.error || !settings.settings) { setError('读取任务助手设置失败，请刷新后重试'); return; }
            const prefs = settings.settings.chatPreferences;
            setPreferences(prefs); setMemoryEnabled(prefs.memoryEnabled === true);
            if (!memory.error) setMemoryCount(memory.data?.memories?.length ?? 0);
        }).catch(() => { if (!abort.signal.aborted) setError('读取任务助手设置失败，请刷新后重试'); });
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
            if (!result) showToast('error', '保存任务助手设置失败');
            else { setPreferences(result.chatPreferences); setMemoryEnabled(result.chatPreferences.memoryEnabled === true); showToast('success', '任务助手设置已保存'); }
        } catch { if (active && !active.signal.aborted) showToast('error', '保存任务助手设置失败'); }
        finally { if (active && !active.signal.aborted) setBusy(false); }
    };
    return <><section className="settings-form-section settings-form-section-divided" aria-label="任务助手设置">
        <div className="settings-form-heading">
            <h3>任务助手</h3>
            <p>长期记忆让助手记住你明确表达的偏好或事实、检索你以往的对话，并把你讲述的经历记入档案；默认关闭，关闭不会删除已保存内容。</p>
        </div>
        {error && <p role="alert" className="settings-alert">{error}</p>}
        <div className="settings-group">
            <SettingsRow
                label="长期记忆"
                description="默认关闭。开启后，助手只依据你明确表达的内容保存长期偏好或事实，可检索你的其他对话，并把你讲述的过往经历按原话记入命理记录或八字断事笔记；关闭不会删除已保存内容，可随时查看和删除。"
                control={<SettingsSwitch label="允许任务助手使用长期记忆" checked={memoryEnabled} disabled={busy || !preferences} onToggle={() => setMemoryEnabled(enabled => !enabled)} />}
            />
            <SettingsRow
                label="已保存记忆"
                description={memoryCount == null ? '查看、添加或删除助手保存的长期偏好和事实。' : `已保存 ${memoryCount} / 128 条，可查看、添加或删除。`}
                control={<button type="button" className="settings-button" disabled={!preferences} onClick={() => setManagerOpen(true)}>管理记忆</button>}
            />
        </div>
        <div className="settings-actions">
            <button type="button" disabled={busy || !preferences} onClick={() => void save()} className="settings-button settings-button-primary">保存任务助手设置</button>
        </div>
    </section>
    <CollaborationSettings userId={userId} />
    <MemoryManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} userId={userId} onCountChange={setMemoryCount} />
    </>;
}
