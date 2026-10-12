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
import { ChevronRight, Lock, PanelRight } from 'lucide-react';
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
import { AgentStatus } from './agent/AgentStatus';
import { AgentHeaderStatus } from './agent/AgentHeaderStatus';
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel';
import { AgentResultContext, isSameWorkspaceShown, type AgentWorkspaceShown } from './agent/AgentResultContext';
import { buildAgentWorkspace, getAgentQuestionAnswers, getAgentWorkspaceAutoOpenEvent } from '@/lib/agent/workspace';
import { AgentQuestionDock } from './agent/AgentQuestionDock';
import { PromptTemplateMenu } from './composer/ComposerDomainControls';
import type { ComposerModeControl, ComposerWebControl } from './composer/ComposerToolbar';
import { applyPromptTemplate } from '@/lib/agent/prompt-templates';
import { collaborationProgress } from '@/lib/agent/parallel-results';
import { composerNote } from '@/lib/chat/composer-copy';
import { collectAgentArtifacts, getAgentCitedParagraph, getAgentTaskDuration } from './agent/presentation';
import { isAgentRunTerminal, type AgentPart } from '@/lib/agent/types';
import { useTranscriptScroll } from '@/lib/chat/use-transcript-scroll';
import { orderAgentMessagesForDisplay } from '@/lib/agent/browser-client';
import { JumpToLatest } from './JumpToLatest';
import { ConversationMinimap } from './ConversationMinimap';
import { useReadingPreferences } from '@/lib/chat/use-reading-preferences';
import type { CSSProperties } from 'react';
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
    onSend: () => Promise<void>;
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
    membershipType: MembershipType;
    attachmentState: AttachmentState;
    onAttachmentChange: (state: AttachmentState) => void;
    mentions: Mention[];
    onMentionsChange: (mentions: Mention[]) => void;
    promptKnowledgeBases: ChatBootstrapKnowledgeBase[];
    dreamContext?: { baziChartName?: string; dailyFortune?: string };
    dreamContextLoading: boolean;
    knowledgeBaseEnabled: boolean;
    aiPersonalizationEnabled: boolean;

    // Credit lock
    isCreditLocked: boolean;
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
        knowledgeBaseEnabled, aiPersonalizationEnabled,
        isCreditLocked,
        onAuthRequired,
        children,
    } = props;

    const contentRef = useRef<HTMLDivElement>(null);
    const greeting = useGreeting();
    const { preferences, update: updatePreferences } = useReadingPreferences(props.userId);
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
    const { showJump, jumpToLatest } = useTranscriptScroll({ scrollRef: messageScrollContainerRef, followRef: props.shouldAutoScrollRef, conversationKey: workspaceKey, messages: transcriptMessages, enabled: !conversationLoading && transcriptMessages.length > 0, virtualized: transcriptMessages.length > 20 });
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
    const waitingQuestion = userId && props.agent?.run?.conversationId === activeConversationId && props.agent.run.status === 'awaiting_input'
        ? [...props.agent.run.message.agent?.parts ?? []].reverse().find((part): part is Extract<AgentPart, { type: 'question' }> => part.type === 'question') : undefined;
    const hasWorkspace = isAgentMode || Boolean(latestAgentData);
    const workspaceOpen = hasWorkspace && openWorkspaceKey === workspaceKey;
    const resultWorkspace = useMemo(() => ({ openResource, shown: workspaceOpen ? workspaceShown : null }), [openResource, workspaceOpen, workspaceShown]);
    // The header counts what the workspace can open: readings, calculations, evidence and other materials.
    const resourceCount = useMemo(() => buildAgentWorkspace({ parts: agentParts, artifacts, attachmentIds }).resources.length, [agentParts, artifacts, attachmentIds]);
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
    const askAboutChart = (text: string) => {
        onInputChange(inputValue.trim() ? inputValue + '\n\n' + text : text);
        if (!window.matchMedia('(min-width: 1280px)').matches) closeWorkspace();
        focusComposer();
    };
    const templatesRef = useRef<HTMLButtonElement>(null);
    const [templatesOpen, setTemplatesOpen] = useState(false);
    // “稍后回答” folds the dock for this question only; a new question opens it again.
    const questionKey = waitingQuestion && props.agent?.run ? `${workspaceKey}:${props.agent.run.id}:${waitingQuestion.id}` : null;
    const [laterQuestion, setLaterQuestion] = useState<string | null>(null);
    const questionLater = questionKey !== null && laterQuestion === questionKey;
    const collaborators = currentRun?.configuration?.collaborators.length ?? 0;
    const collaboration = useMemo(() => currentRun?.status === 'running' ? collaborationProgress(currentRun.message.agent?.parts ?? [], currentRun.configuration?.collaborators.length) ?? undefined : undefined, [currentRun]);
    const runDuration = useMemo(() => currentRun && isAgentRunTerminal(currentRun.status) ? getAgentTaskDuration(currentRun.createdAt, currentRun.message.agent) : null, [currentRun]);
    const agent = props.agent;
    const modeControl: ComposerModeControl | undefined = agent ? {
        mode: agent.mode,
        onChange: agent.setMode,
        agentDisabled: !agent.capabilities.ready || agent.active,
        plainDisabled: agent.active,
    } : undefined;
    const webAllowed = !!agent?.capabilities.webAvailable && membershipType !== 'free';
    const webControl: ComposerWebControl | undefined = agent && isAgentMode ? {
        enabled: agent.webEnabled && webAllowed,
        disabled: !webAllowed,
        label: agent.active ? '下次联网' : '按需联网',
        title: !agent.capabilities.webAvailable ? '当前环境未配置联网搜索' : membershipType === 'free' ? '联网搜索需要 Plus 会员' : agent.active ? '下个独立任务使用此配置' : 'Agent 会在需要时搜索网络',
        onToggle: () => agent.setWebEnabled(!agent.webEnabled),
    } : undefined;
    const note = composerNote({
        agentMode: isAgentMode,
        agentUnavailable: !!userId && !!agent && !agent.capabilities.ready,
        reconnecting: agent?.reconnecting,
        awaiting: currentRun?.status === 'awaiting_input',
        running: !!agent?.active && !!currentRun,
        collaborators,
    });
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
        agentMode: isAgentMode,
        agentRuntime: (props.agent?.run?.conversationId === activeConversationId ? props.agent.run.message.agent?.runtime : undefined) ?? latestAgentData?.runtime,
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
        contextMessages: messages,
        dreamContext, dreamContextLoading,
        knowledgeBaseEnabled,
        modeControl, webControl,
    };
    const composer = <ChatComposer {...composerProps} continuing note={note} header={composerHeader}
        queue={currentRun && <AgentQueue key={`${workspaceKey}:${currentRun.id}`} run={currentRun} restoreDraft={message => void restoreDraft(message)} />} />;
    const toggleWorkspace = () => {
        if (workspaceOpen) { closeWorkspace(); return; }
        setOpenWorkspaceKey(workspaceKey);
        try { sessionStorage.setItem(`taibu.workspace-open:${workspaceKey}`, '1'); sessionStorage.removeItem('taibu.workspace-dismissed:' + workspaceKey); } catch { /* optional */ }
    };
    // A new conversation opens on the greeting alone; saved conversations keep their header.
    const emptyState = !conversationLoading && messages.length === 0;
    const showHeader = !emptyState || !!activeConversationId || !!conversationError;

    return (
        <AgentResultContext.Provider value={resultWorkspace}><div className="chat-workspace flex bg-background" style={{ '--chat-column': `${preferences.width}px` } as CSSProperties}>
            {/* 移动端对话抽屉 */}
            <MobileChatDrawer />

            {/* data-agent-ready turns true once a restored task has finished syncing. */}
            <div ref={contentRef} className="chat-main flex-1 flex flex-col min-w-0 min-h-0 relative bg-background"
                data-agent-ready={props.agent ? !props.agent.restoring && !props.agent.syncing : undefined}>
                {showHeader && <ChatHeader
                    title={title}
                    conversationId={activeConversationId}
                    badge={isAgentMode ? collaborators ? `Agent · 协作 ${collaborators} 人` : 'Agent' : undefined}
                    status={currentRun ? <AgentHeaderStatus status={currentRun.status} createdAt={currentRun.createdAt} reconnecting={props.agent?.reconnecting} collaboration={collaboration} duration={runDuration} />
                        : isAgentMode && latestAgentData ? <AgentStatus status={latestAgentData.status} /> : null}
                    showExport={!isAgentMode}
                    workspaceButton={hasWorkspace ? <button type="button" ref={workspaceButtonRef} className="chat-workspace-toggle" aria-label="任务工作区" aria-expanded={workspaceOpen} aria-controls="agent-workspace-panel" onClick={toggleWorkspace}>
                        <PanelRight size={16} strokeWidth={1.8} aria-hidden="true" /><span>工作区</span>{resourceCount > 0 && <span className="chat-result-count">{resourceCount}</span>}
                    </button> : undefined}
                    readingWidth={preferences.width}
                    onReadingWidthChange={width => updatePreferences({ width })}
                    membershipType={membershipType}
                    knowledgeBaseEnabled={knowledgeBaseEnabled}
                    aiPersonalizationEnabled={aiPersonalizationEnabled}
                />}
                {activeConversationId && <ConversationExportDialog conversationId={activeConversationId} />}

                {conversationError ? (
                    <div className="chat-load-error" role="alert">
                        <span>{conversationError}</span>
                        {onRetryConversationLoad ? <button type="button" onClick={() => void onRetryConversationLoad()}>重试</button> : null}
                    </div>
                ) : null}

                {conversationLoading ? (
                    <SoundWaveLoader variant="block" text="" />
                ) : emptyState ? (
                    <div className="chat-empty-state">
                        <div className="chat-empty-inner">
                            <div className="chat-empty-intro">
                                <span className="chat-empty-symbol" aria-hidden="true">卜</span>
                                <h1>{greeting}，想问些什么？</h1>
                                <p>{isAgentMode ? '描述你关心的事，太卜会排盘、查阅资料，并在右侧工作区展示每一步。' : '聊聊命盘、运势，或最近让你困惑的事。'}</p>
                            </div>
                            <ChatComposer {...composerProps} variant="hero" header={creditStrip} />
                            {isAgentMode && <section className="chat-suggestions" aria-labelledby="chat-suggestions-title">
                                <div className="chat-suggestions-heading">
                                    <h2 id="chat-suggestions-title">可以这样开始</h2>
                                    {userId && <button ref={templatesRef} type="button" aria-haspopup="menu" aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(open => !open)}>
                                        问法模板<ChevronRight size={14} aria-hidden="true" />
                                    </button>}
                                </div>
                                <div className="chat-suggestion-grid">{AGENT_SUGGESTIONS.map(item => <button key={item.title} type="button" disabled={disabled} onClick={() => suggest(item.prompt)}>
                                    <strong>{item.title}</strong><span>{item.description}</span>
                                </button>)}</div>
                                <PromptTemplateMenu open={templatesOpen} anchorRef={templatesRef} onClose={() => setTemplatesOpen(false)} userId={userId} side="bottom" align="end"
                                    onPick={template => suggest(applyPromptTemplate(template, inputValue))} />
                            </section>}
                            {isAgentMode && <p className="chat-empty-note">任务在后台执行，关闭页面不会中断，完成后会提醒你 · 每个任务计 1 次积分</p>}
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
                                    disabled={isCreditLocked || props.agent?.restoring || props.agent?.syncing}
                                />
                            </div>
                        ) : (
                            <div ref={messageScrollContainerRef} onScroll={onMessageListScroll} aria-label="聊天记录" tabIndex={0} className="chat-transcript-scroll flex-1 min-h-0 overflow-y-auto relative bg-background">
                                <ChatMessageList
                                    messages={transcriptMessages} isLoading={isLoading || isSendingToList} messagesEndRef={messagesEndRef}
                                    onEditMessage={onEditMessage} onRegenerateResponse={onRegenerateResponse}
                                    onSwitchVersion={onSwitchVersion}
                                    onArchiveMessage={activeConversationId ? onArchiveMessage : undefined}
                                    disabled={isCreditLocked || props.agent?.restoring || props.agent?.syncing}
                                />
                            </div>
                        )}
                        {showJump && <div className="chat-jump-dock"><JumpToLatest onClick={jumpToLatest} /></div>}
                        <ConversationMinimap messages={transcriptMessages} conversationKey={workspaceKey} />
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
            {workspaceOpen && <AgentWorkspacePanel key={workspaceKey} workspaceKey={workspaceKey} parts={agentParts} artifacts={artifacts} attachmentIds={attachmentIds}
                data={latestAgentData} run={workspaceRun} answers={questionAnswers} userId={userId} conversationId={activeConversationId}
                onClose={closeWorkspace} onChartQuestion={askAboutChart} onShownChange={updateWorkspaceShown} requestedResource={resourceRequest?.scope === workspaceKey ? resourceRequest : undefined}
                citedParagraph={citedParagraph} />}

            {children}
            <AnalysisMethodPicker onSelect={text => onInputChange(inputValue.trim() ? `${inputValue}\n${text}` : text)} />
        </div></AgentResultContext.Provider>
    );
}

const AGENT_SUGGESTIONS = [
    { title: '了解我的命盘', description: '读取已存命盘，分析性格与优势；资料不足会先问你', prompt: '请先查看我保存的命盘，帮我分析性格与优势。资料不足时请向我询问。' },
    { title: '对比两份命盘', description: '合盘看相处方式与互补，缺对方信息时会询问', prompt: '请对比我保存的两份命盘，分析相处中的特点。信息不足时先询问我。' },
    { title: '看看明年的工作方向', description: '排大运与流年，判断变动时机', prompt: '请结合我的命盘，排大运与流年，分析明年的工作方向和变动时机。需要出生信息时先询问我。' },
    { title: '挑一个好日子', description: '结合黄历与你的命盘，选日期和时辰', prompt: '请结合黄历和我的命盘，帮我挑一个适合签约的日子和时辰。需要信息时先询问我。' },
] as const;

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

/** Platform credits ran out: hosted models lock, a custom model still works. */
function CreditStrip() {
    return <div className="chat-credit-strip" role="status">
        <Lock size={15} aria-hidden="true" /><span>积分已用完</span>
        <Link href={getSettingsCenterRouteTarget('upgrade')} onClick={event => { event.preventDefault(); openSettingsCenter('upgrade'); }}>获取积分</Link>
    </div>;
}
