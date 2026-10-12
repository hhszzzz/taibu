/**
 * 聊天消息项组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 需要处理用户交互事件
 */
'use client';
import { memo, useState, useMemo, useCallback, useRef } from 'react';
import { Check, X, FileText, Globe, KeyRound } from 'lucide-react';
import type { AIMessageMetadata, ChatMessage, InjectedSource, Mention } from '@/types';
import { getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';
import { formatMentionsForDisplay } from '@/lib/format-mentions';
import { getVisibleSourcePanelState } from '@/lib/chat/feature-normalization';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { extractMentionTokens, filterMentionsByTokens, removeMentionsByTokens } from '@/lib/mention-tokens';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { AgentMessage } from '@/components/chat/AgentMessage';
import { SourcePanel } from '@/components/chat/SourcePanel';
import { buildMentionHighlightedParts } from '@/components/chat/mentionHighlight';
import { useKnowledgeBaseFeatureEnabled } from '@/components/knowledge-base/useKnowledgeBaseFeatureEnabled';
import { openSettingsCenter } from '@/lib/settings-center';
import { MessageActions } from './MessageActions';
import { useToast } from '@/components/ui/Toast';
import { PrivateAttachments } from './agent/PrivateAttachments';

interface ChatMessageItemProps {
    message: ChatMessage;
    isStreamingAI: boolean;
    isLastMessage: boolean;
    disabled?: boolean;
    onEditMessage?: (messageId: string, newContent: string, mentions?: Mention[]) => void;
    onRegenerateResponse?: (messageId: string) => void;
    onSwitchVersion?: (messageId: string, versionIndex: number) => void;
    onArchiveMessage?: (message: ChatMessage) => void;
}

export const ChatMessageItem = memo(function ChatMessageItem({
    message,
    isStreamingAI,
    isLastMessage,
    disabled = false,
    onEditMessage,
    onRegenerateResponse,
    onSwitchVersion,
    onArchiveMessage,
}: ChatMessageItemProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [editMentions, setEditMentions] = useState<Mention[]>([]);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const { showToast } = useToast();
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
    const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editOverlayRef = useRef<HTMLDivElement | null>(null);

    const highlightedUserContentParts = useMemo(() => {
        if (message.role !== 'user') return [];
        const displayContent = formatMentionsForDisplay(message.content);
        return buildMentionHighlightedParts(displayContent, message.mentions ?? []);
    }, [message.content, message.mentions, message.role]);

    const handleStartEdit = useCallback(() => {
        if (disabled) return;
        setEditingId(message.id);
        setEditContent(formatMentionsForDisplay(message.content));
        setEditMentions(message.mentions ?? []);
        setEditError(null);
    }, [disabled, message.content, message.id, message.mentions]);

    const handleSaveEdit = useCallback(async () => {
        const trimmed = editContent.trim();
        if (editSaving || !editingId || !onEditMessage || !trimmed) return;
        setEditSaving(true);
        setEditError(null);
        try {
            const tokens = extractMentionTokens(trimmed, editMentions);
            const nextMentions = filterMentionsByTokens(editMentions, tokens);
            await onEditMessage(editingId, trimmed, nextMentions);
            setEditingId(null);
            setEditContent('');
            setEditMentions([]);
        } catch { setEditError('消息发送失败，请重试'); }
        finally { setEditSaving(false); }
    }, [editingId, editContent, editMentions, onEditMessage, editSaving]);

    const handleCancelEdit = useCallback(() => {
        setEditingId(null);
        setEditContent('');
        setEditMentions([]);
    }, []);

    const handleEditInputChange = useCallback((value: string) => {
        setEditContent(value);
        const tokens = extractMentionTokens(value, editMentions);
        const next = filterMentionsByTokens(editMentions, tokens);
        if (next.length !== editMentions.length) {
            setEditMentions(next);
        }
    }, [editMentions]);

    const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Escape' && !editSaving) { e.preventDefault(); handleCancelEdit(); return; }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handleSaveEdit(); return; }
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        const textarea = editTextareaRef.current;
        if (!textarea) return;

        const tokens = extractMentionTokens(editContent, editMentions);
        if (tokens.length === 0) return;

        if (textarea.selectionStart !== textarea.selectionEnd) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const overlaps = tokens.filter(token => token.start < end && token.end > start);
            if (overlaps.length === 0) return;
            e.preventDefault();
            const removeStart = Math.min(start, ...overlaps.map(t => t.start));
            const removeEnd = Math.max(end, ...overlaps.map(t => t.end));
            const nextValue = `${editContent.slice(0, removeStart)}${editContent.slice(removeEnd)}`;
            setEditContent(nextValue);
            setEditMentions(removeMentionsByTokens(editMentions, tokens, overlaps));
            requestAnimationFrame(() => {
                editTextareaRef.current?.setSelectionRange(removeStart, removeStart);
            });
            return;
        }

        const caret = e.key === 'Backspace' ? textarea.selectionStart - 1 : textarea.selectionStart;
        if (caret < 0) return;
        const target = tokens.find(token => caret >= token.start && caret < token.end);
        if (!target) return;
        e.preventDefault();
        const nextValue = `${editContent.slice(0, target.start)}${editContent.slice(target.end)}`;
        setEditContent(nextValue);
        setEditMentions(removeMentionsByTokens(editMentions, tokens, [target]));
        requestAnimationFrame(() => {
            editTextareaRef.current?.setSelectionRange(target.start, target.start);
        });
    }, [editContent, editMentions, editSaving, handleCancelEdit, handleSaveEdit]);

    const highlightedEditContentParts = useMemo(() => {
        if (!editContent) return [];
        return buildMentionHighlightedParts(editContent, editMentions);
    }, [editContent, editMentions]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopiedId(message.id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch {
            showToast('error', '复制失败，请重试');
        }
    }, [message.content, message.id, showToast]);

    const isCurrentStreaming = isStreamingAI && isLastMessage;

    if (message.role === 'user') {
        return (
            <article className="chat-message-row is-user group flex justify-end" data-message-id={message.id} aria-label="用户消息">
                {editingId === message.id ? (
                    <div className="chat-user-edit w-full max-w-[85%] space-y-2">
                        <div className="relative w-full rounded-lg bg-background-secondary border border-border focus-within:ring-2 focus-within:ring-accent/30">
                            <div
                                ref={editOverlayRef}
                                className="pointer-events-none absolute inset-0 px-4 py-3 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground overflow-y-auto"
                            >
                                {highlightedEditContentParts.map((part) => (
                                    part.kind === 'mention'
                                        ? (
                                            <span key={`${part.start}-${part.end}`} className={part.className}>
                                                {part.value}
                                            </span>
                                        )
                                        : part.value
                                ))}
                            </div>
                            <textarea
                                ref={editTextareaRef}
                                value={editContent}
                                onChange={(e) => handleEditInputChange(e.target.value)}
                                onKeyDown={handleEditKeyDown}
                                onScroll={(e) => {
                                    if (editOverlayRef.current) {
                                        editOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                    }
                                }}
                                className="w-full bg-transparent px-4 py-3 rounded-lg text-base leading-relaxed resize-none text-transparent caret-foreground focus:outline-none overflow-y-auto"
                                rows={3}
                                autoFocus
                                aria-label="编辑消息内容"
                                disabled={editSaving}
                            />
                        </div>
                        {editError && <p className="text-sm text-red-500" role="alert">{editError}</p>}
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={handleSaveEdit}
                                disabled={editSaving || !editContent.trim()}
                                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-accent text-on-accent text-xs font-bold hover:bg-accent/90 active:bg-accent/80 transition-all duration-150"
                            >
                                <Check className="w-3.5 h-3.5" />
                                {editSaving ? '正在发送' : '发送'}
                            </button>
                            <button
                                onClick={handleCancelEdit}
                                disabled={editSaving}
                                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-border bg-background text-xs font-bold text-foreground hover:bg-background-secondary active:bg-background-tertiary transition-all duration-150"
                            >
                                <X className="w-3.5 h-3.5" />
                                取消
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="chat-user-column flex flex-col items-end">
                        <PrivateAttachments ids={message.attachments?.ids} />
                        {/* 附件信息显示 */}
                        {message.attachments && (message.attachments.fileName || message.attachments.webSearchEnabled) && (
                            <div className="flex items-center gap-2 mb-2">
                                {message.attachments.fileName && !message.attachments.ids?.length && (
                                    <div className="flex items-center gap-3 px-3 py-2 bg-background border border-border rounded-md max-w-[240px] shadow-sm">
                                        <div className="flex-shrink-0 w-8 h-8 bg-accent/10 rounded flex items-center justify-center border border-accent/10">
                                            <FileText className="w-4 h-4 text-accent" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-foreground truncate">
                                                {message.attachments.fileName}
                                            </p>
                                            <p className="text-[10px] font-bold text-foreground-secondary uppercase tracking-tight">文件</p>
                                        </div>
                                    </div>
                                )}
                                {message.attachments.webSearchEnabled && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-md text-green-600 shadow-sm">
                                        <Globe className="w-3.5 h-3.5" />
                                        <span className="text-xs font-bold uppercase tracking-tight">网络搜索</span>
                                    </div>
                                )}
                            </div>
                        )}
                        {message.dreamInfo && (
                            <div className="flex items-center gap-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-purple-500/70 dark:text-purple-400/70">
                                <span>解梦</span>
                                <span>·</span>
                                <span>{new Date(message.dreamInfo.dreamDate).toLocaleDateString('zh-CN')}</span>
                            </div>
                        )}
                        <div className={`chat-user-bubble text-foreground ${message.dreamInfo
                            ? 'bg-purple-500/10 dark:bg-purple-500/15 border border-purple-500/20'
                            : 'bg-background-secondary'
                        }`}>
                            <p className="whitespace-pre-wrap text-base leading-relaxed">
                                {highlightedUserContentParts.map((part) => (
                                    part.kind === 'mention'
                                        ? (
                                            <span key={`${part.start}-${part.end}`} className={part.className}>
                                                {part.value}
                                            </span>
                                        )
                                        : part.value
                                ))}
                            </p>
                        </div>
                        {/* 操作按钮和版本切换 */}
                            <MessageActions
                                message={message}
                                disabled={disabled}
                                copied={copiedId === message.id}
                                onCopy={handleCopy}
                                onEdit={onEditMessage ? handleStartEdit : undefined}
                                onSwitchVersion={onSwitchVersion}
                            />
                    </div>
                )}
            </article>
        );
    }

    // AI 消息
    const showCheckKeyAction = message.metadata?.customProviderErrorAction === 'check-key';
    const assistantActions = message.content && !isCurrentStreaming ? (
        <MessageActions
            message={message}
            disabled={disabled}
            copied={copiedId === message.id}
            onCopy={handleCopy}
            onRegenerate={onRegenerateResponse}
            onArchive={onArchiveMessage}
        />
    ) : null;
    return (
        <article className="chat-message-row is-assistant group w-full" data-message-id={message.id} aria-label="助手消息">
            {/* 显示思考过程 */}
            {message.reasoning && (
                <ThinkingBlock
                    content={message.reasoning}
                    isStreaming={isCurrentStreaming && !message.content}
                    startTime={message.reasoningStartTime}
                    duration={message.reasoningDuration}
                    variant="chat"
                    className="mb-3"
                />
            )}
            {message.dreamInfo && (
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-purple-500/70 dark:text-purple-400/70">
                    <span>🌙</span>
                    <span>解梦</span>
                    <span>·</span>
                    <span>{message.dreamInfo.userName}</span>
                    <span>·</span>
                    <span>{new Date(message.dreamInfo.dreamDate).toLocaleDateString('zh-CN')}</span>
                    {message.dreamInfo.baziChartName && (
                        <>
                            <span>·</span>
                            <span className="text-foreground-secondary">📜 {message.dreamInfo.baziChartName}</span>
                        </>
                    )}
                </div>
            )}
            {message.agent ? <AgentMessage data={message.agent} actions={assistantActions} />
                : <div className={`chat-answer${isCurrentStreaming && message.content ? ' is-streaming' : ''}`}><MarkdownContent content={message.content} className="chat-prose" streaming={isCurrentStreaming} /></div>}
            {showCheckKeyAction && !isCurrentStreaming && (
                <button
                    type="button"
                    onClick={() => openSettingsCenter('personalization')}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-500/5 px-3 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-500/10 dark:border-amber-400/30 dark:text-amber-200"
                >
                    <KeyRound className="h-4 w-4" />
                    检查 Key
                </button>
            )}
            {isCurrentStreaming && !message.content && !message.agent && (
                <div className="mt-3 inline-flex items-center gap-[3px] h-4">
                    {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="sound-wave-bar w-[3px] rounded-full bg-foreground/30" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                </div>
            )}
            {/* 来源面板 */}
            <SourcePanelSection
                message={message}
                isCurrentStreaming={isCurrentStreaming}
                expandedSources={expandedSources}
                setExpandedSources={setExpandedSources}
            />
            {/* 操作按钮：Agent 消息放在依据同一行 */}
            {!message.agent && assistantActions}
        </article>
    );
});

// 来源面板区域
interface SourcePanelSectionProps {
    message: ChatMessage;
    isCurrentStreaming: boolean;
    expandedSources: Record<string, boolean>;
    setExpandedSources: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

function SourcePanelSection({
    message,
    isCurrentStreaming,
    expandedSources,
    setExpandedSources,
}: SourcePanelSectionProps) {
    const { knowledgeBaseEnabled } = useKnowledgeBaseFeatureEnabled();
    const { isFeatureEnabled } = useFeatureToggles();
    const meta = message.metadata as AIMessageMetadata | undefined;
    const enabledDataSourceTypes = useMemo(
        () => getEnabledDataSourceTypes(isFeatureEnabled),
        [isFeatureEnabled],
    );
    const { visibleSources, showKnowledgeBaseMiss } = useMemo(
        () => getVisibleSourcePanelState(meta, {
            knowledgeBaseEnabled,
            enabledDataSourceTypes,
        }),
        [enabledDataSourceTypes, knowledgeBaseEnabled, meta],
    );

    // 延迟到回复结束后再展示“参考了 n 个来源”，避免一开始就出现
    if (isCurrentStreaming) return null;

    if (!visibleSources.length && !showKnowledgeBaseMiss) return null;

    const isExpanded = !!expandedSources[message.id];
    if (showKnowledgeBaseMiss && !isCurrentStreaming) {
        return (
            <div className="mt-3 border-t border-border/50 pt-2 px-2 text-[10px] font-bold uppercase tracking-wider text-foreground-secondary">
                本次未命中知识库
            </div>
        );
    }
    return (
        <SourcePanel
            sources={visibleSources as InjectedSource[]}
            isExpanded={isExpanded}
            onToggle={() => setExpandedSources(prev => ({ ...prev, [message.id]: !isExpanded }))}
        />
    );
}
