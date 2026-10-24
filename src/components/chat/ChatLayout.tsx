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
import { scrollToMessageId } from '@/lib/chat/message-navigation';
import { requestBrowserJson } from '@/lib/browser-api';
import { useToast } from '@/components/ui/Toast';
import { ConversationExportDialog } from './ConversationExportDialog';
import { AgentQueue } from './agent/AgentQueue';
import { AnalysisMethodPicker } from './agent/AnalysisMethodPicker';
import Link from 'next/link';
import { Lock, PanelRight, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { ChatMessage, AttachmentState, Mention, PrivateAttachment } from '@/types';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { VirtualizedChatMessageList } from '@/components/chat/VirtualizedChatMessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import type { ChatBootstrapKnowledgeBase } from '@/lib/chat/bootstrap';
import type { MembershipType } from '@/lib/user/membership';
import type { ChatMode } from '@/lib/chat/use-chat-state';
import { getSettingsCenterRouteTarget, openSettingsCenter } from '@/lib/settings-center';
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel';
import { SessionDetailsPanel } from './agent/SessionDetailsPanel';
import { AgentResultContext, isSameWorkspaceShown, type AgentWorkspaceShown } from './agent/AgentResultContext';
import { getAgentQuestionAnswers, getAgentWorkspaceAutoOpenEvent } from '@/lib/agent/workspace';
import { chartQuestion, type ChartAskContext } from '@/lib/agent/chart-interaction';
import { AgentQuestionDock } from './agent/AgentQuestionDock';
import { useAgentRoundFolds } from './agent/AgentRoundFold';
import type { ComposerWebControl } from './composer/ComposerToolbar';
import { publishChatModeControl, clearChatModeControl, type ChatModeControl } from '@/lib/chat/mode-control-store';
import { composerNote, isRunningComposerNote, type ComposerNoteState } from '@/lib/chat/composer-copy';
import { collectAgentArtifacts, getAgentCitedParagraph } from './agent/presentation';
import type { AgentPart } from '@/lib/agent/types';
import { useTranscriptScroll } from '@/lib/chat/use-transcript-scroll';
import { orderAgentMessagesForDisplay } from '@/lib/agent/browser-client';
import { JumpToLatest } from './JumpToLatest';
import { useReadingPreferences } from '@/lib/chat/use-reading-preferences';
import { useConversationList } from '@/lib/chat/ConversationListContext';
import { ChatRecordViewContext, useChatRecordView } from '@/lib/chat/chat-record-view';
import { setChatWorkspaceOpen } from '@/lib/chat/chat-sidebar';
import { refreshAgentActivity } from '@/lib/agent/use-agent-activity';
import type { CSSProperties } from 'react';
import { CHAT_SHORTCUTS, isShortcutSheetKey, modifierLabel, shouldStopOnEscape } from '@/lib/chat/chat-shortcuts';
import { dispatchComposerFiles, dragHasFiles } from '@/lib/chat/composer-files';
import './chat-workspace.css';
import type { ModelSettingsProps } from '@/lib/chat/model-settings';

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
    onSend: (context?: string) => Promise<void>;
    onStop: () => void;
    onRetryConversationLoad?: () => Promise<void>;

    // Composer props
    inputValue: string;
    onInputChange: (value: string) => void;
    disabled: boolean;
    chatMode: ChatMode;
    onChatModeChange: (mode: ChatMode) => void;
    selectedModel: string;
    onModelChange: (model: string) => void;
    reasoningEnabled: boolean;
    onReasoningChange: (enabled: boolean) => void;
    customProviderActive: boolean;
    customProviderLabel: string | null;
    userId: string | null;
    /** Profile nickname for the empty-state greeting. */
    displayName?: string | null;
    membershipType: MembershipType;
    attachmentState: AttachmentState;
    onAttachmentChange: (state: AttachmentState) => void;
    mentions: Mention[];
    onMentionsChange: (mentions: Mention[]) => void;
    promptKnowledgeBases: ChatBootstrapKnowledgeBase[];
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
    dreamContextLoading: boolean;
    knowledgeBaseEnabled: boolean;

    // Credit lock
    isCreditLocked: boolean;
    /** Remaining platform credits for the composer usage ring. */
    credits?: number | null;
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
        onSend, onStop, onRetryConversationLoad,
        inputValue, onInputChange, disabled,
        chatMode, onChatModeChange,
        selectedModel, onModelChange, reasoningEnabled, onReasoningChange,
        customProviderActive, customProviderLabel,
        userId, membershipType, attachmentState, onAttachmentChange,
        mentions, onMentionsChange, promptKnowledgeBases,
        dreamContext, dreamContextLoading,
        knowledgeBaseEnabled,
        isCreditLocked,
        credits,
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
    const [resourceRequest, setResourceRequest] = useState<{ scope: string; id: string; version: number } | null>(null);
    const autoWorkspace = useRef<{ scope: string; action: string | null }>({ scope: '', action: null });
    const openResource = useCallback((id: string) => {
        setResourceRequest(previous => ({ scope: workspaceKey, id, version: (previous?.version ?? 0) + 1 }));
        setOpenWorkspaceKey(workspaceKey);
        try { sessionStorage.setItem(`taibu.workspace-open:${workspaceKey}`, '1'); } catch { /* optional */ }
    }, [workspaceKey]);
    const [workspaceShown, setWorkspaceShown] = useState<AgentWorkspaceShown | null>(null);
    const updateWorkspaceShown = useCallback((next: AgentWorkspaceShown | null) => setWorkspaceShown(previous => isSameWorkspaceShown(previous, next) ? previous : next), []);
    useEffect(() => {
        let current = true;
        queueMicrotask(() => {
            if (!current) return;
            try { setOpenWorkspaceKey(sessionStorage.getItem(`taibu.workspace-open:${workspaceKey}`) === '1' ? workspaceKey : null); } catch { setOpenWorkspaceKey(null); }
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
    // Earlier Agent rounds fold to 上一轮 bars; a jump to one of their messages unfolds it first.
    // 记录视图只影响步骤明细的展开，不改变轮次折叠。
    const { rounds, reveal: revealMessage } = useAgentRoundFolds(transcriptMessages, workspaceKey);
    const { showJump, jumpToLatest } = useTranscriptScroll({ scrollRef: messageScrollContainerRef, followRef: props.shouldAutoScrollRef, conversationKey: workspaceKey, messages: transcriptMessages, enabled: !conversationLoading && transcriptMessages.length > 0, virtualized: transcriptMessages.length > 20, reveal: revealMessage });
    // Esc 停止生成（菜单、弹窗、行内编辑先消费 Esc）；⌘/ 打开快捷键说明。
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isShortcutSheetKey(event)) { event.preventDefault(); setShortcutsOpen(open => !open); return; }
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
    // 对话 / Agent 的会话不互通：打开另一类会话（含直接访问链接）时退回新建页，
    // 避免普通对话里出现 Agent 的标题、工具步骤或工作区数据。
    const modeSettled = props.agent?.modeSettled !== false;
    useEffect(() => {
        // Before the mode is known it reads 对话, which would turn away every Agent conversation opened by link.
        if (!activeConversationId || !modeSettled) return;
        const current = conversations.find(conversation => conversation.id === activeConversationId);
        if (!current || current.hasAgentRun === undefined) return;
        // 新建的 Agent 会话在首轮运行前 hasAgentRun 仍为 false，用消息形态区分，避免误跳。
        const kind = current.hasAgentRun === true ? 'agent'
            : messages.length > 0 && messages.every(message => !message.agent) ? 'plain'
            : undefined;
        if (kind && (kind === 'agent') !== isAgentMode) router.push('/chat');
    }, [isAgentMode, modeSettled, activeConversationId, conversations, messages, router]);
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
        setOpenWorkspaceKey(null);
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
        if (!window.matchMedia('(min-width: 1280px)').matches) return;
        try { if (sessionStorage.getItem('taibu.workspace-dismissed:' + workspaceKey) === currentRun.id) return; } catch { /* optional */ }
        queueMicrotask(() => {
            if (autoWorkspace.current.scope !== workspaceKey) return;
            setOpenWorkspaceKey(workspaceKey);
            // 直接落到产生这次自动打开的资源（命盘 / 协作 / 问题），而不是停在概览。
            setResourceRequest(previous => ({ scope: workspaceKey, id: `tool:${action}`, version: (previous?.version ?? 0) + 1 }));
            try { sessionStorage.setItem('taibu.workspace-open:' + workspaceKey, '1'); } catch { /* optional */ }
        });
    }, [autoOpenEvent, currentRun, props.agent?.restoring, workspaceKey]);
    const title = props.conversationTitle || messages.find(message => message.role === 'user')?.content.slice(0, 60) || (isAgentMode ? '新任务' : '新对话');
    const focusComposer = (scope = workspaceKey) => requestAnimationFrame(() => {
        if (draftScope.current === scope) contentRef.current?.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus();
    });
    const suggest = (text: string) => {
        onInputChange(text);
        focusComposer();
    };
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
        if (!window.matchMedia('(min-width: 1280px)').matches) closeWorkspace();
        focusComposer();
    };
    const sendWithChartAsk = async () => {
        const context = activeChartAsks.length ? activeChartAsks.map(ask => chartQuestion(ask.reference, ask.targets)).join('\n\n') : undefined;
        setChartAsks([]);
        await onSend(context);
    };
    // “稍后回答” folds the dock for this question only; a new question opens it again.
    const questionKey = waitingQuestion && props.agent?.run ? `${workspaceKey}:${props.agent.run.id}:${waitingQuestion.id}` : null;
    const [laterQuestion, setLaterQuestion] = useState<string | null>(null);
    const questionLater = questionKey !== null && laterQuestion === questionKey;
    const collaborators = currentRun?.configuration?.collaborators.length ?? 0;
    const agent = props.agent;
    const modeControl: ChatModeControl | null = agent ? {
        mode: agent.mode,
        onChange: agent.setMode,
        agentDisabled: !agent.capabilities.ready || agent.active,
        plainDisabled: agent.active,
    } : null;
    // 侧栏品牌行与移动抽屉通过 store 共享这一个控件（全页恰好一个「对话方式」单选组）。
    useEffect(() => { publishChatModeControl(modeControl); });
    useEffect(() => clearChatModeControl, []);
    const webAllowed = !!agent?.capabilities.webAvailable && membershipType !== 'free';
    const webControl: ComposerWebControl | undefined = agent && isAgentMode ? {
        enabled: agent.webEnabled && webAllowed,
        disabled: !webAllowed,
        label: agent.active ? '下次联网' : '按需联网',
        title: !agent.capabilities.webAvailable ? '当前环境未配置联网搜索' : membershipType === 'free' ? '联网搜索需要 Plus 会员' : agent.active ? '下个独立任务使用此配置' : 'Agent 会在需要时搜索网络',
        onToggle: () => agent.setWebEnabled(!agent.webEnabled),
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
    const creditStrip = isCreditLocked ? <CreditStrip /> : undefined;
    // Suggested next questions belong to a finished answer that is still the latest turn.
    const lastAgent = transcriptMessages.at(-1)?.agent;
    const followUps = lastAgent?.status === 'completed' && lastAgent.followUps?.length && !inputValue.trim() && !agent?.active && !isLoading && !isSendingToList ? lastAgent.followUps : null;
    const composerHeader = creditStrip || followUps ? <>{creditStrip}{followUps && <FollowUps questions={followUps} disabled={disabled} onPick={suggest} />}</> : undefined;
    const citedParagraph = useCallback((cite: number) => getAgentCitedParagraph(messages, cite), [messages]);
    const composerProps = {
        draftKey: workspaceKey,
        reasoningEffort: props.reasoningEffort, onReasoningEffortChange: props.onReasoningEffortChange,
        collaborators: props.collaborators, onCollaboratorsChange: props.onCollaboratorsChange,
        codeMode: agent?.codeMode, onCodeModeChange: agent?.setCodeMode,
        planMode: agent?.planMode, onPlanModeChange: agent?.setPlanMode,
        agentMode: isAgentMode,
        credits,
        awaitingInput: props.agent?.run?.status === 'awaiting_input',
        allowDuringRun: props.agent?.active,
        onQueueMessage: props.onQueueMessage,
        inputValue, isLoading, isSendingToList,
        onInputChange, onSend, onStop, onAuthRequired, disabled,
        chatMode, onChatModeChange,
        selectedModel, onModelChange, reasoningEnabled, onReasoningChange,
        customProviderActive, customProviderLabel,
        userId, membershipType, attachmentState, onAttachmentChange,
        mentions, onMentionsChange, promptKnowledgeBases,
        chartAsks: chartAskChips,
        dreamContext, dreamContextLoading,
        knowledgeBaseEnabled,
        webControl,
        plainWebAvailable: !!agent?.capabilities.plainWebAvailable,
    };
    const composer = <ChatComposer {...composerProps} onSend={sendWithChartAsk} continuing note={note} noteOptional={isRunningComposerNote(noteState)} header={composerHeader}
        queue={currentRun && <AgentQueue key={`${workspaceKey}:${currentRun.id}`} run={currentRun} restoreDraft={message => void restoreDraft(message)} />} />;
    const toggleWorkspace = () => {
        if (workspaceOpen) { closeWorkspace(); return; }
        setOpenWorkspaceKey(workspaceKey);
        try { sessionStorage.setItem(`taibu.workspace-open:${workspaceKey}`, '1'); sessionStorage.removeItem('taibu.workspace-dismissed:' + workspaceKey); } catch { /* optional */ }
    };
    // 会话栏的成果行：打开工作区并定位到对应资源。
    const openWorkspaceResource = (id: string) => { setOpenWorkspaceKey(workspaceKey); openResource(id); };
    // A new conversation opens on the greeting alone; saved conversations keep their header.
    const emptyState = !conversationLoading && messages.length === 0;
    const showHeader = !emptyState || !!activeConversationId || !!conversationError;
    // 右侧会话栏常驻（claude /code 无开关），仅在打开工作区时让位。
    const showSessionDetails = isAgentMode && Boolean(latestAgentData) && showHeader && !workspaceOpen;
    // 生成中锁住编辑、重新生成、版本切换与分叉：它们都会改写正在写入的分支。
    const transcriptLocked = isCreditLocked || isLoading || !!props.agent?.active || !!props.agent?.restoring || !!props.agent?.syncing;

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
                    workspaceButton={hasWorkspace && showHeader ? <button type="button" ref={workspaceButtonRef} className="chat-workspace-toggle" aria-label="任务工作区" aria-expanded={workspaceOpen} aria-controls="agent-workspace-panel" onClick={toggleWorkspace}>
                        <PanelRight size={17} strokeWidth={1.8} aria-hidden="true" />
                    </button> : undefined}
                    membershipType={membershipType}
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
                        {onRetryConversationLoad ? <button type="button" onClick={() => void onRetryConversationLoad()}>重试</button> : null}
                    </div>
                ) : null}

                {conversationLoading ? (
                    <SoundWaveLoader variant="block" text="" />
                ) : emptyState ? (
                    /* claude 空态 = 问候 + composer，别无他物；建议/模板/积分提示一律不放。 */
                    <div className="chat-empty-state">
                        <div className="chat-empty-inner">
                            <div className="chat-empty-intro">
                                <span className="chat-empty-symbol" aria-hidden="true">卜</span>
                                <h1>{displayName ? `${greeting}，${displayName}` : `${greeting}，想问什么？`}</h1>
                            </div>
                            <ChatComposer {...composerProps} variant="hero" header={creditStrip} />
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
                                    disabled={transcriptLocked}
                                    rounds={rounds}
                                />
                            </div>
                        ) : (
                            <div ref={messageScrollContainerRef} onScroll={onMessageListScroll} aria-label="聊天记录" tabIndex={0} className="chat-transcript-scroll flex-1 min-h-0 overflow-y-auto relative bg-background">
                                <ChatMessageList
                                    messages={transcriptMessages} isLoading={isLoading || isSendingToList} messagesEndRef={messagesEndRef}
                                    onEditMessage={onEditMessage} onRegenerateResponse={onRegenerateResponse}
                                    onSwitchVersion={onSwitchVersion}
                                    onArchiveMessage={activeConversationId ? onArchiveMessage : undefined}
                                    disabled={transcriptLocked}
                                    rounds={rounds}
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
            </div>
            {workspaceOpen && <AgentWorkspacePanel key={workspaceKey} workspaceKey={workspaceKey} parts={agentParts} artifacts={artifacts} attachmentIds={attachmentIds}
                data={latestAgentData} answers={questionAnswers} userId={userId}
                onClose={closeWorkspace} onChartQuestion={askAboutChart} onShownChange={updateWorkspaceShown} requestedResource={resourceRequest?.scope === workspaceKey ? resourceRequest : undefined}
                citedParagraph={citedParagraph} />}

            {children}
            <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
            <AnalysisMethodPicker onSelect={text => onInputChange(inputValue.trim() ? `${inputValue}\n${text}` : text)} />
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

/** 继续追问: questions the answer suggested asking next; picking one fills the input to edit or send. */
function FollowUps({ questions, disabled, onPick }: { questions: readonly string[]; disabled: boolean; onPick: (text: string) => void }) {
    return <div className="chat-followups" role="group" aria-label="继续追问">
        {questions.map(question => <button key={question} type="button" title={question} disabled={disabled} onClick={() => onPick(question)}><span>{question}</span></button>)}
    </div>;
}

/** ⌘/ 键盘快捷键说明：只列已接线的快捷键（见 chat-shortcuts）。 */
function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const titleId = 'chat-shortcuts-title';
    const mod = open ? modifierLabel(navigator.platform) : '⌘';
    return <Modal open={open} onClose={onClose} labelledBy={titleId} className="chat-shortcuts-dialog">
        <div className="chat-dialog-heading">
            <h2 id={titleId}>键盘快捷键</h2>
            <button type="button" className="chat-header-icon" aria-label="关闭快捷键说明" onClick={onClose}><X size={17} /></button>
        </div>
        <dl className="chat-shortcuts-list">
            {CHAT_SHORTCUTS.map(item => <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.keys(mod).map(key => <kbd key={key}>{key}</kbd>)}</dd>
            </div>)}
        </dl>
    </Modal>;
}

/** Platform credits ran out: hosted models lock, a custom model still works. */
function CreditStrip() {
    return <div className="chat-credit-strip" role="status">
        <Lock size={15} aria-hidden="true" /><span>积分已用完</span>
        <Link href={getSettingsCenterRouteTarget('upgrade')} onClick={event => { event.preventDefault(); openSettingsCenter('upgrade'); }}>获取积分</Link>
    </div>;
}
