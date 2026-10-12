'use client';
// 'use client'：问法模板弹层与语音输入依赖浏览器状态和 Web Speech API

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { SettingsCenterLink } from '@/components/settings/SettingsCenterLink';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { useToast } from '@/components/ui/Toast';
import { getCurrentUserSettings } from '@/lib/user/settings';
import type { AgentPromptTemplate } from '@/lib/agent/prompt-templates';
import { mergeSpeechDraft, speechConstructor, type SpeechSession } from '@/lib/agent/speech';

/** The user's saved question templates, loaded each time the menu opens. */
export function PromptTemplateMenu({ open, anchorRef, onClose, userId, onPick, side = 'top', align = 'start' }: {
    open: boolean;
    anchorRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    userId?: string | null;
    onPick: (template: AgentPromptTemplate) => void;
    side?: 'top' | 'bottom';
    align?: 'start' | 'end';
}) {
    const { showToast } = useToast();
    const [templates, setTemplates] = useState<{ userId: string; items: AgentPromptTemplate[] } | null>(null);
    useEffect(() => {
        if (!open || !userId) return;
        const controller = new AbortController();
        void getCurrentUserSettings({ expectedUserId: userId, signal: controller.signal }).then(result => {
            if (controller.signal.aborted) return;
            if (result.error) showToast('error', '读取问法模板失败');
            else setTemplates({ userId, items: result.settings?.chatPreferences.promptTemplates ?? [] });
        }).catch(() => { if (!controller.signal.aborted) showToast('error', '读取问法模板失败'); });
        return () => controller.abort();
    }, [open, userId, showToast]);
    const items = templates && templates.userId === userId ? templates.items : null;
    return <FloatingPanel open={open} anchorRef={anchorRef} onClose={onClose} label="问法模板" side={side} align={align} className="chat-template-menu">
        {items === null ? <p className="chat-model-note" role="status">正在读取模板…</p>
            : items.map(template => <button type="button" role="menuitem" key={template.id} onClick={() => { onPick(template); onClose(); }}>{template.name}</button>)}
        {items?.length === 0 && <p className="chat-model-note">暂无模板，请在个性化设置中添加。</p>}
        <SettingsCenterLink tab="personalization" className="chat-template-manage" onClick={onClose}>管理模板</SettingsCenterLink>
    </FloatingPanel>;
}

/** Browser speech input that appends a final transcript without overwriting later edits. */
export function useSpeechInput({ value, onChange, disabled, scopeKey }: { value: string; onChange: (value: string) => void; disabled: boolean; scopeKey: string }) {
    const { showToast } = useToast();
    const [recording, setRecording] = useState(false);
    const session = useRef<SpeechSession | null>(null);
    const current = useRef(value);
    const change = useRef(onChange);
    useEffect(() => { current.current = value; change.current = onChange; }, [value, onChange]);
    // Leaving the draft or the page ends the recording so a transcript never lands in another draft.
    useEffect(() => () => {
        const active = session.current;
        if (!active) return;
        active.onresult = null; active.onerror = null; active.onend = null;
        active.abort();
        session.current = null;
        setRecording(false);
    }, [scopeKey]);
    useEffect(() => { if (disabled) session.current?.abort(); }, [disabled]);
    const toggle = useCallback(() => {
        if (session.current) { session.current.stop(); return; }
        const Constructor = speechConstructor(window);
        if (!Constructor) { showToast('info', '当前浏览器不支持语音输入，请使用 Chrome 或 Edge'); return; }
        const recognition = new Constructor();
        const initial = current.current;
        recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = false;
        recognition.onresult = event => {
            const transcript = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join('');
            const merged = mergeSpeechDraft(initial, current.current, transcript);
            if (merged !== null) change.current(merged);
            else if (transcript) showToast('info', '输入已修改，本次语音未覆盖已有内容');
        };
        recognition.onerror = event => { if (event.error !== 'aborted') showToast('error', event.error === 'not-allowed' ? '麦克风权限被拒绝' : '语音识别未完成，请重试'); };
        recognition.onend = () => { setRecording(false); session.current = null; };
        session.current = recognition;
        try { recognition.start(); setRecording(true); showToast('info', '正在录音，点击停止。浏览器可能使用在线语音服务；识别结果只填入输入框。', 6000); }
        catch { session.current = null; showToast('error', '无法启动麦克风'); }
    }, [showToast]);
    return { recording, toggle };
}
