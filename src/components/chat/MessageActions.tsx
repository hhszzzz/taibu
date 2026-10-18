'use client';
// 需要菜单开关状态与浮层锚点（用户消息的更多操作）

import { BookOpenText, Check, ChevronLeft, ChevronRight, Copy, Pencil, RefreshCw, GitFork, RotateCcw } from 'lucide-react';
import type { ChatMessage } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatNotificationTime } from '@/lib/notification-view';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';

/** One action vocabulary and focus behavior for user and assistant turns. */
export function MessageActions({ message, disabled = false, copied, onCopy, onEdit, onRetry, onRegenerate, onArchive, onSwitchVersion }: {
    message: ChatMessage;
    disabled?: boolean;
    copied: boolean;
    onCopy: () => void;
    onEdit?: () => void;
    /** 用户消息「退回」：从这条消息重新生成回复。 */
    onRetry?: () => void;
    onRegenerate?: (id: string) => void;
    onArchive?: (message: ChatMessage) => void;
    onSwitchVersion?: (id: string, index: number) => void;
}) {
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const isUser = message.role === 'user';
    const readOnly = message.metadata?.forkHistory === true;
    // This label is rendered during SSR as well, so it must not depend on localStorage.
    const model = message.modelName || message.model || '';
    const index = message.currentVersionIndex ?? (message.versions?.length ?? 1) - 1;
    const actions = [
        ...(!disabled && !readOnly && isUser && onRetry ? [{ label: '退回', icon: RotateCcw, run: onRetry }] : []),
        { label: copied ? '已复制' : '复制消息', icon: copied ? Check : Copy, run: onCopy },
        ...(!disabled && !readOnly && isUser && onEdit ? [{ label: '编辑消息', icon: Pencil, run: onEdit }] : []),
        ...(!disabled && !readOnly && !isUser && onRegenerate ? [{ label: '重新生成', icon: RefreshCw, run: () => onRegenerate(message.id) }] : []),
        ...(!isUser && (!message.agent || message.agent.status === 'completed') ? [{ label: '从此回答分叉', icon: GitFork, run: () => window.dispatchEvent(new CustomEvent('taibu:fork-message', { detail: message.id })) }] : []),
        ...(!disabled && !isUser && knowledgeBaseEnabled && onArchive ? [{ label: '加入知识库', icon: BookOpenText, run: () => onArchive(message) }] : []),
    ];
    // 用户与助手都把全部操作直接排在行内（claude 同款）；用户行不再有重复的「更多」菜单。
    const direct = actions;
    return <div className={`chat-message-actions${isUser ? ' is-user' : ''}`} role="group" aria-label={isUser ? '用户消息操作' : '助手消息操作'}>
        {/* cds RelativeTime：用户行时间戳在操作键最前，助手行在最后（claude 实测 ps-sm/pe-sm first/last 归零） */}
        {isUser && message.createdAt ? <time className="chat-message-time" dateTime={message.createdAt}>{formatNotificationTime(message.createdAt)}</time> : null}
        {direct.map(action => <Tooltip key={action.label} label={action.label === '重新生成' && model ? `${action.label} · ${model}` : action.label}><button type="button" className="chat-message-action" onClick={action.run} aria-label={action.label}><action.icon size={15} aria-hidden="true" /></button></Tooltip>)}
        {!isUser && message.createdAt ? <time className="chat-message-time" dateTime={message.createdAt}>{formatNotificationTime(message.createdAt)}</time> : null}
        {isUser && message.versions && message.versions.length > 1 && onSwitchVersion && <div className="chat-message-versions" role="group" aria-label="消息版本">
            <Tooltip label="上一版本"><button type="button" className="chat-message-action" aria-label="上一版本" disabled={disabled || index === 0} onClick={() => onSwitchVersion(message.id, index - 1)}><ChevronLeft size={14} /></button></Tooltip>
            <span aria-live="polite">{index + 1} / {message.versions.length}</span>
            <Tooltip label="下一版本"><button type="button" className="chat-message-action" aria-label="下一版本" disabled={disabled || index === message.versions.length - 1} onClick={() => onSwitchVersion(message.id, index + 1)}><ChevronRight size={14} /></button></Tooltip>
        </div>}
        {!isUser && !message.agent && model && <span className="chat-message-model">{model}</span>}
        {!isUser && (message.chartInfo?.baziName || message.chartInfo?.ziweiName) && <span className="chat-message-chart-label">{[message.chartInfo.baziName, message.chartInfo.ziweiName].filter(Boolean).join(' · ')}</span>}
    </div>;
}
