'use client';
// 需要菜单开关状态与浮层锚点（用户消息的更多操作）

import { useRef, useState } from 'react';
import { BookOpenText, Check, ChevronLeft, ChevronRight, Copy, Ellipsis, Pencil, RefreshCw, GitFork } from 'lucide-react';
import type { ChatMessage } from '@/types';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';

/** One action vocabulary and focus behavior for user and assistant turns. */
export function MessageActions({ message, disabled = false, copied, onCopy, onEdit, onRegenerate, onArchive, onSwitchVersion }: {
    message: ChatMessage;
    disabled?: boolean;
    copied: boolean;
    onCopy: () => void;
    onEdit?: () => void;
    onRegenerate?: (id: string) => void;
    onArchive?: (message: ChatMessage) => void;
    onSwitchVersion?: (id: string, index: number) => void;
}) {
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const ref = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const isUser = message.role === 'user';
    const readOnly = message.metadata?.forkHistory === true;
    // This label is rendered during SSR as well, so it must not depend on localStorage.
    const model = message.modelName || message.model || '';
    const index = message.currentVersionIndex ?? (message.versions?.length ?? 1) - 1;
    const actions = [
        { label: copied ? '已复制' : '复制消息', icon: copied ? Check : Copy, run: onCopy },
        ...(!disabled && !readOnly && isUser && onEdit ? [{ label: '编辑消息', icon: Pencil, run: onEdit }] : []),
        ...(!disabled && !readOnly && !isUser && onRegenerate ? [{ label: '重新生成', icon: RefreshCw, run: () => onRegenerate(message.id) }] : []),
        ...(!isUser && (!message.agent || message.agent.status === 'completed') ? [{ label: '从此回答分叉', icon: GitFork, run: () => window.dispatchEvent(new CustomEvent('taibu:fork-message', { detail: message.id })) }] : []),
        ...(!disabled && !isUser && knowledgeBaseEnabled && onArchive ? [{ label: '加入知识库', icon: BookOpenText, run: () => onArchive(message) }] : []),
    ];
    // Assistant turns show every action (at most four) in the row; user turns keep two plus the menu.
    const direct = isUser ? actions.slice(0, 2) : actions;
    return <div className={`chat-message-actions${isUser ? ' is-user' : ''}`} role="group" aria-label={isUser ? '用户消息操作' : '助手消息操作'}>
        {direct.map(action => <button key={action.label} type="button" className="chat-message-action" onClick={action.run} aria-label={action.label} title={action.label === '重新生成' && model ? `${action.label} · ${model}` : action.label}><action.icon size={15} aria-hidden="true" /></button>)}
        {isUser && <>
            <button ref={ref} type="button" className="chat-message-action" aria-label="消息更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><Ellipsis size={16} /></button>
            <FloatingPanel open={open} anchorRef={ref} onClose={() => setOpen(false)} label="消息操作" align="end" className="w-44">
                {actions.map(action => <button key={action.label} type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-background-secondary" onClick={() => { setOpen(false); action.run(); }}><action.icon size={14} />{action.label}</button>)}
            </FloatingPanel>
        </>}
        {isUser && message.versions && message.versions.length > 1 && onSwitchVersion && <div className="chat-message-versions" role="group" aria-label="消息版本">
            <button type="button" className="chat-message-action" aria-label="上一版本" disabled={disabled || index === 0} onClick={() => onSwitchVersion(message.id, index - 1)}><ChevronLeft size={14} /></button>
            <span aria-live="polite">{index + 1} / {message.versions.length}</span>
            <button type="button" className="chat-message-action" aria-label="下一版本" disabled={disabled || index === message.versions.length - 1} onClick={() => onSwitchVersion(message.id, index + 1)}><ChevronRight size={14} /></button>
        </div>}
        {!isUser && !message.agent && model && <span className="chat-message-model">{model}</span>}
        {!isUser && (message.chartInfo?.baziName || message.chartInfo?.ziweiName) && <span className="chat-message-chart-label">{[message.chartInfo.baziName, message.chartInfo.ziweiName].filter(Boolean).join(' · ')}</span>}
    </div>;
}
