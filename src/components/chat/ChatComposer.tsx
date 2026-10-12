/**
 * 消息输入框组件（主壳）
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useEffect, useCallback, useMemo)
 * - 有文本输入、@mention、附件上传等交互功能
 */
'use client';

import { useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import type { AttachmentState, Mention } from '@/types';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import type { MembershipType } from '@/lib/user/membership';
import { useToast } from '@/components/ui/Toast';
import { buildMentionHighlightedParts } from '@/components/chat/mentionHighlight';
import { buildMentionToken, extractMentionTokens, filterMentionsByTokens, removeMentionsByTokens, type MentionToken } from '@/lib/mention-tokens';
import { updateCurrentUserSettings } from '@/lib/user/settings';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { filterDataSourceItemsByFeature, filterMentionsByFeature, getDataSourceFeatureId, getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';
import { useComposerState, type KnowledgeBaseSummary } from '@/components/chat/composer/useComposerState';
import { MentionManager } from '@/components/chat/composer/MentionManager';
import { AttachmentBar } from '@/components/chat/composer/AttachmentBar';
import { ComposerToolbar, type ComposerModeControl, type ComposerSendState, type ComposerWebControl } from '@/components/chat/composer/ComposerToolbar';
import { useSpeechInput } from '@/components/chat/composer/ComposerDomainControls';
import { PromptPreview } from '@/components/chat/composer/PromptPreview';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import type { AgentRuntimeInfo } from '@/lib/agent/types';
import { applyPromptTemplate } from '@/lib/agent/prompt-templates';
import { useComposerCommands } from './composer/ComposerCommands';
import { usePrivateAttachments } from '@/lib/chat/use-private-attachments';
import { PrivateAttachments } from './agent/PrivateAttachments';
import { AgentContextMeter } from './agent/AgentContextUsage';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';
import './composer/composer.css';

const findLastAtOutsideTokens = (value: string, tokens: MentionToken[]): number => {
    for (let i = value.length - 1; i >= 0; i -= 1) {
        if (value[i] !== '@') continue;
        const inToken = tokens.some(token => i >= token.start && i < token.end);
        if (!inToken) return i;
    }
    return -1;
};

interface ChatComposerProps extends ModelSettingsProps {
    draftKey?: string;
    /** The empty-state composer is larger and carries the conversation-mode switch. */
    variant?: 'dock' | 'hero';
    /** Shown above the input, such as follow-up suggestions or the credit notice. */
    header?: ReactNode;
    /** Attached to the top edge of the input, such as the follow-up queue. */
    queue?: ReactNode;
    /** One-line note under the input. */
    note?: ReactNode;
    /** The note repeats the header's task status; phones leave it out. */
    noteOptional?: boolean;
    modeControl?: ComposerModeControl;
    webControl?: ComposerWebControl;
    agentMode?: boolean;
    agentRuntime?: AgentRuntimeInfo;
    /** The conversation already has messages, so the input continues it. */
    continuing?: boolean;
    awaitingInput?: boolean;
    allowDuringRun?: boolean;
    onQueueMessage?: () => Promise<void>;
    inputValue: string;
    isLoading: boolean;
    isSendingToList?: boolean;
    onInputChange: (value: string) => void;
    onSend: () => void;
    onStop?: () => void;
    onAuthRequired?: () => void;
    disabled?: boolean;
    chatMode?: ChatMode;
    onChatModeChange?: (mode: ChatMode) => void;
    selectedModel?: string;
    onModelChange?: (modelId: string) => void;
    reasoningEnabled?: boolean;
    onReasoningChange?: (enabled: boolean) => void;
    customProviderActive?: boolean;
    customProviderLabel?: string | null;
    userId?: string | null;
    membershipType?: MembershipType;
    attachmentState?: AttachmentState;
    onAttachmentChange?: (state: AttachmentState) => void;
    mentions?: Mention[];
    onMentionsChange?: (mentions: Mention[]) => void;
    promptKnowledgeBases?: KnowledgeBaseSummary[];
    contextMessages?: Array<{ content?: string }>;
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
    dreamContextLoading?: boolean;
    knowledgeBaseEnabled?: boolean;
}

export function ChatComposer({
    draftKey,
    variant = 'dock',
    header,
    queue,
    note,
    noteOptional = false,
    modeControl,
    webControl,
    agentMode = false,
    continuing = false,
    agentRuntime,
    awaitingInput = false,
    allowDuringRun = false,
    onQueueMessage,
    inputValue,
    isLoading,
    isSendingToList = false,
    onInputChange,
    onSend,
    onStop,
    onAuthRequired,
    disabled = false,
    chatMode = 'normal',
    onChatModeChange,
    selectedModel = DEFAULT_MODEL_ID,
    onModelChange,
    reasoningEnabled = false,
    onReasoningChange,
    reasoningEffort, onReasoningEffortChange, collaborators, onCollaboratorsChange,
    customProviderActive = false,
    customProviderLabel = null,
    userId,
    membershipType = 'free',
    attachmentState,
    onAttachmentChange,
    mentions = [],
    onMentionsChange,
    promptKnowledgeBases = [],
    contextMessages = [],
    dreamContext,
    dreamContextLoading = false,
    knowledgeBaseEnabled = true,
}: ChatComposerProps) {
    const { showToast } = useToast();
    const { isFeatureEnabled } = useFeatureToggles();
    const canUseBaziChart = isFeatureEnabled('bazi');
    const enabledMentionDataSourceTypes = useMemo(
        () => getEnabledDataSourceTypes(isFeatureEnabled),
        [isFeatureEnabled]
    );

    // 防止 mention 选中后 state 还未同步就触发发送
    const mentionSettlingRef = useRef(false);
    const isDreamMode = chatMode === 'dream';

    const state = useComposerState({
        userId, membershipType, selectedModel, reasoningEnabled, agentMode,
        mentions, contextMessages,
        isLoading, isSendingToList, chatMode,
        knowledgeBaseEnabled, promptKnowledgeBases,
        enabledDataSourceTypes: enabledMentionDataSourceTypes,
    });

    const {
        textareaRef, fileInputRef, overlayRef,
        mentionOpen, setMentionOpen,
        mentionQuery, setMentionQuery,
        mentionStartIndex, setMentionStartIndex,
        mentionDataSources, mentionKnowledgeBases,
        mentionLoadError, mentionDataSourceErrors,
        mentionLoading, mentionDefaultCategory, setMentionDefaultCategory,
        knowledgeBaseOpen, setKnowledgeBaseOpen,
        knowledgeBaseSavingId,
        promptDiagnosticsOpen, setPromptDiagnosticsOpen,
        canUseWeb, canUseBoth, canUseKnowledgeBase,
        promptProgressPercent, contextProgressPercent,
        hasPromptDiagnostics, displayLayers, displayUserMessageTokens,
        promptUsageLabel, promptPreviewLoading,
        promptPreviewTokens, promptPreviewBudget,
        canMentionAnything,
        promptKbIdSet,
        formatLayerLabel, refreshMentionData,
    } = state;
    const commands = useComposerCommands({ userId, draftKey, text: inputValue, change: onInputChange, textarea: textareaRef, mentionsOpen: mentionOpen, model: selectedModel });
    const uploads = usePrivateAttachments({ scopeKey: draftKey ?? userId ?? 'anonymous', state: attachmentState ?? { webSearchEnabled: false }, change: value => onAttachmentChange?.(value), onError: message => showToast('error', message) });
    const submit = () => { if (uploads.uploading) return; commands.remember(); onSend(); };

    const hasFile = !!attachmentState?.file;
    const hasWebSearch = !!attachmentState?.webSearchEnabled;
    const filteredMentionDataSources = useMemo(
        () => filterDataSourceItemsByFeature(mentionDataSources, isFeatureEnabled),
        [isFeatureEnabled, mentionDataSources]
    );
    // The empty state offers the latest saved charts as one-click references.
    const savedCharts = useMemo(() => filteredMentionDataSources
        .filter(item => item.type === 'bazi_chart' || item.type === 'ziwei_chart').slice(0, 3), [filteredMentionDataSources]);
    const filteredMentionDataSourceErrors = useMemo(
        () => filterDataSourceItemsByFeature(mentionDataSourceErrors, isFeatureEnabled),
        [isFeatureEnabled, mentionDataSourceErrors]
    );
    const normalizedMentions = useMemo(
        () => filterMentionsByFeature(mentions ?? [], {
            knowledgeBaseEnabled: canUseKnowledgeBase,
            enabledDataSourceTypes: enabledMentionDataSourceTypes,
        }),
        [canUseKnowledgeBase, enabledMentionDataSourceTypes, mentions]
    );

    useEffect(() => {
        if (!onMentionsChange) return;
        if (normalizedMentions.length !== mentions.length) {
            onMentionsChange(normalizedMentions);
            return;
        }
        for (let i = 0; i < mentions.length; i += 1) {
            const current = mentions[i];
            const normalized = normalizedMentions[i];
            if (!normalized
                || current.type !== normalized.type
                || current.id !== normalized.id
                || current.name !== normalized.name
                || current.preview !== normalized.preview) {
                onMentionsChange(normalizedMentions);
                return;
            }
        }
    }, [mentions, normalizedMentions, onMentionsChange]);

    // --- Event handlers ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (agentMode) { void uploads.upload(Array.from(e.target.files ?? [])); e.target.value = ''; return; }
        const file = e.target.files?.[0];
        if (!file || !onAttachmentChange) return;
        if (!canUseBoth && attachmentState?.webSearchEnabled) {
            onAttachmentChange({ file, webSearchEnabled: false });
            showToast('info', '同时使用搜索和附件仅限 Pro 用户，已自动关闭搜索');
        } else {
            onAttachmentChange({ ...attachmentState, file, webSearchEnabled: attachmentState?.webSearchEnabled ?? false });
        }
        e.target.value = '';
    };

    const handleWebToggle = () => {
        if (!onAttachmentChange) return;
        if (!canUseWeb) {
            showToast('info', '网络搜索仅限 Plus 以上用户使用');
            return;
        }
        const newWebSearch = !attachmentState?.webSearchEnabled;
        if (!canUseBoth && attachmentState?.file && newWebSearch) {
            onAttachmentChange({ file: undefined, webSearchEnabled: true });
            showToast('info', '同时使用搜索和附件仅限 Pro 用户，已自动清除附件');
        } else {
            onAttachmentChange({ ...attachmentState, webSearchEnabled: newWebSearch });
        }
    };

    const handleKnowledgeBaseOpen = async () => {
        if (!canUseKnowledgeBase) {
            showToast('info', '知识库仅限 Plus 以上会员使用');
            return;
        }
        setKnowledgeBaseOpen(true);
        state.setMentionLoadError(null);
        textareaRef.current?.focus();
        await refreshMentionData(true);
    };

    const toggleKnowledgeBaseSearch = useCallback(async (kbId: string) => {
        if (!userId) return;
        if (membershipType === 'free') {
            showToast('info', '仅限 Plus 以上会员使用');
            return;
        }
        const nextPromptIds = promptKbIdSet.has(kbId)
            ? Array.from(promptKbIdSet).filter(id => id !== kbId)
            : Array.from(new Set([...promptKbIdSet, kbId]));
        state.setKnowledgeBaseSavingId(kbId);
        const saved = await updateCurrentUserSettings({ promptKbIds: nextPromptIds });
        state.setKnowledgeBaseSavingId(null);
        if (!saved) {
            showToast('error', '保存知识库失败');
            return;
        }
        showToast('success', promptKbIdSet.has(kbId) ? '已关闭知识库搜索' : '已启用知识库搜索');
    }, [membershipType, promptKbIdSet, showToast, userId, state]);

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 236);
        textarea.style.height = `${newHeight}px`;
        if (overlayRef.current) {
            overlayRef.current.scrollTop = textarea.scrollTop;
        }
    }, [inputValue, mentions, textareaRef, overlayRef, variant]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (commands.keyDown(e)) return;
        if (mentionOpen) return;
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const textarea = textareaRef.current;
            if (textarea) {
                const tokens = extractMentionTokens(inputValue, mentions);
                if (textarea.selectionStart !== textarea.selectionEnd) {
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const overlaps = tokens.filter(token => token.start < end && token.end > start);
                    if (overlaps.length > 0) {
                        e.preventDefault();
                        const removeStart = Math.min(start, ...overlaps.map(t => t.start));
                        const removeEnd = Math.max(end, ...overlaps.map(t => t.end));
                        const nextValue = `${inputValue.slice(0, removeStart)}${inputValue.slice(removeEnd)}`;
                        onInputChange(nextValue);
                        if (onMentionsChange) {
                            onMentionsChange(removeMentionsByTokens(mentions, tokens, overlaps));
                        }
                        requestAnimationFrame(() => {
                            textareaRef.current?.setSelectionRange(removeStart, removeStart);
                        });
                        return;
                    }
                } else {
                    const caret = e.key === 'Backspace' ? textarea.selectionStart - 1 : textarea.selectionStart;
                    if (caret >= 0) {
                        const target = tokens.find(token => caret >= token.start && caret < token.end);
                        if (target) {
                            e.preventDefault();
                            const nextValue = `${inputValue.slice(0, target.start)}${inputValue.slice(target.end)}`;
                            onInputChange(nextValue);
                            if (onMentionsChange) {
                                onMentionsChange(removeMentionsByTokens(mentions, tokens, [target]));
                            }
                            requestAnimationFrame(() => {
                                textareaRef.current?.setSelectionRange(target.start, target.start);
                            });
                            return;
                        }
                    }
                }
            }
        }
        if (e.key === 'Enter' && !e.shiftKey && !disabled && !uploads.uploading && (!isLoading || allowDuringRun) && !isSendingToList && !dreamContextLoading && !mentionSettlingRef.current && inputValue.trim()) {
            e.preventDefault();
            if (!userId && onAuthRequired) {
                onAuthRequired();
                return;
            }
            submit();
        }
    };

    const handleInputChange = (value: string) => {
        commands.changed();
        onInputChange(value);
        const tokens = extractMentionTokens(value, mentions);
        if (onMentionsChange) {
            const nextMentions = filterMentionsByTokens(mentions, tokens);
            if (nextMentions.length !== mentions.length) {
                onMentionsChange(nextMentions);
            }
        }
        const atIndex = findLastAtOutsideTokens(value, tokens);
        if (!canMentionAnything) {
            setMentionOpen(false);
            setMentionQuery('');
            setMentionStartIndex(null);
            return;
        }
        if (atIndex >= 0) {
            const prev = atIndex > 0 ? value[atIndex - 1] : '';
            const isEmailLike = !!prev && /[A-Za-z0-9._-]/.test(prev);
            const tail = value.slice(atIndex + 1);
            const hasSpaceInTail = /\s/.test(tail);
            if (!isEmailLike && !hasSpaceInTail) {
                setMentionOpen(true);
                setMentionQuery(tail || '');
                setMentionStartIndex(atIndex);
                return;
            }
        }
        setMentionOpen(false);
        setMentionQuery('');
        setMentionStartIndex(null);
    };

    const handleSelectMention = (mention: Mention) => {
        if (!onMentionsChange) return;
        if (mention.type === 'knowledge_base' && !canUseKnowledgeBase) {
            showToast('info', '知识库仅限 Plus 以上会员使用');
            return;
        }
        if (mention.type !== 'knowledge_base' && !isFeatureEnabled(getDataSourceFeatureId(mention.type))) {
            showToast('info', '该数据来源已关闭');
            return;
        }
        const isDuplicate = mentions.some(m => m.id === mention.id && m.type === mention.type);
        if (isDuplicate) {
            showToast('info', '已添加过该项');
            return;
        }
        const next = [...mentions, mention].slice(0, 10);
        onMentionsChange(next);
        // 标记 mention 正在同步，阻止在 state 更新前触发发送
        mentionSettlingRef.current = true;
        queueMicrotask(() => { mentionSettlingRef.current = false; });
        const token = buildMentionToken(mention);
        if (mentionStartIndex != null) {
            const prefix = inputValue.slice(0, mentionStartIndex).trimEnd();
            const nextValue = `${prefix} ${token} `;
            onInputChange(nextValue.trimStart());
        } else {
            const nextValue = inputValue.trim() ? `${inputValue.trim()} ${token} ` : `${token} `;
            onInputChange(nextValue);
        }
        setMentionOpen(false);
        setMentionQuery('');
        setMentionStartIndex(null);
        setMentionDefaultCategory(null);
        textareaRef.current?.focus();
    };

    const highlightedInput = useMemo(() => {
        return buildMentionHighlightedParts(inputValue, mentions);
    }, [inputValue, mentions]);

    const handleButtonClick = () => {
        if (isSendingToList || mentionSettlingRef.current) return;
        if (isLoading && onStop && !(allowDuringRun && inputValue.trim())) {
            onStop();
        } else if (inputValue.trim()) {
            if (!userId && onAuthRequired) {
                onAuthRequired();
                return;
            }
            submit();
        }
    };

    const speech = useSpeechInput({ value: inputValue, onChange: handleInputChange, disabled: !!disabled, scopeKey: `${userId ?? 'visitor'}:${draftKey ?? 'draft'}` });
    const hero = variant === 'hero';
    const running = allowDuringRun && isLoading;
    const hasDraft = Boolean(inputValue.trim());
    let inputPlaceholder: string;
    let inputLabel: string;
    if (disabled) { inputPlaceholder = '请先获取积分'; inputLabel = agentMode ? '描述你的问题' : '输入消息'; }
    else if (awaitingInput) { inputPlaceholder = '补充信息，继续当前任务…'; inputLabel = '补充任务信息'; }
    else if (running) { inputPlaceholder = '补充信息或调整方向…'; inputLabel = '补充信息或调整方向'; }
    else if (isDreamMode) { inputPlaceholder = '说说你做了什么梦…'; inputLabel = '描述梦境'; }
    else if (hero) {
        inputPlaceholder = agentMode ? '例如：我明年适合换工作吗？出生信息可以直接写，也可以 @ 已存命盘' : '问问命盘、运势，或最近困惑的事…';
        inputLabel = '描述你的问题';
    } else if (agentMode) {
        inputPlaceholder = continuing && canMentionAnything ? '继续追问，或用 @ 引用命盘与知识库…' : continuing ? '继续追问，新任务会接续这次的上下文…' : '描述任务，或输入 @ 引用命盘与资料…';
        inputLabel = '继续追问';
    } else { inputPlaceholder = '问问命盘、运势，或最近困惑的事…'; inputLabel = '输入消息'; }

    const send: ComposerSendState = isSendingToList || uploads.uploading ? { kind: 'sending' }
        : running && hasDraft && !awaitingInput ? { kind: 'split', disabled: !!disabled || dreamContextLoading, onSupplement: submit, onFollowUp: onQueueMessage ? () => void onQueueMessage() : undefined, onStop }
        : isLoading && onStop ? { kind: 'stop' }
        : { kind: 'send', disabled: !hasDraft || dreamContextLoading };
    const styles = useMemo<ChatMode[]>(() => ['normal', ...(canUseBaziChart && userId ? ['mangpai' as const] : []), ...(userId ? ['dream' as const] : [])], [canUseBaziChart, userId]);
    const insertMention = () => {
        const textarea = textareaRef.current;
        const caret = textarea?.selectionStart ?? inputValue.length;
        onInputChange(`${inputValue.slice(0, caret)}@${inputValue.slice(caret)}`);
        setMentionOpen(true);
        setMentionQuery('');
        setMentionStartIndex(caret);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(caret + 1, caret + 1);
        });
    };

    return (
        <div data-chat-composer className={`chat-composer-dock${hero ? ' is-hero' : ''}${disabled ? ' is-locked' : ''}`} style={{ zIndex: knowledgeBaseOpen ? 60 : 30 }}>
            <div className="chat-composer-inner">
                {header && <div className="chat-composer-header">{header}</div>}
                <MentionManager
                    textareaRef={textareaRef}
                    userId={userId}
                    mentionOpen={mentionOpen}
                    setMentionOpen={setMentionOpen}
                    mentionQuery={mentionQuery}
                    mentionDataSources={filteredMentionDataSources}
                    mentionKnowledgeBases={mentionKnowledgeBases}
                    enabledDataSourceTypes={enabledMentionDataSourceTypes}
                    mentionLoadError={mentionLoadError}
                    mentionDataSourceErrors={filteredMentionDataSourceErrors}
                    mentionLoading={mentionLoading}
                    mentionDefaultCategory={mentionDefaultCategory}
                    setMentionDefaultCategory={setMentionDefaultCategory}
                    canUseKnowledgeBase={canUseKnowledgeBase}
                    handleSelectMention={handleSelectMention}
                    knowledgeBaseOpen={knowledgeBaseOpen}
                    setKnowledgeBaseOpen={setKnowledgeBaseOpen}
                    knowledgeBaseSavingId={knowledgeBaseSavingId}
                    promptKbIdSet={promptKbIdSet}
                    toggleKnowledgeBaseSearch={toggleKnowledgeBaseSearch}
                />
                {queue}

                <div className="chat-composer-shell">
                    {commands.ui}
                    <PrivateAttachments items={attachmentState?.uploaded} disabled={uploads.uploading} onRemove={id => onAttachmentChange?.({ ...attachmentState, webSearchEnabled: hasWebSearch, uploaded: attachmentState?.uploaded?.filter(item => item.id !== id) })} />
                    {uploads.uploading && <p className="chat-composer-status" role="status">正在保存资料…</p>}
                    <AttachmentBar
                        hasFile={hasFile}
                        attachmentState={attachmentState}
                        onAttachmentChange={onAttachmentChange}
                        disabled={disabled}
                        isDreamMode={isDreamMode}
                        dreamContextLoading={dreamContextLoading}
                        dreamContext={dreamContext}
                    />

                    <div className="chat-composer-field">
                        <div ref={overlayRef} className="chat-composer-input chat-composer-overlay" aria-hidden="true">
                            {inputValue ? highlightedInput.map(part => part.kind === 'mention'
                                ? <span key={`${part.start}-${part.end}`} className="chat-mention-token">{part.value}</span>
                                : part.value) : <span className="chat-composer-placeholder">{inputPlaceholder}</span>}
                        </div>
                        <textarea
                            aria-label={inputLabel}
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => handleInputChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={event => {
                                if (!agentMode || !userId || uploads.uploading) return;
                                const files = Array.from(event.clipboardData.files);
                                const text = event.clipboardData.getData('text/plain');
                                if (files.length) { event.preventDefault(); void uploads.upload(files); }
                                else if (text.length > 8000 && !event.clipboardData.getData('text/html')) { event.preventDefault(); void uploads.upload([new File([text], `粘贴资料-${new Date().toISOString().slice(0,10)}.txt`, { type: 'text/plain' })]); showToast('info', '长文本已转为资料，可预览后再发送'); }
                            }}
                            onScroll={(e) => {
                                if (overlayRef.current) {
                                    overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                }
                            }}
                            placeholder=""
                            className="chat-composer-input chat-composer-textarea"
                            disabled={disabled}
                            rows={hero ? 3 : 2}
                        />
                    </div>

                    <ComposerToolbar
                        agentMode={agentMode}
                        hero={hero}
                        disabled={disabled}
                        userId={userId}
                        membershipType={membershipType}
                        modeControl={modeControl}
                        webControl={webControl}
                        fileInputRef={fileInputRef}
                        hasFile={hasFile}
                        onFileChange={handleFileChange}
                        plainWeb={{ active: hasWebSearch, allowed: canUseWeb, onToggle: handleWebToggle }}
                        knowledgeBase={{ enabled: knowledgeBaseEnabled, allowed: canUseKnowledgeBase, onOpen: () => void handleKnowledgeBaseOpen(), selected: promptKnowledgeBases, onRemove: id => void toggleKnowledgeBaseSearch(id) }}
                        onMention={userId && canMentionAnything ? insertMention : undefined}
                        chatMode={chatMode}
                        onChatModeChange={onChatModeChange && (mode => { onChatModeChange(mode); textareaRef.current?.focus(); })}
                        styles={styles}
                        onPickTemplate={template => handleInputChange(applyPromptTemplate(template, inputValue))}
                        speech={speech}
                        polish={commands.polish}
                        contextMeter={agentMode ? <AgentContextMeter runtime={agentRuntime} /> : undefined}
                        promptStatistics={agentMode ? undefined : <PromptPreview embedded
                            promptPreviewLoading={promptPreviewLoading} hasPromptDiagnostics={hasPromptDiagnostics}
                            promptDiagnosticsOpen={promptDiagnosticsOpen} setPromptDiagnosticsOpen={setPromptDiagnosticsOpen}
                            contextProgressPercent={contextProgressPercent} promptProgressPercent={promptProgressPercent}
                            promptUsageLabel={promptUsageLabel} promptPreviewTokens={promptPreviewTokens} promptPreviewBudget={promptPreviewBudget}
                            displayLayers={displayLayers} displayUserMessageTokens={displayUserMessageTokens} formatLayerLabel={formatLayerLabel} />}
                        selectedModel={selectedModel}
                        onModelChange={onModelChange}
                        reasoningEnabled={reasoningEnabled}
                        onReasoningChange={onReasoningChange}
                        reasoningEffort={reasoningEffort}
                        onReasoningEffortChange={onReasoningEffortChange}
                        collaborators={collaborators}
                        onCollaboratorsChange={onCollaboratorsChange}
                        customProviderActive={customProviderActive}
                        customProviderLabel={customProviderLabel}
                        send={send}
                        onSend={handleButtonClick}
                        onStop={onStop}
                    />
                </div>

                {hero && userId && enabledMentionDataSourceTypes.includes('bazi_chart') && <div className="chat-saved-charts" role="group" aria-label="引用已存命盘">
                    <span aria-hidden="true">{savedCharts.length ? '引用已存命盘' : '还没有已存命盘'}</span>
                    {savedCharts.map(chart => <button key={`${chart.type}:${chart.id}`} type="button" disabled={disabled} title={chart.preview}
                        onClick={() => handleSelectMention({ type: chart.type, id: chart.id, name: chart.name, preview: chart.preview })}>
                        <span className="chat-saved-chart-glyph" data-type={chart.type} aria-hidden="true">{chart.type === 'bazi_chart' ? '八' : '紫'}</span>
                        <span>{chart.name} · {chart.type === 'bazi_chart' ? '八字命盘' : '紫微命盘'}</span>
                    </button>)}
                    <Link href="/bazi" className="chat-saved-chart-new">+ 新建命盘</Link>
                </div>}
                {note && <p className="chat-composer-note" data-optional={noteOptional || undefined}>{note}</p>}
            </div>
        </div>
    );
}
