/**
 * 聊天消息项组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState)
 * - 需要处理用户交互事件
 */
'use client';
import { memo, useState, useMemo, useCallback, useRef } from 'react';
import { FileText, Globe, KeyRound } from 'lucide-react';
import type { AIMessageMetadata, ChatMessage, Mention } from '@/types';
import type { MessageQuote } from '@/lib/chat/quotes';
import { formatMentionsForDisplay } from '@/lib/format-mentions';
import { getVisibleWebSearch } from '@/lib/chat/feature-normalization';
import { extractMentionTokens, filterMentionsByTokens, removeMentionsByTokens } from '@/lib/mention-tokens';
import { MarkdownContent, type MarkdownCitations } from '@/components/ui/MarkdownContent';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { ThinkingBlock } from '@/components/chat/ThinkingBlock';
import { AgentMessage } from '@/components/chat/AgentMessage';
import { WebSearchSources } from '@/components/chat/WebSearchSources';
import { buildMentionHighlightedParts } from '@/components/chat/mentionHighlight';
import { MentionIcon } from '@/components/chat/mention/MentionIcon';
import { mentionTypeLabels } from '@/components/chat/mentionStyles';
import { openSettingsCenter } from '@/lib/settings-center';
import { MessageActions } from './MessageActions';
import { MessageQuoteCards } from './MessageQuotes';
import { useToast } from '@/components/ui/Toast';
import { PrivateAttachments } from './agent/PrivateAttachments';
import { GeneratedImageGallery } from './agent/GeneratedImageGallery';
import { readGeneratedImageRefs } from '@/lib/images/generated';

interface ChatMessageItemProps {
    message: ChatMessage;
    isStreamingAI: boolean;
    isLastMessage: boolean;
    disabled?: boolean;
    onEditMessage?: (messageId: string, newContent: string, mentions?: Mention[]) => void;
    /** 用户消息退回：重新生成这条消息之后的回复。 */
    onRetryMessage?: () => void;
    onRegenerateResponse?: (messageId: string) => void;
    onSwitchVersion?: (messageId: string, versionIndex: number) => void;
    onArchiveMessage?: (message: ChatMessage) => void;
    /** 引用这条助手回答的整段文字。 */
    onQuoteMessage?: (quote: MessageQuote) => void;
    /** Evidence numbers stamped across the whole conversation, in transcript order. */
    citationLabels?: MarkdownCitations['labels'];
}

export const ChatMessageItem = memo(function ChatMessageItem({
    message,
    isStreamingAI,
    isLastMessage,
    disabled = false,
    onEditMessage,
    onRetryMessage,
    onRegenerateResponse,
    onSwitchVersion,
    onArchiveMessage,
    onQuoteMessage,
    citationLabels,
}: ChatMessageItemProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [editMentions, setEditMentions] = useState<Mention[]>([]);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const { showToast } = useToast();
    const chartErrorToasted = useRef(new Set<string>());
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
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
        } catch { setEditError('保存失败，请重试'); }
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
        // claude 内联编辑：Enter 保存、Shift+Enter 换行、Esc 取消（输入法组字时都不触发）。
        if (e.key === 'Escape' && !editSaving) { e.preventDefault(); handleCancelEdit(); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSaveEdit(); return; }
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
    const handleChartError = useCallback(() => {
        if (chartErrorToasted.current.has(message.id)) return;
        chartErrorToasted.current.add(message.id);
        showToast('error', '图表错误，已隐藏该图表；文字解读仍保留。');
    }, [message.id, showToast]);

    if (message.role === 'user') {
        return (
            <article className="chat-message-row is-user group flex justify-end" data-message-id={message.id} aria-label="用户消息">
                {editingId === message.id ? (
                    <div className="chat-user-edit">
                        <div className="chat-user-bubble chat-user-edit-bubble">
                            <div className="chat-user-edit-field">
                                <div ref={editOverlayRef} className="chat-user-edit-overlay" aria-hidden="true">
                                    {highlightedEditContentParts.map((part) => (
                                        part.kind === 'mention'
                                            ? (
                                                <span key={`${part.start}-${part.end}`} className="chat-mention-token" data-type={part.type}><span className="chat-mention-at">@<MentionIcon type={part.type} size={12} /></span>{part.value.slice(1)}</span>
                                            )
                                            : part.value
                                    ))}
                                    {/* 末尾换行需要一个占位字符才能撑出新行，与 textarea 对齐 */}
                                    {'\u200b'}
                                </div>
                                <Textarea
                                    ref={editTextareaRef}
                                    value={editContent}
                                    onChange={(e) => handleEditInputChange(e.target.value)}
                                    onKeyDown={handleEditKeyDown}
                                    onScroll={(e) => {
                                        if (editOverlayRef.current) {
                                            editOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                        }
                                    }}
                                    className="chat-user-edit-input"
                                    rows={1}
                                    autoFocus
                                    aria-label="编辑消息内容"
                                    disabled={editSaving}
                                />
                            </div>
                            <div className="chat-user-edit-actions">
                                {editError && <p className="chat-user-edit-error" role="alert">{editError}</p>}
                                <Button variant="ghost" size="xs" className="chat-user-edit-cancel" onClick={handleCancelEdit} disabled={editSaving}>取消</Button>
                                <Button size="xs" className="chat-user-edit-save" onClick={() => void handleSaveEdit()} disabled={editSaving || !editContent.trim()}>
                                    {editSaving ? '正在保存' : '保存'}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="chat-user-column flex flex-col items-end">
                        <PrivateAttachments ids={message.attachments?.ids} />
                        {/* 附件信息显示 */}
                        {message.attachments && (message.attachments.fileName || message.attachments.webSearchEnabled) && (
                            <div className="chat-user-meta">
                                {message.attachments.fileName && !message.attachments.ids?.length && (
                                    <span className="chat-user-file"><FileText size={14} aria-hidden="true" /><span>{message.attachments.fileName}</span></span>
                                )}
                                {message.attachments.webSearchEnabled && (
                                    <span className="chat-user-meta-note"><Globe size={13} aria-hidden="true" />联网搜索</span>
                                )}
                            </div>
                        )}
                        {message.quotes?.length ? <MessageQuoteCards quotes={message.quotes} /> : null}
                        <div className="chat-user-bubble text-foreground">
                            <p className="whitespace-pre-wrap text-base leading-relaxed">
                                {highlightedUserContentParts.map((part) => (
                                    part.kind === 'mention'
                                        ? (
                                            <span key={`${part.start}-${part.end}`} className="chat-mention-token" data-type={part.type} title={mentionTypeLabels[part.type]}>
                                                <span className="chat-mention-at">@<MentionIcon type={part.type} size={12} /></span>{part.value.slice(1)}
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
                                onRetry={onRetryMessage}
                                onSwitchVersion={onSwitchVersion}
                            />
                    </div>
                )}
            </article>
        );
    }

    // AI 消息
    const showOwnModelAction = message.metadata?.byokErrorAction === 'settings';
    const hasAnswerText = message.content.trim().length > 0;
    const hasReasoning = (message.reasoning ?? '').trim().length > 0;
    // 只有思考没有正文的回答也要能重新生成；复制、引用等动作仍需要正文。
    const assistantActions = (hasAnswerText || hasReasoning) && !isCurrentStreaming ? (
        <MessageActions
            message={message}
            disabled={disabled}
            copied={copiedId === message.id}
            onCopy={handleCopy}
            onRegenerate={onRegenerateResponse}
            onArchive={onArchiveMessage}
            onQuote={onQuoteMessage ? () => onQuoteMessage({ messageId: message.id, text: message.content }) : undefined}
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
                />
            )}
            {message.agent ? <AgentMessage data={message.agent} actions={assistantActions} citationLabels={citationLabels} />
                : <div className={`chat-answer${isCurrentStreaming && message.content ? ' is-streaming' : ''}`}><MarkdownContent content={message.content} className="chat-prose" streaming={isCurrentStreaming} onChartError={handleChartError} /></div>}
            {!message.agent && !hasAnswerText && hasReasoning && !isCurrentStreaming && (
                <p className="chat-message-meta is-assistant">这次只完成了思考，没有生成正文。可以重新生成，或直接追问。</p>
            )}
            <GeneratedImageGallery images={readGeneratedImageRefs(message.metadata?.generatedImages)} label="生成的图片" />
            {showOwnModelAction && !isCurrentStreaming && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openSettingsCenter('byok')}
                    className="mt-3 gap-2 border-warning/40 bg-warning/5 text-warning hover:bg-warning/10"
                >
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    检查自定义模型
                </Button>
            )}
            {isCurrentStreaming && !message.content && !message.agent && (
                <div className="mt-3 inline-flex items-center gap-[3px] h-4">
                    {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="sound-wave-bar w-[3px] rounded-full bg-foreground/30" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                </div>
            )}
            <WebSearchSection message={message} isCurrentStreaming={isCurrentStreaming} />
            {/* 操作按钮：Agent 消息放在依据同一行 */}
            {!message.agent && assistantActions}
        </article>
    );
});

// 普通对话的联网搜索来源；Agent 消息在自己的依据中展示网页
function WebSearchSection({ message, isCurrentStreaming }: { message: ChatMessage; isCurrentStreaming: boolean }) {
    const search = useMemo(() => getVisibleWebSearch(message.metadata as AIMessageMetadata | undefined), [message.metadata]);
    // 与来源面板一样，回复结束后再展示
    if (isCurrentStreaming || message.agent || !search) return null;
    return <WebSearchSources search={search} />;
}
