/**
 * Chat 主布局：消息区域 + 输入组件
 *
 * 对话侧边栏已合并到全局 Sidebar，此组件仅渲染聊天内容。
 *
 * 'use client' 标记说明：
 * - 使用 React hooks 和交互状态
 */
'use client';

import { useMemo, useRef, useState, useEffect, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { takeChatHandoff } from '@/lib/chat/result-handoff';
import { scrollToMessageId } from '@/lib/chat/message-navigation';
import { requestBrowserJson } from '@/lib/browser-api';
import { useToast } from '@/components/ui/Toast';
import { ConversationExportDialog } from './ConversationExportDialog';
import { AgentQueue } from './agent/AgentQueue';
import { LayoutDashboard, UsersRound, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import type { ChatMessage, AttachmentState, Mention, PrivateAttachment } from '@/types';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { VirtualizedChatMessageList } from '@/components/chat/VirtualizedChatMessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { FeaturePromoDialog, type FeaturePromoItem } from '@/components/chat/FeaturePromoDialog';
import { AgentIcon, ConnectorsIcon, GaugeIcon, MemoryIcon, ScheduleIcon, SkillIcon, WalletIcon } from '@/lib/navigation/nav-icons';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { openSettingsCenter } from '@/lib/settings-center';
import { QuoteSelection } from '@/components/chat/QuoteSelection';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { BrandMark } from '@/components/brand/BrandMark';
import type { ChatBootstrapKnowledgeBase } from '@/lib/chat/bootstrap';
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel';
import { prefersReducedMotion, useEntranceMotion } from '@/lib/motion/entrance';
import { SessionDetailsPanel } from './agent/SessionDetailsPanel';
import { AgentResultContext, isSameWorkspaceShown, type AgentWorkspaceShown } from './agent/AgentResultContext';
import { getAgentQuestionAnswers, getAgentWorkspaceAutoOpenEvent } from '@/lib/agent/workspace';
import { chartQuestion, type ChartAskContext } from '@/lib/agent/chart-interaction';
import { clampMessageQuoteText, MAX_MESSAGE_QUOTE_CHARS, MAX_MESSAGE_QUOTES, type MessageQuote } from '@/lib/chat/quotes';
import { AgentQuestionDock } from './agent/AgentQuestionDock';
import type { ComposerImageModel, ComposerWebControl } from './composer/ComposerToolbar';
import { useImageModels } from '@/lib/hooks/useAvailableModels';
import { useOwnModels } from '@/lib/byok/client';
import { GENERATED_IMAGE_MAX_COUNT as IMAGE_MAX_COUNT, GENERATED_IMAGE_SIZES } from '@/lib/images/generated';
import { publishChatModeControl, clearChatModeControl, type ChatModeControl } from '@/lib/chat/mode-control-store';
import { composerNote, isRunningComposerNote, type ComposerNoteState } from '@/lib/chat/composer-copy';
import { collectAgentArtifacts, getAgentCitedParagraph } from './agent/presentation';
import { isAgentRunTerminal, type AgentPart, type AgentRunStatus } from '@/lib/agent/types';
import { shouldPrefillFollowUp } from '@/lib/agent/follow-ups';
import { useTranscriptScroll } from '@/lib/chat/use-transcript-scroll';
import { orderAgentMessagesForDisplay } from '@/lib/agent/browser-client';
import { JumpToLatest } from './JumpToLatest';
import { useReadingPreferences } from '@/lib/chat/use-reading-preferences';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { ChatRecordViewContext, useChatRecordView } from '@/lib/chat/chat-record-view';
import { setChatWorkspaceOpen } from '@/lib/chat/chat-sidebar';
import { refreshAgentActivity } from '@/lib/agent/use-agent-activity';
import { isDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import type { CSSProperties } from 'react';
import { CHAT_SHORTCUTS, isShortcutSheetKey, isWorkspaceToggleKey, modifierLabel, shouldStopOnEscape } from '@/lib/chat/chat-shortcuts';
import { dispatchComposerFiles, dragHasFiles } from '@/lib/chat/composer-files';
import './chat-workspace.css';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';

/** 工作区退场动画的时长（chat-workspace.css 的 agent-panel-out / agent-sheet-out），播完再卸载。 */
const WORKSPACE_LEAVE_MS = 200;

interface ChatLayoutProps extends ModelSettingsProps {
    agent?: ReturnType<typeof import('@/lib/agent/use-agent-chat').useAgentChat>;
    onQueueMessage?: () => Promise<void>;
    // Active conversation
    activeConversationId: string | null;
    conversationTitle?: string;
    conversationLoading: boolean;
    conversationError?: string | null;

    // Messages
    messages: ChatMessage[];
    isLoading: boolean;
    isSendingToList: boolean;
    messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
    messageScrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
    shouldAutoScrollRef: React.MutableRefObject<boolean>;
    onMessageListScroll: () => void;
    // Handlers
    onEditMessage: (messageId: string, newContent: string, nextMentions?: Mention[]) => Promise<void>;
    onRegenerateResponse: (messageId: string) => Promise<void>;
    onSwitchVersion: (messageId: string, versionIndex: number) => void;
    onArchiveMessage?: (message: ChatMessage) => void;
    /** Sends the composer; the optional context is the rich chart quote attached above it. */
    onSend: (context?: string, quotes?: MessageQuote[]) => Promise<void>;
    /** 输入框生图：直接调用生图接口，不经过对话模型。 */
    onImageGenerate?: (options: { prompt: string; size: string; count: number }) => void | Promise<void>;
    onStop: () => void;
    onRetryConversationLoad?: () => Promise<void>;

    // Composer props
    inputValue: string;
    onInputChange: (value: string) => void;
    disabled: boolean;
    selectedModel: string;
    onModelChange: (model: string) => void;
    reasoningEnabled: boolean;
    onReasoningChange: (enabled: boolean) => void;
    /** 生图与 Agent 生图工具用的模型；null 时选第一个可用的。 */
    imageModel: string | null;
    onImageModelChange: (model: string | null) => void;
    userId: string | null;
    /** Profile nickname for the empty-state greeting. */
    displayName?: string | null;
    attachmentState: AttachmentState;
    onAttachmentChange: (state: AttachmentState) => void;
    mentions: Mention[];
    onMentionsChange: (mentions: Mention[]) => void;
    promptKnowledgeBases: ChatBootstrapKnowledgeBase[];
    knowledgeBaseEnabled: boolean;

    onAuthRequired?: () => void;

    // Modals (rendered by parent)
    children?: ReactNode;
}

export function ChatLayout(props: ChatLayoutProps) {
    const {
        activeConversationId, conversationLoading,
        conversationError,
        messages, isLoading, isSendingToList,
        messagesEndRef, messageScrollContainerRef, onMessageListScroll,
        onEditMessage, onRegenerateResponse, onSwitchVersion, onArchiveMessage,
        onSend, onImageGenerate, onStop, onRetryConversationLoad,
        inputValue, onInputChange, disabled,
        selectedModel, onModelChange, reasoningEnabled, onReasoningChange,
        imageModel, onImageModelChange,
        userId, attachmentState, onAttachmentChange,
        mentions, onMentionsChange, promptKnowledgeBases,
        knowledgeBaseEnabled,
        onAuthRequired,
        children,
    } = props;

    const contentRef = useRef<HTMLDivElement>(null);
    const greeting = useGreeting();
    const displayName = props.displayName?.trim();
    const { preferences } = useReadingPreferences(props.userId);
    const recordView = useChatRecordView(userId, activeConversationId);
    const workspaceButtonRef = useRef<HTMLButtonElement>(null);
    const [openWorkspaceKey, setOpenWorkspaceKey] = useState<string | null>(null);
    const workspaceKey = `${userId ?? 'anonymous'}:${activeConversationId ?? 'new'}`;
    // 工作区的进出场：读者或模型刚打开时滑入（enteringKey）；随会话恢复的直接出现，不在切换会话时重放。
    // 关闭时先播放退场（leavingKey），播完再卸载。
    const [enteringKey, setEnteringKey] = useState<string | null>(null);
    const [leavingKey, setLeavingKey] = useState<string | null>(null);
    const [resourceRequest, setResourceRequest] = useState<{ scope: string; id: string; version: number } | null>(null);
    const autoWorkspace = useRef<{ scope: string; action: string | null }>({ scope: '', action: null });
    const openResource = useCallback((id: string) => {
        setResourceRequest(previous => ({ scope: workspaceKey, id, version: (previous?.version ?? 0) + 1 }));
        setOpenWorkspaceKey(workspaceKey);
        setEnteringKey(workspaceKey);
        try { sessionStorage.setItem(`taibu.workspace-open:${workspaceKey}`, '1'); } catch { /* optional */ }
    }, [workspaceKey]);
    const [workspaceShown, setWorkspaceShown] = useState<AgentWorkspaceShown | null>(null);
    const updateWorkspaceShown = useCallback((next: AgentWorkspaceShown | null) => setWorkspaceShown(previous => isSameWorkspaceShown(previous, next) ? previous : next), []);
    useEffect(() => {
        let current = true;
        queueMicrotask(() => {
            if (!current) return;
            // Reopened only where it docks beside the conversation; narrower screens would get a dialog nobody asked for.
            setEnteringKey(null);
            try { setOpenWorkspaceKey(sessionStorage.getItem(`taibu.workspace-open:${workspaceKey}`) === '1' && isDesktopLayout() ? workspaceKey : null); } catch { setOpenWorkspaceKey(null); }
        });
        return () => { current = false; };
    }, [workspaceKey]);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const targetMessageId = searchParams.get('message');
    // 搜索弹层「撰写」：用查询词预填草稿（只填一次，随后清掉参数避免刷新覆盖）。
    const draftQuery = searchParams.get('draft');
    const appliedDraft = useRef<string | null>(null);
    useEffect(() => {
        if (!draftQuery || appliedDraft.current === draftQuery) return;
        appliedDraft.current = draftQuery;
        onInputChange(draftQuery);
        // 草稿已落进输入框：把参数从地址里摘掉，刷新或前进后退不会再次覆盖。
        router.replace('/chat', { scroll: false });
        requestAnimationFrame(() => contentRef.current?.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus());
    }, [draftQuery, onInputChange, router]);
    // 结果页交接：新对话挂载时把预填问题与已保存命盘的 mention 放回输入框，只应用一次。
    const appliedHandoff = useRef(false);
    useEffect(() => {
        if (appliedHandoff.current || activeConversationId) return;
        const handoff = takeChatHandoff();
        if (!handoff) return;
        appliedHandoff.current = true;
        onInputChange(handoff.text);
        if (handoff.mentions?.length) onMentionsChange(handoff.mentions);
        requestAnimationFrame(() => contentRef.current?.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus());
    }, [activeConversationId, onInputChange, onMentionsChange]);
    const locatedTarget = useRef('');
    useEffect(() => {
        if (!targetMessageId || conversationLoading || !messages.some(message => message.id === targetMessageId)) return;
        const target = `${workspaceKey}:${targetMessageId}`;
        if (locatedTarget.current === target) return;
        const frame = requestAnimationFrame(() => { if (scrollToMessageId(workspaceKey, targetMessageId)) locatedTarget.current = target; });
        return () => cancelAnimationFrame(frame);
    }, [targetMessageId, conversationLoading, messages, workspaceKey]);
    useEffect(() => {
        let current = true;
        const fork = async (event: Event) => {
            if (!activeConversationId || !userId) return;
            const result = await requestBrowserJson<{ conversationId: string }>(`/api/conversations/${activeConversationId}/fork`, { method: 'POST', body: JSON.stringify({ messageId: (event as CustomEvent<string>).detail }) });
            if (!current) return;
            if (result.error || !result.data) showToast('error', result.error?.message ?? '分叉失败');
            else router.push(`/chat?id=${result.data.conversationId}`);
        };
        window.addEventListener('taibu:fork-message', fork);
        return () => { current = false; window.removeEventListener('taibu:fork-message', fork); };
    }, [activeConversationId, userId, router, showToast]);
    const currentRun = props.agent?.run?.conversationId === activeConversationId ? props.agent.run : undefined;
    const transcriptMessages = useMemo(() => {
        const hidden = new Set(currentRun?.queue?.filter(command => command.state === 'pending' || command.state === 'cancelled').map(command => command.message.id));
        return orderAgentMessagesForDisplay(messages.filter(message => !hidden.has(message.id)), currentRun);
    }, [messages, currentRun]);
    // 新消息淡入：按行号记住已出现的行，临时 id 换成正式 id、虚拟列表滚回视野时不再重放。
    // 新对话发出第一条消息后才拿到会话 ID：这一步仍是同一段对话，作用域沿用，第一轮的淡入不被打断。
    const [motionScope, setMotionScope] = useState(workspaceKey);
    const [motionKey, setMotionKey] = useState(workspaceKey);
    if (motionKey !== workspaceKey) {
        setMotionKey(workspaceKey);
        if (!(motionKey.endsWith(':new') && transcriptMessages.length > 0)) setMotionScope(workspaceKey);
    }
    useEntranceMotion(contentRef, { selector: '.chat-transcript-row', scope: motionScope, ready: !conversationLoading });
    const { showJump, jumpToLatest } = useTranscriptScroll({ scrollRef: messageScrollContainerRef, followRef: props.shouldAutoScrollRef, conversationKey: workspaceKey, messages: transcriptMessages, enabled: !conversationLoading && transcriptMessages.length > 0, virtualized: transcriptMessages.length > 20 });
    // Esc 停止生成（菜单、弹窗、行内编辑先消费 Esc）；⌘/ 打开快捷键说明；⌘\ 开关工作区（有工作区按钮时）。
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const workspaceShortcut = useRef<(() => void) | null>(null);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isShortcutSheetKey(event)) { event.preventDefault(); setShortcutsOpen(open => !open); return; }
            if (isWorkspaceToggleKey(event) && workspaceShortcut.current) { event.preventDefault(); workspaceShortcut.current(); return; }
            if (shouldStopOnEscape(event, isLoading, document)) { event.preventDefault(); onStop(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isLoading, onStop]);
    // 拖放文件到会话区：覆盖层提示，松手后交给输入框现有的附件流程。
    const [dragging, setDragging] = useState(false);
    const acceptsDrop = !!userId && !disabled && !conversationLoading;
    const latestAgentData = useMemo(() => [...messages].reverse().find(message => message.agent)?.agent, [messages]);
    const artifacts = useMemo(() => collectAgentArtifacts(messages), [messages]);
    const agentParts = useMemo(() => messages.flatMap(message => message.agent?.parts ?? []), [messages]);
    const questionAnswers = useMemo(() => getAgentQuestionAnswers(messages), [messages]);
    const attachmentIds = useMemo(() => [...new Set(messages.flatMap(message => message.attachments?.ids ?? []))], [messages]);
    const draftScope = useRef(workspaceKey);
    useEffect(() => { draftScope.current = workspaceKey; }, [workspaceKey]);
    const restoreDraft = async (message: ChatMessage) => {
        const ownerScope = workspaceKey;
        const restored: PrivateAttachment[] = [];
        for (const id of message.attachments?.ids ?? []) {
            const response = await requestBrowserJson<{ attachment: PrivateAttachment }>(`/api/agent/attachments/${id}`);
            if (draftScope.current !== ownerScope) return;
            if (!response.data?.attachment) { showToast('error', '部分资料无法恢复，请重新添加'); continue; }
            restored.push(response.data.attachment);
        }
        if (draftScope.current !== ownerScope) return;
        const merged = [...new Map([...(attachmentState.uploaded ?? []), ...restored].map(item => [item.id, item])).values()];
        if (merged.length > 12 || merged.filter(item => item.kind === 'image').length > 4) { showToast('error', '请先移除部分草稿资料再恢复'); return; }
        onAttachmentChange({ ...attachmentState, uploaded: merged });
        onInputChange(inputValue.trim() ? `${inputValue}\n\n${message.content}` : message.content);
    };
    const isAgentMode = props.agent?.mode === 'agent';
    const { conversations } = useConversationList();
    const modeSettled = props.agent?.modeSettled !== false;
    const opened = conversations.find(conversation => conversation.id === activeConversationId);
    // 会话自己的方式：打开时以它为准；新建的 Agent 会话在首轮运行前 hasAgentRun 仍是 false，用消息形态区分。
    const hasAgentMessages = messages.some(message => Boolean(message.agent));
    const conversationMode: 'agent' | 'plain' | undefined = activeConversationId && hasAgentMessages ? 'agent'
        : !activeConversationId || !opened || opened.hasAgentRun === undefined ? undefined
        : opened.hasAgentRun === true ? 'agent'
        : messages.length > 0 && messages.every(message => !message.agent) ? 'plain'
        : undefined;
    // 每次打开会话只跟随一次；此后用户点切换以用户为准，不然就会把人弹回去、切不动。
    const followedConversation = useRef<string | null>(null);
    useEffect(() => {
        if (!activeConversationId || !modeSettled || !conversationMode) return;
        if (followedConversation.current === activeConversationId) return;
        followedConversation.current = activeConversationId;
        if ((conversationMode === 'agent') !== isAgentMode) props.agent?.setMode(conversationMode);
    }, [activeConversationId, conversationMode, isAgentMode, modeSettled, props.agent]);
    // 在会话里换到另一种方式：两种内容不混在一段对话里，开一条同方式的新会话。
    // 新会话没有会话级方式可跟随：把方式写进地址，刷新后仍停在同一种对话（不动历史记录）。
    const changeMode = useCallback((next: 'agent' | 'plain') => {
        props.agent?.setMode(next);
        if (conversationMode) {
            if ((conversationMode === 'agent') !== (next === 'agent')) router.push(next === 'agent' ? '/chat?mode=agent' : '/chat');
            return;
        }
        if ((searchParams.get('mode') === 'agent') !== (next === 'agent')) router.replace(next === 'agent' ? '/chat?mode=agent' : '/chat');
    }, [conversationMode, props.agent, router, searchParams]);
    const waitingQuestion = userId && props.agent?.run?.conversationId === activeConversationId && props.agent.run.status === 'awaiting_input'
        ? [...props.agent.run.message.agent?.parts ?? []].reverse().find((part): part is Extract<AgentPart, { type: 'question' }> => part.type === 'question') : undefined;
    const hasWorkspace = isAgentMode || Boolean(latestAgentData);
    const workspaceOpen = hasWorkspace && openWorkspaceKey === workspaceKey;
    const resultWorkspace = useMemo(() => ({ openResource, shown: workspaceOpen ? workspaceShown : null }), [openResource, workspaceOpen, workspaceShown]);
    // The chat sidebar folds to its rail while the workspace is open beside the conversation.
    useEffect(() => {
        setChatWorkspaceOpen(workspaceOpen);
        return () => setChatWorkspaceOpen(false);
    }, [workspaceOpen]);
    // Task markers in the sidebar follow this page's run without waiting for their next poll.
    const currentRunStatus = currentRun?.status;
    useEffect(() => { if (currentRunStatus) refreshAgentActivity(); }, [currentRunStatus]);
    const closeWorkspace = () => {
        const previous = document.activeElement;
        const scope = workspaceKey;
        setOpenWorkspaceKey(null);
        setLeavingKey(scope);
        setTimeout(() => setLeavingKey(current => current === scope ? null : current), prefersReducedMotion() ? 0 : WORKSPACE_LEAVE_MS);
        setResourceRequest(null);
        try { sessionStorage.removeItem(`taibu.workspace-open:${workspaceKey}`); if (currentRun) sessionStorage.setItem('taibu.workspace-dismissed:' + workspaceKey, currentRun.id); } catch { /* optional */ }
        requestAnimationFrame(() => {
            const active = document.activeElement;
            if (!active || active === document.body || active === previous) workspaceButtonRef.current?.focus();
        });
    };
    // Chart readings, questions and collaborations open the panel on desktop until it is closed for this task.
    const autoOpenEvent = getAgentWorkspaceAutoOpenEvent(currentRun?.message.agent?.parts ?? []);
    const workspaceRun = currentRun && currentRun.id === latestAgentData?.runId ? { billing: currentRun.billing, configuration: currentRun.configuration, createdAt: currentRun.createdAt } : undefined;
    useEffect(() => {
        const action = autoOpenEvent;
        if (autoWorkspace.current.scope !== workspaceKey) { autoWorkspace.current = { scope: workspaceKey, action }; return; }
        if (!action || autoWorkspace.current.action === action || !currentRun || props.agent?.restoring) return;
        autoWorkspace.current.action = action;
        // 自动打开只跟随进行中的任务；回看已结束的任务时，最后一次查看的盘不再把面板拉开。
        if (isAgentRunTerminal(currentRun.status)) return;
        if (!isDesktopLayout()) return;
        try { if (sessionStorage.getItem('taibu.workspace-dismissed:' + workspaceKey) === currentRun.id) return; } catch { /* optional */ }
        queueMicrotask(() => {
            if (autoWorkspace.current.scope !== workspaceKey) return;
            setOpenWorkspaceKey(workspaceKey);
            setEnteringKey(workspaceKey);
            // 直接落到产生这次自动打开的资源（命盘 / 协作 / 问题），而不是停在概览。
            setResourceRequest(previous => ({ scope: workspaceKey, id: `tool:${action}`, version: (previous?.version ?? 0) + 1 }));
            try { sessionStorage.setItem('taibu.workspace-open:' + workspaceKey, '1'); } catch { /* optional */ }
        });
    }, [autoOpenEvent, currentRun, props.agent?.restoring, workspaceKey]);
    const title = props.conversationTitle || messages.find(message => message.role === 'user')?.content.slice(0, 60) || (isAgentMode ? '新任务' : '新对话');
    const focusComposer = useCallback((scope = workspaceKey) => requestAnimationFrame(() => {
        if (draftScope.current === scope) contentRef.current?.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus();
    }), [workspaceKey]);
    // 任务在本页跑完时，把它建议的那一条追问直接写进输入框（可改可直接发）。
    // 只在看到过它运行时生效：打开旧对话不会把当时的建议塞进输入框；已有草稿也不覆盖。
    const seenRunStatus = useRef(new Map<string, AgentRunStatus>());
    useEffect(() => {
        if (!latestAgentData) return;
        const previousStatus = seenRunStatus.current.get(latestAgentData.runId);
        seenRunStatus.current.set(latestAgentData.runId, latestAgentData.status);
        const suggestion = latestAgentData.followUps?.[0];
        if (!shouldPrefillFollowUp({ previousStatus, status: latestAgentData.status, suggestion, draft: inputValue, disabled })) return;
        onInputChange(suggestion!);
        focusComposer();
    }, [latestAgentData, inputValue, disabled, onInputChange, focusComposer]);
    // 引用：选中助手回答中的文字或「引用整条」，进入输入框上方的引用条；发送后随用户消息一起保存。
    const [quotes, setQuotes] = useState<MessageQuote[]>([]);
    const quotesRef = useRef(quotes);
    useEffect(() => { quotesRef.current = quotes; }, [quotes]);
    // 每个对话（含新建的草稿）各有一份引用条，切换对话时不把上一段对话的引用带过去。
    const quotesScope = useRef(workspaceKey);
    useEffect(() => {
        if (quotesScope.current === workspaceKey) return;
        quotesScope.current = workspaceKey;
        setQuotes([]);
    }, [workspaceKey]);
    const addQuote = useCallback((quote: MessageQuote) => {
        const text = clampMessageQuoteText(quote.text);
        if (!text) return;
        if (quote.text.trim().length > MAX_MESSAGE_QUOTE_CHARS) showToast('info', `单段引用最多 ${MAX_MESSAGE_QUOTE_CHARS} 字，已截取`);
        if (quotesRef.current.length >= MAX_MESSAGE_QUOTES) { showToast('info', `最多引用 ${MAX_MESSAGE_QUOTES} 段`); return; }
        setQuotes(current => current.some(item => item.messageId === quote.messageId && item.text === text)
            ? current
            : [...current, { messageId: quote.messageId, text }].slice(0, MAX_MESSAGE_QUOTES));
    }, [showToast]);
    const removeQuote = useCallback((index: number) => setQuotes(current => current.filter((_, position) => position !== index)), []);
    // 追问命盘：与提及同一形态——在输入框尾部追加可识别的 chip，可以连续叠加多条。
    const [chartAsks, setChartAsks] = useState<ChartAskContext[]>([]);
    const chartAskToken = (ask: ChartAskContext) => `@${ask.title}${ask.targets.length ? ` · ${ask.targets.map(target => target.label).join('、')}` : ' · 整张命盘'}`;
    const chartAskKey = (ask: ChartAskContext) => `${ask.reference}:${ask.targets.map(target => target.id).join(',')}`;
    // 输入框里删掉 chip 文本后，对应上下文立即失效（不额外 setState）。
    const activeChartAsks = useMemo(() => chartAsks.filter(ask => inputValue.includes(chartAskToken(ask))), [chartAsks, inputValue]);
    const chartAskChips = useMemo(() => activeChartAsks.map(ask => ({ token: chartAskToken(ask), kind: ask.kind })), [activeChartAsks]);
    const askAboutChart = (ask: ChartAskContext) => {
        const key = chartAskKey(ask);
        if (!activeChartAsks.some(item => chartAskKey(item) === key)) {
            setChartAsks(current => {
                const kept = current.filter(item => inputValue.includes(chartAskToken(item)));
                return kept.some(item => chartAskKey(item) === key) ? kept : [...kept, ask];
            });
        }
        const token = chartAskToken(ask);
        const base = inputValue.replace(/\s*$/, '');
        if (!base.includes(token)) onInputChange(base ? `${base}\n${token}` : token);
        if (!isDesktopLayout()) closeWorkspace();
        focusComposer();
    };
    const sendWithContext = async () => {
        const context = activeChartAsks.length ? activeChartAsks.map(ask => chartQuestion(ask.reference, ask.targets)).join('\n\n') : undefined;
        const outgoing = quotes;
        await onSend(context, outgoing.length ? outgoing : undefined);
        // 发送被余额提示拦下时保留引用与追问命盘，用户不必重新添加。
        setChartAsks([]);
        if (outgoing.length) setQuotes([]);
    };
    // “稍后回答” folds the dock for this question only; a new question opens it again.
    const questionKey = waitingQuestion && props.agent?.run ? `${workspaceKey}:${props.agent.run.id}:${waitingQuestion.id}` : null;
    const [laterQuestion, setLaterQuestion] = useState<string | null>(null);
    const questionLater = questionKey !== null && laterQuestion === questionKey;
    const collaborators = currentRun?.configuration?.collaborators.length ?? 0;
    const agent = props.agent;
    const { isFeatureEnabled, loaded: featureTogglesLoaded } = useFeatureToggles();
    // Beta 功能弹窗不按「是否用过」过滤：以后还会加新功能，「不再显示」一次覆盖整组。
    const promoItems = useMemo<FeaturePromoItem[]>(() => {
        if (!userId || !featureTogglesLoaded) return [];
        // 只有 Agent 整体不可用时，Agent 相关条目才整组隐藏；关掉某一项工具范围不影响这里。
        const agentOn = !!agent?.capabilities.ready && isFeatureEnabled('agent');
        const items: (FeaturePromoItem | false)[] = [
            agentOn && !isAgentMode && {
                id: 'agent', label: 'Agent', title: 'Agent：自己动手的太卜',
                description: '交给它一个问题，它会自己排盘、查资料、调用工具，一步步推理到结论。',
                highlights: ['排盘、检索、调用工具一气呵成', '推理过程实时可见，随时可以停下', '成果在右侧工作区展开'],
                actionLabel: '切换到 Agent', onAction: () => changeMode('agent'),
                icon: size => <AgentIcon size={size} />,
            },
            agentOn && {
                id: 'collaboration', label: '多模型协作', title: '多模型协作',
                description: '在 Agent 里给主模型配几位协作者，分头分析同一个问题，再由主模型汇总取舍。',
                highlights: ['在输入框的模型菜单里勾选即可启用', '可预设每位成员的名称、角色和分工', '每位成员按各自用量计费'],
                actionLabel: '预设协作成员', onAction: () => openSettingsCenter('personalization'),
                icon: size => <UsersRound size={size} aria-hidden="true" />,
            },
            agentOn && isFeatureEnabled('memory') && isFeatureEnabled('ai-personalization') && {
                id: 'memory', label: '长期记忆', title: '长期记忆',
                description: '开启后，太卜会记住你的偏好与重要经历，并能检索过往对话。',
                highlights: ['值得记住的内容自动写入', '随时查看、添加或删除', '关闭不会删除已保存的记忆'],
                actionLabel: '管理记忆', onAction: () => openSettingsCenter('personalization'),
                icon: size => <MemoryIcon size={size} />,
            },
            agentOn && isFeatureEnabled('skills') && {
                id: 'skills', label: '技能', title: '技能',
                description: '把常用的分析方法写成技能，Agent 遇到相关任务时会自动加载。',
                highlights: ['相关任务中自动加载', '输入 /skill:名称 直接调用', '可附带参考文件'],
                actionLabel: '添加技能', onAction: () => openSettingsCenter('skills'),
                icon: size => <SkillIcon size={size} />,
            },
            agentOn && isFeatureEnabled('connectors') && {
                id: 'connectors', label: '连接器', title: '连接器',
                description: '接入自己的 MCP 服务，让 Agent 在联网任务中调用它们的工具。',
                highlights: ['接入远程 MCP 服务', '联网任务中按需调用', '随时停用或移除'],
                actionLabel: '添加连接器', onAction: () => openSettingsCenter('connectors'),
                icon: size => <ConnectorsIcon size={size} />,
            },
            agentOn && isFeatureEnabled('schedules') && {
                id: 'schedules', label: '定时任务', title: '定时任务',
                description: '让 Agent 按你设定的时间自动执行任务，结果写回绑定的对话。',
                highlights: ['每天、每周、每月或自定义时间', '结果写入绑定的对话', '可暂停、恢复或立即运行'],
                actionLabel: '查看定时任务', onAction: () => router.push('/scheduled'),
                icon: size => <ScheduleIcon size={size} />,
            },
            isFeatureEnabled('billing') && {
                id: 'billing', label: '钱包', title: '钱包',
                description: '余额、订阅、充值与兑换码集中管理，随时看清每一笔钱的去向。',
                highlights: ['自选先扣订阅额度还是先扣余额', '兑换码与订阅在同一处管理', '充值订单可随时查看'],
                actionLabel: '打开钱包', onAction: () => openSettingsCenter('billing'),
                icon: size => <WalletIcon size={size} />,
            },
            isFeatureEnabled('usage-log') && {
                id: 'usage-log', label: '用量日志', title: '用量日志',
                description: '每次模型调用的用量与费用都有记录，自带密钥的调用也会记一条。',
                highlights: ['逐条查看 token 用量与费用', '充值、兑换、订阅等资金变动同屏', '按时间范围筛选'],
                actionLabel: '查看用量', onAction: () => openSettingsCenter('usage-log'),
                icon: size => <GaugeIcon size={size} />,
            },
        ];
        return items.filter((item): item is FeaturePromoItem => !!item);
    }, [userId, featureTogglesLoaded, agent?.capabilities.ready, isFeatureEnabled, isAgentMode, changeMode, router]);
    const modeControl: ChatModeControl | null = agent ? {
        mode: agent.mode,
        onChange: changeMode,
        agentDisabled: agent.active || (!!userId && !agent.capabilities.ready),
        plainDisabled: agent.active,
    } : null;
    // 侧栏品牌行与移动抽屉通过 store 共享这一个控件（全页恰好一个「对话方式」单选组）。
    useEffect(() => { publishChatModeControl(modeControl); });
    useEffect(() => clearChatModeControl, []);
    const webAllowed = !!agent?.capabilities.webAvailable;
    const webControl: ComposerWebControl | undefined = agent && isAgentMode ? {
        enabled: agent.webEnabled && webAllowed,
        disabled: !webAllowed,
        label: agent.active ? '下次联网' : '按需联网',
        title: !webAllowed ? '当前环境未配置联网搜索' : agent.active ? '下个独立任务使用此配置' : 'Agent 会在需要时搜索网络',
        onToggle: () => agent.setWebEnabled(!agent.webEnabled),
    } : undefined;
    // 生图入口：有可用生图模型（平台的或自己的）、且任务未运行时才提供。
    const imageModels = useImageModels(userId, { enabled: !!userId });
    const own = useOwnModels(userId);
    const imageChoices = useMemo<ComposerImageModel[]>(() => [
        ...(imageModels.data?.models ?? []).map(model => ({ id: model.id, name: model.name, priceMicros: model.priceMicros, own: false })),
        ...own.models.filter(model => model.usage === 'image').map(model => ({ id: model.ref, name: model.displayName, priceMicros: 0, own: true })),
    ], [imageModels.data?.models, own.models]);
    const currentImageModel = imageChoices.find(model => model.id === imageModel) ?? imageChoices[0];
    // A choice that is gone (a deleted own model) falls back to the first once both lists have loaded.
    const imageListsLoaded = !!userId && !imageModels.isLoading && !own.loading;
    useEffect(() => {
        if (!imageListsLoaded) return;
        const next = currentImageModel?.id ?? null;
        if (next !== imageModel) onImageModelChange(next);
    }, [currentImageModel?.id, imageListsLoaded, imageModel, onImageModelChange]);
    const imageGeneration = currentImageModel && !agent?.active ? {
        sizes: imageModels.data?.sizes.length ? imageModels.data.sizes : [...GENERATED_IMAGE_SIZES],
        models: imageChoices,
        model: currentImageModel,
        onModelChange: onImageModelChange,
        maxCount: imageModels.data?.maxCount ?? IMAGE_MAX_COUNT,
        onGenerate: (options: { prompt: string; size: string; count: number }) => { void onImageGenerate?.(options); },
    } : undefined;
    const noteState: ComposerNoteState = {
        agentMode: isAgentMode,
        agentUnavailable: !!userId && !!agent && !agent.capabilities.ready,
        reconnecting: agent?.reconnecting,
        awaiting: currentRun?.status === 'awaiting_input',
        running: !!agent?.active && !!currentRun,
        collaborators,
    };
    const note = composerNote(noteState);
    const citedParagraph = useCallback((cite: number) => getAgentCitedParagraph(messages, cite), [messages]);
    const composerProps = {
        draftKey: workspaceKey,
        reasoningEffort: props.reasoningEffort, onReasoningEffortChange: props.onReasoningEffortChange,
        reasoningFromModel: props.reasoningFromModel, onReasoningFromModelChange: props.onReasoningFromModelChange,
        collaborators: props.collaborators, onCollaboratorsChange: props.onCollaboratorsChange,
        codeMode: agent?.codeMode, onCodeModeChange: agent?.setCodeMode,
        planMode: agent?.planMode, onPlanModeChange: agent?.setPlanMode,
        codeModeAvailable: agent?.capabilities.codeModeAvailable,
        planModeAvailable: agent?.capabilities.planModeAvailable,
        approval: agent?.approval, onApprovalChange: agent?.setApproval,
        agentMode: isAgentMode,
        contextData: latestAgentData,
        onOpenContextResource: openResource,
        awaitingInput: props.agent?.run?.status === 'awaiting_input',
        allowDuringRun: props.agent?.active,
        onQueueMessage: props.onQueueMessage,
        inputValue, isLoading, isSendingToList,
        onInputChange, onSend, onStop, onAuthRequired, disabled,
        selectedModel, onModelChange, reasoningEnabled, onReasoningChange,
        userId, attachmentState, onAttachmentChange,
        mentions, onMentionsChange, promptKnowledgeBases,
        quotes, onRemoveQuote: removeQuote,
        chartAsks: chartAskChips,
        knowledgeBaseEnabled,
        webControl,
        imageGeneration,
        plainWebAvailable: !!agent?.capabilities.plainWebAvailable,
    };
    const composer = <ChatComposer {...composerProps} onSend={sendWithContext} continuing note={note} noteOptional={isRunningComposerNote(noteState)}
        queue={currentRun && <AgentQueue key={`${workspaceKey}:${currentRun.id}`} run={currentRun} restoreDraft={message => void restoreDraft(message)} />} />;
    const toggleWorkspace = () => {
        if (workspaceOpen) { closeWorkspace(); return; }
        setOpenWorkspaceKey(workspaceKey);
        setEnteringKey(workspaceKey);
        try { sessionStorage.setItem(`taibu.workspace-open:${workspaceKey}`, '1'); sessionStorage.removeItem('taibu.workspace-dismissed:' + workspaceKey); } catch { /* optional */ }
    };
    // 会话栏的成果行：打开工作区并定位到对应资源。
    const openWorkspaceResource = (id: string) => openResource(id);
    // A new conversation opens on the greeting alone; saved conversations keep their header.
    const emptyState = !conversationLoading && messages.length === 0;
    const showHeader = !emptyState || !!activeConversationId || !!conversationError;
    // ⌘\ 走与标题栏按钮相同的开关；没有按钮（新对话、普通对话）时快捷键不做事。
    useEffect(() => { workspaceShortcut.current = hasWorkspace && showHeader ? toggleWorkspace : null; });
    // 右侧会话栏常驻（claude /code 无开关），仅在打开工作区时让位。
    const showSessionDetails = isAgentMode && Boolean(latestAgentData) && showHeader && !workspaceOpen;
    // 生成中锁住编辑、重新生成、版本切换与分叉：它们都会改写正在写入的分支。
    const transcriptLocked = isLoading || !!props.agent?.active || !!props.agent?.restoring || !!props.agent?.syncing;

    return (
        <AgentResultContext.Provider value={resultWorkspace}><ChatRecordViewContext.Provider value={recordView}><div className="chat-workspace flex bg-background" style={{ '--chat-column': `${preferences.width}px` } as CSSProperties}>
            {/* data-agent-ready turns true once a restored task has finished syncing. */}
            <div ref={contentRef} className="chat-main flex-1 flex flex-col min-w-0 min-h-0 relative bg-background"
                data-agent-ready={props.agent ? !props.agent.restoring && !props.agent.syncing : undefined}
                onDragEnter={event => { if (acceptsDrop && dragHasFiles(event.dataTransfer.types)) { event.preventDefault(); setDragging(true); } }}
                onDragOver={event => { if (acceptsDrop && dragHasFiles(event.dataTransfer.types)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
                onDragLeave={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false); }}
                onDrop={event => {
                    setDragging(false);
                    if (!acceptsDrop || !dragHasFiles(event.dataTransfer.types)) return;
                    event.preventDefault();
                    dispatchComposerFiles(Array.from(event.dataTransfer.files));
                }}>
                {dragging && <div className="chat-drop-overlay" aria-hidden="true"><span>拖放文件以添加到对话</span></div>}
                <ChatHeader
                    navigation={<MobileChatDrawer />}
                    empty={!showHeader}
                    title={title}
                    conversationId={activeConversationId}
                    workspaceButton={hasWorkspace && showHeader ? <Button ref={workspaceButtonRef} variant="ghost" className="chat-workspace-toggle" aria-label="任务工作区" aria-expanded={workspaceOpen} aria-controls="agent-workspace-panel" onClick={toggleWorkspace}>
                        <LayoutDashboard size={17} strokeWidth={1.8} aria-hidden="true" /><span className="chat-workspace-toggle-label">工作区</span>
                    </Button> : undefined}
                    knowledgeBaseEnabled={knowledgeBaseEnabled}
                    userId={userId}
                />
                {activeConversationId && <ConversationExportDialog conversationId={activeConversationId} />}
                {/* 会话列 + 右侧「会话详情」栏（claude /code 停靠栏）：工作区打开时右栏让位。 */}
                <div className="chat-main-body flex min-h-0 min-w-0 flex-1">
                    <div className="chat-main-column relative flex min-h-0 min-w-0 flex-1 flex-col">

                {conversationError ? (
                    <div className="chat-load-error" role="alert">
                        <span>{conversationError}</span>
                        {onRetryConversationLoad ? <Button variant="ghost" size="xs" onClick={() => void onRetryConversationLoad()}>重试</Button> : null}
                    </div>
                ) : null}

                {conversationLoading ? (
                    <SoundWaveLoader variant="block" text="" />
                ) : emptyState ? (
                    /* claude 空态 = 问候 + composer，别无他物。 */
                    <div className="chat-empty-state">
                        <div className="chat-empty-inner">
                            <div className="chat-empty-intro">
                                <BrandMark className="chat-empty-symbol" />
                                <h1>{displayName ? `${greeting}，${displayName}` : `${greeting}，想问什么？`}</h1>
                            </div>
                            <FeaturePromoDialog key={userId ?? 'guest'} items={promoItems} storageKey={`taibu:feature-promo:${userId ?? 'guest'}`} />
                            <ChatComposer {...composerProps} variant="hero" />
                        </div>
                    </div>
                ) : (
                    <>
                        {transcriptMessages.length > 20 ? (
                            <div className="chat-transcript-virtual flex-1 min-h-0 relative bg-background">
                                <VirtualizedChatMessageList
                                    scrollContainerRef={messageScrollContainerRef}
                                    messages={transcriptMessages} isLoading={isLoading || isSendingToList}
                                    onEditMessage={onEditMessage} onRegenerateResponse={onRegenerateResponse}
                                    onSwitchVersion={onSwitchVersion}
                                    onArchiveMessage={activeConversationId ? onArchiveMessage : undefined}
                                    onQuoteMessage={addQuote}
                                    disabled={transcriptLocked}
                                />
                            </div>
                        ) : (
                            <div ref={messageScrollContainerRef} onScroll={onMessageListScroll} aria-label="聊天记录" tabIndex={0} className="chat-transcript-scroll flex-1 min-h-0 overflow-y-auto relative bg-background">
                                <ChatMessageList
                                    messages={transcriptMessages} isLoading={isLoading || isSendingToList} messagesEndRef={messagesEndRef}
                                    onEditMessage={onEditMessage} onRegenerateResponse={onRegenerateResponse}
                                    onSwitchVersion={onSwitchVersion}
                                    onArchiveMessage={activeConversationId ? onArchiveMessage : undefined}
                                    onQuoteMessage={addQuote}
                                    disabled={transcriptLocked}
                                />
                            </div>
                        )}
                        {showJump && <div className="chat-jump-dock"><JumpToLatest onClick={jumpToLatest} /></div>}
                        {waitingQuestion && agent && questionKey ? <>
                            {/* The answer panel takes the input's place; folding it hands the input back for a free reply. */}
                            <div className="chat-question-region">
                                <AgentQuestionDock key={questionKey} question={waitingQuestion.question} questions={waitingQuestion.questions} questionId={waitingQuestion.id}
                                    scopeKey={`${workspaceKey}:${agent.run?.id}`} attachmentState={attachmentState} onAttachmentChange={onAttachmentChange}
                                    onAnswer={async (answer, answers) => { await agent.sendCommand(answer, false, { questionId: waitingQuestion.id, answers }); onAttachmentChange({ ...attachmentState, uploaded: undefined }); }}
                                    onStop={agent.stop} disabled={agent.restoring || agent.syncing}
                                    collapsed={questionLater} onCollapsedChange={later => { setLaterQuestion(later ? questionKey : null); if (later) focusComposer(); }} />
                                {!questionLater && <p className="chat-composer-note">{note}</p>}
                            </div>
                            {questionLater && composer}
                        </> : composer}
                    </>
                )}
                    </div>
                    {showSessionDetails && <SessionDetailsPanel data={latestAgentData} run={workspaceRun} onOpen={openWorkspaceResource} />}
                </div>
                <QuoteSelection containerRef={contentRef} messages={transcriptMessages} onQuote={addQuote} disabled={transcriptLocked} />
            </div>
            {(workspaceOpen || (hasWorkspace && leavingKey === workspaceKey)) && <AgentWorkspacePanel key={workspaceKey} workspaceKey={workspaceKey} parts={agentParts} artifacts={artifacts} attachmentIds={attachmentIds}
                entering={enteringKey === workspaceKey} leaving={!workspaceOpen}
                data={latestAgentData} answers={questionAnswers} userId={userId}
                onClose={closeWorkspace} onChartQuestion={askAboutChart} onShownChange={updateWorkspaceShown} requestedResource={resourceRequest?.scope === workspaceKey ? resourceRequest : undefined}
                citedParagraph={citedParagraph} />}

            {children}
            <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </div></ChatRecordViewContext.Provider></AgentResultContext.Provider>
    );
}

function subscribeToHour(onChange: () => void) {
    const timer = window.setInterval(onChange, 60_000);
    return () => window.clearInterval(timer);
}
/** Time-of-day greeting; the server renders a neutral one so hydration matches. */
function useGreeting() {
    const hour = useSyncExternalStore(subscribeToHour, () => new Date().getHours(), () => -1);
    return hour < 0 ? '你好' : hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
}

/** ⌘/ 键盘快捷键说明：只列已接线的快捷键（见 chat-shortcuts）。 */
function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const titleId = 'chat-shortcuts-title';
    const mod = open ? modifierLabel(navigator.platform) : '⌘';
    return <Dialog bare open={open} onClose={onClose} labelledBy={titleId} className="chat-shortcuts-dialog">
        <div className="chat-dialog-heading">
            <h2 id={titleId}>键盘快捷键</h2>
            <IconButton label="关闭快捷键说明" className="chat-header-icon" expand="none" onClick={onClose}><X size={17} aria-hidden="true" /></IconButton>
        </div>
        <dl className="chat-shortcuts-list">
            {CHAT_SHORTCUTS.map(item => <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.keys(mod).map(key => <kbd key={key}>{key}</kbd>)}</dd>
            </div>)}
        </dl>
    </Dialog>;
}
