'use client';
// 'use client'：续问队列需要编辑草稿与请求中的按钮状态

import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, Clock3, Pencil, X } from 'lucide-react';
import type { AgentRunView } from '@/lib/agent/types';
import type { ChatMessage } from '@/types';
import { requestBrowserJson } from '@/lib/browser-api';
import { useToast } from '@/components/ui/Toast';

type QueueItem = NonNullable<AgentRunView['queue']>[number];

const MODE_LABELS: Record<QueueItem['mode'], string> = { follow_up: '结束后续问', steer: '下个步骤补充', reply: '回答问题' };

/** Inputs waiting on the running task, attached to the top edge of the composer. */
export function AgentQueue({ run, restoreDraft }: { run: AgentRunView; restoreDraft: (message: ChatMessage) => void }) {
    const [busy, setBusy] = useState<number | null>(null);
    const [editing, setEditing] = useState<number | null>(null);
    const [content, setContent] = useState('');
    const { showToast } = useToast();
    const items = (run.queue ?? []).filter(command => ['pending', 'claimed', 'admitted', 'cancelled'].includes(command.state));
    if (!items.length) return null;
    const pending = items.filter(item => item.state === 'pending');
    const act = async (item: QueueItem, action: string, extra?: Record<string, unknown>) => {
        setBusy(item.sequence);
        try {
            const result = await requestBrowserJson(`/api/agent/runs/${run.id}/queue`, { method: 'PATCH', body: JSON.stringify({ sequence: item.sequence, revision: item.revision, action, ...extra }) });
            if (result.error) showToast('error', result.error.message);
            else setEditing(null);
        } finally { setBusy(null); }
    };
    return <section className="agent-queue" aria-label="续问队列">
        {items.map(item => {
            const position = pending.indexOf(item);
            if (editing === item.sequence) return <form key={item.sequence} className="agent-queue-row is-editing" onSubmit={event => { event.preventDefault(); void act(item, 'edit', { content }); }}>
                <textarea aria-label="编辑排队的续问" value={content} rows={2} maxLength={32000} autoFocus onChange={event => setContent(event.target.value)} />
                <div><button type="button" className="agent-queue-text" onClick={() => setEditing(null)}>取消</button>
                    <button type="submit" className="agent-queue-save" disabled={busy !== null || !content.trim()}>保存</button></div>
            </form>;
            if (item.state === 'cancelled') return <div key={item.sequence} className="agent-queue-row is-cancelled">
                <span className="agent-queue-mode">已撤回</span>
                <s className="agent-queue-content">{item.message.content}</s>
                <button type="button" className="agent-queue-text" onClick={() => restoreDraft(item.message)}>恢复为草稿</button>
            </div>;
            if (item.state !== 'pending') return <div key={item.sequence} className="agent-queue-row is-locked">
                <span className="agent-queue-mode">{MODE_LABELS[item.mode]}</span>
                <span className="agent-queue-content">{item.message.content}</span>
                <span className="agent-queue-state">已交给 Agent · 锁定</span>
            </div>;
            return <div key={item.sequence} className="agent-queue-row">
                {position === 0 && <Clock3 size={14} aria-hidden="true" className="agent-queue-icon" />}
                <span className="agent-queue-mode">{MODE_LABELS[item.mode]}</span>
                <span className="agent-queue-content" title={item.message.content}>{item.message.content}</span>
                {item.mode !== 'reply' && <button type="button" className="agent-queue-icon-button" aria-label="提前处理" title="提前处理：在下个安全步骤交给 Agent" disabled={busy !== null} onClick={() => void act(item, 'promote')}><ChevronsUp size={14} /></button>}
                {pending.length > 1 && <>
                    <button type="button" className="agent-queue-icon-button" aria-label="队列上移" disabled={busy !== null || position === 0} onClick={() => void act(item, 'order', { sortOrder: pending[position - 1].sortOrder - 1 })}><ArrowUp size={14} /></button>
                    <button type="button" className="agent-queue-icon-button" aria-label="队列下移" disabled={busy !== null || position === pending.length - 1} onClick={() => void act(item, 'order', { sortOrder: pending[position + 1].sortOrder + 1 })}><ArrowDown size={14} /></button>
                </>}
                <button type="button" className="agent-queue-icon-button" aria-label="编辑排队的续问" disabled={busy !== null} onClick={() => { setEditing(item.sequence); setContent(item.message.content); }}><Pencil size={14} /></button>
                <button type="button" className="agent-queue-icon-button" aria-label="撤回排队的续问" disabled={busy !== null} onClick={() => void act(item, 'withdraw')}><X size={14} /></button>
            </div>;
        })}
    </section>;
}
