'use client';
// 需要 useState/useEffect 管理记忆列表与请求生命周期
import { useEffect, useRef, useState } from 'react';
import { SettingsRow, SettingsSwitch } from '@/components/settings/SettingsControls';
import { useToast } from '@/components/ui/Toast';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { requestBrowserJson } from '@/lib/browser-api';
import type { ChatPreferences } from '@/lib/chat/preferences';
import type { AgentMemory } from '@/lib/agent/memory';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { CollaborationSettings } from '@/components/settings/CollaborationSettings';

export function AgentPreferencesPanel({ userId }: { userId: string }) {
    const [preferences, setPreferences] = useState<ChatPreferences | null>(null), [memoryEnabled, setMemoryEnabled] = useState(false);
    const [memories, setMemories] = useState<AgentMemory[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [title, setTitle] = useState(''), [content, setContent] = useState('');
    const controller = useRef<AbortController | null>(null);
    const { showToast } = useToast();
    useUnsavedSettingsGuard(!!preferences && (memoryEnabled !== (preferences.memoryEnabled === true) || !!title || !!content));
    const request = <T,>(method: string, body?: unknown) => requestBrowserJson<T>('/api/user/agent-memory', { method, headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': userId }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.current?.signal });
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        void Promise.all([getCurrentUserSettings({ expectedUserId: userId, signal: abort.signal }), requestBrowserJson<{ memories: AgentMemory[] }>('/api/user/agent-memory', { headers: { 'X-Expected-User-Id': userId }, signal: abort.signal })]).then(([settings, memory]) => {
            if (abort.signal.aborted) return;
            if (settings.error || !settings.settings) { setError('读取任务助手设置失败，请刷新后重试'); return; }
            const prefs = settings.settings.chatPreferences;
            setPreferences(prefs); setMemoryEnabled(prefs.memoryEnabled === true);
            if (memory.error) setError('读取长期记忆失败，请刷新后重试');
            else setMemories(memory.data?.memories ?? []);
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
    const mutateMemory = async (method: 'POST' | 'DELETE', body: unknown) => {
        const active = controller.current;
        setBusy(true);
        try {
            const result = await request<{ memory?: AgentMemory }>(method, body);
            if (!active || active.signal.aborted) return;
            if (result.error) { showToast('error', result.error.message); return; }
            const refreshed = await request<{ memories: AgentMemory[] }>('GET');
            if (!active.signal.aborted && !refreshed.error) setMemories(refreshed.data?.memories ?? []);
            if (method === 'POST') { setTitle(''); setContent(''); }
        } catch { if (active && !active.signal.aborted) showToast('error', '更新长期记忆失败'); }
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
        </div>
        <div className="settings-actions">
            <button type="button" disabled={busy || !preferences} onClick={() => void save()} className="settings-button settings-button-primary">保存任务助手设置</button>
        </div>
        <div className="settings-field-block">
            <h4 className="settings-label">已保存记忆 <span className="settings-counter">{memories.length} / 128</span></h4>
            {memories.length > 0
                ? <ul className="settings-list-card">{memories.map(memory => <li key={memory.id} className="settings-list-item">
                    <div className="settings-list-item-text"><strong>{memory.title}</strong><p>{memory.content}</p></div>
                    <button type="button" disabled={busy} className="settings-text-button-danger" onClick={() => void mutateMemory('DELETE', { id: memory.id })} aria-label={`删除记忆 ${memory.title}`}>删除</button>
                </li>)}</ul>
                : <p className="settings-help">尚未保存记忆。</p>}
            <input disabled={busy} className="settings-input" aria-label="新记忆标题" placeholder="记忆标题" maxLength={80} value={title} onChange={event => setTitle(event.target.value)} />
            <textarea disabled={busy} className="settings-textarea" aria-label="新记忆正文" placeholder="主动保存希望长期保留的偏好或事实" maxLength={2000} value={content} onChange={event => setContent(event.target.value)} rows={2} />
            <div className="settings-actions">
                <button type="button" disabled={busy || !preferences || !title.trim() || !content.trim()} className="settings-button" onClick={() => void mutateMemory('POST', { title, content, kind: 'context' })}>保存这条记忆</button>
            </div>
        </div>
    </section>
    <CollaborationSettings userId={userId} />
    </>;
}
