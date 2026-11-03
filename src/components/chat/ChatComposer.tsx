/**
 * 消息输入框组件（主壳）
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useEffect, useCallback, useMemo)
 * - 有文本输入、@mention、附件上传等交互功能
 */
'use client';

import { useEffect, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { AttachmentState, Mention } from '@/types';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { formatUsd } from '@/lib/billing/money';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { buildMentionHighlightedParts } from '@/components/chat/mentionHighlight';
import { MentionIcon } from '@/components/chat/mention/MentionIcon';
import { buildMentionToken, extractMentionTokens, filterMentionsByTokens, removeMentionsByTokens, type MentionToken } from '@/lib/mention-tokens';
import { updateCurrentUserSettings } from '@/lib/user/settings';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { filterDataSourceItemsByFeature, filterMentionsByFeature, getDataSourceFeatureId, getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';
import { useComposerState, type KnowledgeBaseSummary } from '@/components/chat/composer/useComposerState';
import { getChartKindMeta } from '@/components/chat/agent/chart-registry';
import type { AgentChartKind } from '@/lib/agent/tool-catalog';
import { getCurrentUserSettings } from '@/lib/user/settings';
import { MentionManager } from '@/components/chat/composer/MentionManager';
import { AttachmentBar } from '@/components/chat/composer/AttachmentBar';
import { ComposerToolbar, ComposerSendCluster, type ComposerImageGeneration, type ComposerSendState, type ComposerWebControl } from '@/components/chat/composer/ComposerToolbar';
import { ComposerStatusBar } from '@/components/chat/composer/ComposerStatusBar';
import { QuoteBar } from '@/components/chat/composer/QuoteBar';
import type { MessageQuote } from '@/lib/chat/quotes';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import type { AgentMessageData } from '@/lib/agent/types';
import { useComposerCommands } from './composer/ComposerCommands';
import { usePrivateAttachments } from '@/lib/chat/use-private-attachments';
import { COMPOSER_FILES_EVENT, documentFileProblem, pickPlainAttachment } from '@/lib/chat/composer-files';
import { COMPOSER_MAX_HEIGHT, resolveComposerHeight } from '@/lib/chat/composer-height';
import { PrivateAttachments } from './agent/PrivateAttachments';
import { GENERATED_IMAGE_SIZE_LABELS } from '@/lib/images/generated';
import { Select } from '@/components/ui/Select';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';
import './composer/composer.css';

/** 追问 chip 的前导图标 = 该盘种在注册表里的图标（与提及、侧栏同源）。 */
function ChartAskIcon({ kind }: { kind: AgentChartKind }) {
    const Icon = getChartKindMeta(kind).icon;
    return <Icon size={12} />;
}

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
    /** 输入框内的追问命盘富文本 token（与提及同构、视觉区分）。 */
    contextToken?: ReactNode;
    /** Attached to the top edge of the input, such as the follow-up queue. */
    queue?: ReactNode;
    /** One-line note under the input. */
    note?: ReactNode;
    /** The note repeats the header's task status; phones leave it out. */
    noteOptional?: boolean;
    webControl?: ComposerWebControl;
    /** 有可用生图模型时提供：输入框直接生图，不经过对话模型。 */
    imageGeneration?: ComposerImageGeneration;
    /** The server can search the web for plain chat. */
    plainWebAvailable?: boolean;
    agentMode?: boolean;
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
    userId?: string | null;
    attachmentState?: AttachmentState;
    onAttachmentChange?: (state: AttachmentState) => void;
    mentions?: Mention[];
    onMentionsChange?: (mentions: Mention[]) => void;
    /** 从助手回答中引用的片段，显示在输入框上方；发送时随消息一起交给模型。 */
    quotes?: MessageQuote[];
    onRemoveQuote?: (index: number) => void;
    /** 追问命盘追加的 chip（与提及同形态，但不在资料列表里）。 */
    chartAsks?: Array<{ token: string; kind: AgentChartKind }>;
    promptKnowledgeBases?: KnowledgeBaseSummary[];
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
    dreamContextLoading?: boolean;
    knowledgeBaseEnabled?: boolean;
    /** 本对话最近的 Agent 消息（上下文环的数据源）。 */
    contextData?: AgentMessageData;
    /** 点开上下文弹层里的技能或方法卡。 */
    onOpenContextResource?: (id: string) => void;
}

export function ChatComposer({
    draftKey,
    variant = 'dock',
    contextToken,
    queue,
    note,
    noteOptional = false,
    webControl,
    imageGeneration,
    plainWebAvailable = false,
    agentMode = false,
    continuing = false,
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
    reasoningEffort, onReasoningEffortChange, collaborators, onCollaboratorsChange, codeMode, onCodeModeChange, planMode, onPlanModeChange,
    codeModeAvailable, planModeAvailable,
    approval, onApprovalChange,
    userId,
    attachmentState,
    onAttachmentChange,
    mentions = [],
    onMentionsChange,
    quotes = [],
    onRemoveQuote,
    chartAsks = [],
    promptKnowledgeBases = [],
    dreamContext,
    dreamContextLoading = false,
    knowledgeBaseEnabled = true,
    contextData,
    onOpenContextResource,
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
    // `+` 菜单按钮：自定义模型弹窗关闭后焦点回到这里。
    const addMenuRef = useRef<HTMLButtonElement>(null);
    const isDreamMode = chatMode === 'dream';
    // 生图模式：发送走独立接口，不经过对话模型；没有可用模型时按钮不出现。
    const [imageMode, setImageMode] = useState(false);
    const [imageSize, setImageSize] = useState<string>('1024x1024');
    const [imageCount, setImageCount] = useState(1);
    const [prevImageGeneration, setPrevImageGeneration] = useState(imageGeneration);
    if (prevImageGeneration !== imageGeneration) {
        setPrevImageGeneration(imageGeneration);
        if (!imageGeneration) setImageMode(false);
    }
    // 切换对话（draftKey 变化）时退出上一次的生图模式。
    const [prevImageDraftKey, setPrevImageDraftKey] = useState(draftKey);
    if (prevImageDraftKey !== draftKey) {
        setPrevImageDraftKey(draftKey);
        setImageMode(false);
    }

    const state = useComposerState({
        userId,
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
        knowledgeBaseSavingId,
        canUseKnowledgeBase,
        canMentionAnything,
        promptKbIdSet,
        refreshMentionData,
    } = state;
    const commands = useComposerCommands({ userId, draftKey, text: inputValue, change: onInputChange, textarea: textareaRef, mentionsOpen: mentionOpen, model: selectedModel, agentMode });
    const uploads = usePrivateAttachments({ scopeKey: draftKey ?? userId ?? 'anonymous', state: attachmentState ?? { webSearchEnabled: false }, change: value => onAttachmentChange?.(value), onError: message => showToast('error', message) });
    const submit = () => {
        if (uploads.uploading || isLoading || isSendingToList) return;
        if (imageMode && imageGeneration) {
            if (!userId) { onAuthRequired?.(); return; }
            if (!inputValue.trim()) return;
            commands.remember();
            imageGeneration.onGenerate({ prompt: inputValue.trim(), size: imageSize, count: imageCount });
            return;
        }
        commands.remember();
        onSend();
    };
    // 未登录时点到需要账号的条目：右下角提示先登录，并提供登录入口。
    const requireLogin = () => {
        showToast('info', '请先登录后使用', onAuthRequired ? { action: { label: '去登录', onClick: onAuthRequired } } : undefined);
    };

    // 长期记忆开关（与设置中心「记忆」同一份用户偏好）：+ 菜单可勾选。
    const [memoryEnabled, setMemoryEnabled] = useState<boolean | null>(null);
    const [memoryBusy, setMemoryBusy] = useState(false);
    const memoryFeatureEnabled = isFeatureEnabled('ai-personalization');
    const [prevMemoryUserId, setPrevMemoryUserId] = useState(userId);
    if (prevMemoryUserId !== userId) {
        setPrevMemoryUserId(userId);
        if (!userId) setMemoryEnabled(null);
    }
    useEffect(() => {
        if (!userId) return;
        let current = true;
        void getCurrentUserSettings({ expectedUserId: userId }).then(result => {
            if (current) setMemoryEnabled(result.settings ? result.settings.chatPreferences.memoryEnabled === true : false);
        }).catch(() => { if (current) setMemoryEnabled(false); });
        return () => { current = false; };
    }, [userId]);
    const toggleMemory = async () => {
        if (!userId || memoryBusy || !memoryFeatureEnabled) return;
        const next = memoryEnabled !== true;
        setMemoryEnabled(next);
        setMemoryBusy(true);
        try {
            const saved = await updateCurrentUserSettings({ chatPreferences: { memoryEnabled: next } }, undefined, { expectedUserId: userId });
            if (!saved) { setMemoryEnabled(!next); showToast('error', '保存记忆设置失败'); }
        } catch {
            setMemoryEnabled(!next);
            showToast('error', '保存记忆设置失败');
        } finally {
            setMemoryBusy(false);
        }
    };

    // claude + 菜单的「上传或添加文件 ⌘U」：在会话内任何位置都能唤起文件选择。
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'u') return;
            event.preventDefault();
            fileInputRef.current?.click();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [fileInputRef]);

    const hasFile = !!attachmentState?.file;
    const hasWebSearch = !!attachmentState?.webSearchEnabled;
    const filteredMentionDataSources = useMemo(
        () => filterDataSourceItemsByFeature(mentionDataSources, isFeatureEnabled),
        [isFeatureEnabled, mentionDataSources]
    );
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
    const attachPlainFile = (file: File) => {
        if (!onAttachmentChange) return;
        const problem = documentFileProblem(file);
        if (problem) { showToast('error', problem); return; }
        onAttachmentChange({ ...attachmentState, file, webSearchEnabled: attachmentState?.webSearchEnabled ?? false });
    };
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (agentMode) { void uploads.upload(Array.from(e.target.files ?? [])); e.target.value = ''; return; }
        const file = e.target.files?.[0];
        if (file) attachPlainFile(file);
        e.target.value = '';
    };
    /** Files dropped on the conversation or pasted: the same flows as the + menu. */
    const acceptFiles = (files: File[]) => {
        if (!files.length || disabled) return;
        if (!userId) { onAuthRequired?.(); return; }
        if (isDreamMode) { showToast('info', '解梦模式不支持附件'); return; }
        if (agentMode) { if (!uploads.uploading) void uploads.upload(files); return; }
        const { file, notice } = pickPlainAttachment(files);
        if (notice) showToast('info', notice);
        if (file) attachPlainFile(file);
    };
    const acceptFilesRef = useRef(acceptFiles);
    useEffect(() => { acceptFilesRef.current = acceptFiles; });
    useEffect(() => {
        const onFiles = (event: Event) => acceptFilesRef.current((event as CustomEvent<File[]>).detail);
        window.addEventListener(COMPOSER_FILES_EVENT, onFiles);
        return () => window.removeEventListener(COMPOSER_FILES_EVENT, onFiles);
    }, []);

    const plainWebAllowed = plainWebAvailable;
    const plainWebTitle = plainWebAvailable ? '联网搜索' : '当前环境未配置联网搜索';
    const handleWebToggle = () => {
        if (!onAttachmentChange) return;
        const newWebSearch = !attachmentState?.webSearchEnabled;
        // Turning search off always works, even after it stopped being available.
        if (newWebSearch && !plainWebAllowed) {
            showToast('info', plainWebTitle);
            return;
        }
        onAttachmentChange({ ...attachmentState, webSearchEnabled: newWebSearch });
    };

    const toggleKnowledgeBaseSearch = useCallback(async (kbId: string) => {
        if (!userId) return;
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
    }, [promptKbIdSet, showToast, userId, state]);

    // 输入框高度：单行保持紧凑；换行后给足下方空白；超过上限出现右上角放大键，可原地加高。
    const [composerExpanded, setComposerExpanded] = useState(false);
    const [composerExpandable, setComposerExpandable] = useState(false);
    const [composerHeight, setComposerHeight] = useState(0);
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const { height, expandable } = resolveComposerHeight({
            natural: textarea.scrollHeight,
            hero: variant === 'hero',
            expanded: composerExpanded,
            viewport: window.innerHeight,
        });
        textarea.style.height = `${height}px`;
        setComposerHeight(height);
        setComposerExpandable(expandable);
        if (!expandable && composerExpanded) setComposerExpanded(false);
        if (overlayRef.current) {
            overlayRef.current.scrollTop = textarea.scrollTop;
        }
    }, [inputValue, mentions, textareaRef, overlayRef, variant, composerExpanded]);

    // 追问 chip 的文本范围：与提及一样，退格时整体删除。
    const chartTokenRanges = useMemo(() => {
        const ranges: Array<{ start: number; end: number; token: string; kind: AgentChartKind }> = [];
        for (const ask of chartAsks) {
            if (!ask.token) continue;
            let from = 0;
            for (;;) {
                const start = inputValue.indexOf(ask.token, from);
                if (start < 0) break;
                ranges.push({ start, end: start + ask.token.length, token: ask.token, kind: ask.kind });
                from = start + ask.token.length;
            }
        }
        return ranges;
    }, [chartAsks, inputValue]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (commands.keyDown(e)) return;
        if (mentionOpen) return;
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const textarea = textareaRef.current;
            if (textarea) {
                const tokens = [...extractMentionTokens(inputValue, mentions), ...chartTokenRanges.map(range => ({ start: range.start, end: range.end, name: range.token }))];
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
            showToast('info', '知识库已关闭');
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

    // 提及与追问 chip 合并成一条高亮序列（追问 chip 与提及同形态：图标 + 名称）。
    const highlightedInput = useMemo(() => {
        const base = buildMentionHighlightedParts(inputValue, mentions);
        if (!chartTokenRanges.length) return base;
        type Part = (typeof base)[number] | { kind: 'chart'; value: string; start: number; end: number; chartKind: AgentChartKind };
        const parts: Part[] = [];
        let offset = 0;
        for (const part of base) {
            if (part.kind === 'mention') { parts.push(part); offset = part.end; continue; }
            const text = part.value;
            const matches = chartTokenRanges.filter(range => range.start >= offset && range.end <= offset + text.length);
            let cursor = 0;
            for (const match of matches) {
                const local = match.start - offset;
                if (local > cursor) parts.push({ kind: 'text', value: text.slice(cursor, local) });
                parts.push({ kind: 'chart', value: match.token, start: match.start, end: match.end, chartKind: match.kind });
                cursor = local + match.token.length;
            }
            if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
            offset += text.length;
        }
        return parts;
    }, [chartTokenRanges, inputValue, mentions]);

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

    const hero = variant === 'hero';
    // 放大（首屏与已有对话一致）：输入区向上长高、底边留在原处并盖住上方内容；margin 与高度同速过渡。
    const dockStyle = composerExpanded ? { marginTop: -(composerHeight - COMPOSER_MAX_HEIGHT) } : undefined;
    const running = allowDuringRun && isLoading;
    const hasDraft = Boolean(inputValue.trim());
    let inputPlaceholder: string;
    let inputLabel: string;
    if (disabled) { inputPlaceholder = '暂时无法发送'; inputLabel = agentMode ? '描述你的问题' : '输入消息'; }
    else if (awaitingInput) { inputPlaceholder = '补充信息，继续当前任务…'; inputLabel = '补充任务信息'; }
    else if (running) { inputPlaceholder = '补充信息或调整方向…'; inputLabel = '补充信息或调整方向'; }
    else if (imageMode) { inputPlaceholder = '描述要生成的图片，例如：水墨风格的山间小筑，晨雾缭绕…'; inputLabel = '描述要生成的图片'; }
    else if (isDreamMode) { inputPlaceholder = '说说你做了什么梦…'; inputLabel = '描述梦境'; }
    else if (hero) {
        inputPlaceholder = agentMode ? '例如：我明年适合换工作吗？' : '问问命盘、运势，或最近困惑的事…';
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
    const toolbarProps = {
        agentMode,
        disabled,
        userId,
        webControl,
        image: imageGeneration ? {
            active: imageMode,
            title: imageMode ? '退出生图，回到对话' : `生图（直接生成图片，不经过对话模型）${imageGeneration.model.own ? ` · 使用 ${imageGeneration.model.name}，不计费` : imageGeneration.model.priceMicros > 0 ? ` · 每张 ${formatUsd(imageGeneration.model.priceMicros, { precise: true })}` : ''}`,
            onToggle: () => setImageMode(value => !value),
        } : undefined,
        imageMode,
        memory: agentMode ? {
            enabled: memoryEnabled === true,
            disabled: !memoryFeatureEnabled || (!!userId && memoryEnabled === null),
            busy: memoryBusy,
            title: !memoryFeatureEnabled ? '个性化功能已关闭' : !userId ? '登录后可用' : memoryEnabled === null ? '正在读取记忆设置' : '允许 Agent 使用长期记忆：记住你说过的偏好、检索以往对话、按原话记录你讲述的经历',
            onToggle: () => { if (!userId) { requireLogin(); return; } void toggleMemory(); },
        } : undefined,
        fileInputRef,
        hasFile,
        onFileChange: handleFileChange,
        plainWeb: { active: hasWebSearch, allowed: plainWebAllowed || hasWebSearch, title: plainWebTitle, onToggle: handleWebToggle },
        knowledgeBase: {
            enabled: knowledgeBaseEnabled, allowed: canUseKnowledgeBase, selected: promptKnowledgeBases,
            items: mentionKnowledgeBases, savingId: knowledgeBaseSavingId, loading: mentionLoading,
            onLoad: () => { state.setMentionLoadError(null); void refreshMentionData(true); },
            onToggle: (id: string) => void toggleKnowledgeBaseSearch(id),
            onRemove: (id: string) => void toggleKnowledgeBaseSearch(id),
        },
        onLoginRequired: requireLogin,
        onSkillSelect: (name: string) => {
            onInputChange(`/skill:${name} `);
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        chatMode,
        onChatModeChange: onChatModeChange && ((mode: ChatMode) => { onChatModeChange(mode); textareaRef.current?.focus(); }),
        styles,
        addButtonRef: addMenuRef,
        polish: commands.polish,
        send,
        onSend: handleButtonClick,
        onStop,
    };

    return (
        <div data-chat-composer data-expanded={composerExpanded || undefined} className={`chat-composer-dock${hero ? ' is-hero' : ''}${disabled ? ' is-locked' : ''}`} style={dockStyle}>
            <div className="chat-composer-inner">
                <MentionManager
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
                />
                {queue}

                <div className="chat-composer-shell">
                    <QuoteBar quotes={quotes} onRemove={onRemoveQuote} disabled={disabled} />
                    {commands.ui}
                    {contextToken}
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

                    {!hero && <ComposerToolbar {...toolbarProps} showSend={false} />}

                    <div className={`chat-composer-field${composerExpandable ? ' has-expand' : ''}`}>
                        {composerExpandable && (
                            <Button unstyled
                                type="button"
                                className="chat-composer-expand"
                                aria-expanded={composerExpanded}
                                aria-label={composerExpanded ? '收起输入框' : '展开输入框'}
                                title={composerExpanded ? '收起输入框' : '展开输入框'}
                                onClick={() => { setComposerExpanded(value => !value); textareaRef.current?.focus(); }}
                            >
                                {composerExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
                            </Button>
                        )}
                        <div ref={overlayRef} className="chat-composer-input chat-composer-overlay" aria-hidden="true">
                            {inputValue ? highlightedInput.map((part, index) => part.kind === 'mention'
                                ? <span key={`${part.start}-${part.end}`} className="chat-mention-token" data-type={part.type}>
                                    <span className="chat-mention-at">@<MentionIcon type={part.type} size={12} /></span>{part.value.slice(1)}
                                </span>
                                : part.kind === 'chart'
                                    ? <span key={`chart-${part.start}`} className="chat-mention-token" data-type="chart">
                                        <span className="chat-mention-at">@<ChartAskIcon kind={part.chartKind} /></span>{part.value.slice(1)}
                                    </span>
                                    : <span key={`text-${index}`}>{part.value}</span>) : <span className="chat-composer-placeholder">{inputPlaceholder}</span>}
                        </div>
                        <Textarea
                            aria-label={inputLabel}
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => handleInputChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={event => {
                                const files = Array.from(event.clipboardData.files);
                                if (files.length) { event.preventDefault(); acceptFiles(files); return; }
                                if (!agentMode || !userId || uploads.uploading) return;
                                const text = event.clipboardData.getData('text/plain');
                                if (text.length > 8000 && !event.clipboardData.getData('text/html')) { event.preventDefault(); void uploads.upload([new File([text], `粘贴资料-${new Date().toISOString().slice(0,10)}.txt`, { type: 'text/plain' })]); showToast('info', '长文本已转为资料，可预览后再发送'); }
                            }}
                            onScroll={(e) => {
                                if (overlayRef.current) {
                                    overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                                }
                            }}
                            placeholder=""
                            className="chat-composer-input chat-composer-textarea min-h-0"
                            disabled={disabled}
                            // claude 的 composer 空态只有一行：rows=1 + field-sizing 随内容长高（hero 首屏给两行起步）
                            rows={hero ? 2 : 1}
                        />
                    </div>

                    {/* 会话内白壳只有一行：+（在最前）、编辑区、发送键同排。
                       hero（首屏）仍是两行壳：工具与发送同排在第二行，见 .is-hero 覆盖。 */}
                    {hero
                        ? <ComposerToolbar {...toolbarProps} />
                        : <ComposerSendCluster send={send} agentMode={agentMode} disabled={disabled} onSend={handleButtonClick} onStop={onStop} />}
                </div>

                {imageMode && imageGeneration && <div className="chat-image-options" role="group" aria-label="生图设置">
                    {imageGeneration.models.length > 1 && <label>模型
                        <Select
                            ariaLabel="生图模型"
                            className="h-7 w-auto min-w-0 max-w-[12rem] rounded-lg bg-background px-2 text-xs"
                            value={imageGeneration.model.id}
                            onChange={imageGeneration.onModelChange}
                            disabled={isLoading}
                            options={imageGeneration.models.map(model => ({ value: model.id, label: model.own ? `${model.name}（自定义）` : model.name }))}
                        />
                    </label>}
                    <label>尺寸
                        <Select
                            ariaLabel="尺寸"
                            className="h-7 w-auto min-w-0 rounded-lg bg-background px-2 text-xs"
                            value={imageSize}
                            onChange={setImageSize}
                            disabled={isLoading}
                            options={imageGeneration.sizes.map(size => ({ value: size, label: GENERATED_IMAGE_SIZE_LABELS[size] ?? size }))}
                        />
                    </label>
                    <label>张数
                        <Select
                            ariaLabel="张数"
                            className="h-7 w-auto min-w-0 rounded-lg bg-background px-2 text-xs"
                            value={imageCount}
                            onChange={setImageCount}
                            disabled={isLoading}
                            options={Array.from({ length: imageGeneration.maxCount }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` }))}
                        />
                    </label>
                    <span className="chat-image-cost">{imageGeneration.model.own ? '使用自己的生图模型，不计费' : imageGeneration.model.priceMicros > 0 ? `每张 ${formatUsd(imageGeneration.model.priceMicros, { precise: true })} · 共 ${formatUsd(imageGeneration.model.priceMicros * imageCount, { precise: true })}` : '本模型免费'}</span>
                </div>}

                <ComposerStatusBar
                    agentMode={agentMode}
                    disabled={disabled}
                    userId={userId}
                    selectedModel={selectedModel}
                    onModelChange={onModelChange}
                    reasoningEnabled={reasoningEnabled}
                    onReasoningChange={onReasoningChange}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={onReasoningEffortChange}
                    collaborators={collaborators}
                    onCollaboratorsChange={onCollaboratorsChange}
                    codeMode={codeMode}
                    onCodeModeChange={onCodeModeChange}
                    codeModeAvailable={codeModeAvailable}
                    planMode={planMode}
                    onPlanModeChange={onPlanModeChange}
                    planModeAvailable={planModeAvailable}
                    approval={approval}
                    onApprovalChange={onApprovalChange}
                    contextData={contextData}
                    onOpenContextResource={onOpenContextResource}
                />

                {note && <p className="chat-composer-note" data-optional={noteOptional || undefined}>{note}</p>}
                {hero && imageGeneration && !imageMode && !inputValue.trim() && <p className="chat-image-example">
                    <span>或者试试生图：</span>
                    <Button unstyled type="button" onClick={() => {
                        setImageMode(true);
                        onInputChange('水墨风格的山间小筑，晨雾缭绕，远山如黛');
                        textareaRef.current?.focus();
                    }}>水墨风格的山间小筑，晨雾缭绕</Button>
                </p>}
            </div>
        </div>
    );
}
