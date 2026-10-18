/**
 * 消息发送、流式响应、中止、重试逻辑 hook
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ChatMessage, ConversationListItem, DifyContext, Mention, AIMessageMetadata, DreamInterpretationInfo } from '@/types';
import { ANONYMOUS_DISPLAY_NAME } from '@/types';
import { createConversation, deleteConversation, DEFAULT_CONVERSATION_TITLE } from '@/lib/chat/conversation';
import { buildDraftTitle } from '@/lib/chat/draft-title';
import { isNearBottom } from '@/lib/chat/chat-scroll';
import { chatStreamManager } from '@/lib/chat/chat-stream-manager';
import { resolveClientModelName } from '@/lib/ai/model-name-cache';
import {
    BrowserDirectProviderError,
    buildBrowserDirectMessages,
    streamBrowserDirectProvider,
} from '@/lib/ai/browser-direct-provider';
import {
    getCustomProvider,
    getCustomProviderDisplayName,
} from '@/lib/chat/custom-provider';
import type { ChatStateReturn } from '@/lib/chat/use-chat-state';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useUserCharts } from '@/lib/hooks/useUserCharts';
import { selectPrimarySavedBaziChart } from '@/lib/user/charts-client';
import { filterMentionsByFeature, getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';
import { readLocalVisualizationSettings } from '@/lib/visualization/settings';
import type { ChatStreamTaskRunner } from '@/lib/chat/chat-stream-manager';
import { useAgentChat } from '@/lib/agent/use-agent-chat';

function shouldShowCheckKeyAction(message?: string): boolean {
    if (!message) return false;
    return message.includes('API Key') || message.includes('认证失败');
}

function createCustomProviderChatRunner(customProvider: NonNullable<ReturnType<typeof getCustomProvider>>): ChatStreamTaskRunner {
    return async ({
        requestHeaders,
        requestBody,
        signal,
        fetcher,
        appendContentDelta,
        appendReasoningDelta,
        setMetadata,
    }) => {
        const prepareResponse = await fetcher.call(globalThis, '/api/chat/direct/prepare', {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal,
        });

        if (!prepareResponse.ok) {
            let errorMessage = '生成直连上下文失败，请稍后重试';
            try {
                const data = await prepareResponse.json() as { error?: string };
                if (typeof data.error === 'string' && data.error.trim()) {
                    errorMessage = data.error;
                }
            } catch {
                // ignore
            }
            throw new BrowserDirectProviderError(errorMessage, {
                status: prepareResponse.status,
                code: 'PREPARE_FAILED',
            });
        }

        const prepared = await prepareResponse.json() as {
            systemPrompt: string;
            sanitizedMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
            metadata?: AIMessageMetadata;
        };

        if (prepared.metadata) {
            setMetadata(prepared.metadata);
        }

        await streamBrowserDirectProvider({
            provider: customProvider,
            messages: buildBrowserDirectMessages(prepared.systemPrompt, prepared.sanitizedMessages),
            signal,
            onContentDelta: appendContentDelta,
            onReasoningDelta: appendReasoningDelta,
        });
    };
}

interface UseChatMessagingParams {
    state: ChatStateReturn;
    userId: string | null;
    user: { user_metadata?: { nickname?: string } } | null;
    membership: { type: string; isActive: boolean } | null;
    credits: number | null;
    refreshViewerState: () => Promise<unknown>;
    markViewerCreditsExhausted: () => void;
    showToast: ReturnType<typeof import('@/components/ui/Toast').useToast>['showToast'];
    router: ReturnType<typeof import('next/navigation').useRouter>;
    searchParams: ReturnType<typeof import('next/navigation').useSearchParams>;
}

export function useChatMessaging({
    state,
    userId,
    user,
    membership: _membership, // eslint-disable-line @typescript-eslint/no-unused-vars -- reserved for future credit checks
    credits: _credits, // eslint-disable-line @typescript-eslint/no-unused-vars -- reserved for future credit checks
    refreshViewerState,
    markViewerCreditsExhausted,
    showToast,
    router,
    searchParams,
}: UseChatMessagingParams) {
    const agent = useAgentChat(state, userId, refreshViewerState);
    const {
        messages, setMessages,
        inputValue,
        isSendingToList, setIsSendingToList,
        activeConversationId, setActiveConversationId,
        activeConversationIdRef, conversationValidatedRef,
        hasLoadedConversationsRef,
        messageScrollContainerRef, shouldAutoScrollRef,
        chatMode,
        selectedModel, reasoningEnabled,
        customProviderConfig,
        attachmentState, setAttachmentState,
        mentions,
        dreamContextLoading,
        setDreamContext, setDreamContextLoading,
        setStreamingConversationIds,
        isLoading,
        setConversations,
        setHasLoadedConversations,
        setPendingSidebarTitle,
        setKbModalOpen,
        setKbTargetMessage,
        setShowCreditsModal,
        refreshConversationList,
        saveMessages,
        cacheConversationMessages,
        removeConversationDetail,
    } = state;
    const isDreamMode = chatMode === 'dream';
    const chartsQuery = useUserCharts(userId, { enabled: isDreamMode });
    const primaryChartName = useMemo(() => selectPrimarySavedBaziChart(chartsQuery.data)?.name, [chartsQuery.data]);
    const isMangpaiMode = chatMode === 'mangpai';
    const { isFeatureEnabled, isLoading: featureToggleLoading } = useFeatureToggles({ enabled: !!userId });
    const knowledgeBaseEnabled = !featureToggleLoading && isFeatureEnabled('knowledge-base');
    const enabledDataSourceTypes = useMemo(
        () => (featureToggleLoading ? [] : getEnabledDataSourceTypes(isFeatureEnabled)),
        [featureToggleLoading, isFeatureEnabled]
    );

    const refreshViewerStateTimerRef = useRef<NodeJS.Timeout | null>(null);
    const debouncedRefreshViewerState = useCallback(() => {
        if (refreshViewerStateTimerRef.current) {
            clearTimeout(refreshViewerStateTimerRef.current);
        }
        refreshViewerStateTimerRef.current = setTimeout(() => {
            void refreshViewerState();
            refreshViewerStateTimerRef.current = null;
        }, 300);
    }, [refreshViewerState]);

    const sanitizeOutgoingMentions = useCallback(
        (rawMentions: Mention[] | undefined) => filterMentionsByFeature(rawMentions ?? [], {
            knowledgeBaseEnabled,
            enabledDataSourceTypes,
        }),
        [enabledDataSourceTypes, knowledgeBaseEnabled]
    );

    const markCreditsExhausted = useCallback((message?: string) => {
        markViewerCreditsExhausted();
        setShowCreditsModal(true);
        if (message) {
            showToast('info', message);
        }
    }, [markViewerCreditsExhausted, setShowCreditsModal, showToast]);

    // Scroll helpers
    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const container = messageScrollContainerRef.current;
        if (container) container.scrollTo({ top: container.scrollHeight, behavior });
    }, [messageScrollContainerRef]);

    const handleMessageListScroll = useCallback(() => {
        const container = messageScrollContainerRef.current;
        if (!container) return;
        shouldAutoScrollRef.current = isNearBottom({
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop,
            clientHeight: container.clientHeight,
        });
    }, [messageScrollContainerRef, shouldAutoScrollRef]);

    // Only the badge follows the current saved-chart bundle; message metadata
    // remains the immutable context actually used for that message.
    useEffect(() => {
        if (!isDreamMode || !userId) return;
        setDreamContext(current => current?.baziChartName === primaryChartName
            ? current
            : { ...current, baziChartName: primaryChartName });
    }, [isDreamMode, primaryChartName, state.dreamContext?.baziChartName, setDreamContext, userId]);

    // Dream daily-fortune context fetch (the chart name comes from Query).
    useEffect(() => {
        let isActive = true;
        const controller = new AbortController();
        if (!isDreamMode || !userId) {
            setDreamContext(undefined);
            setDreamContextLoading(false);
            return () => { isActive = false; controller.abort(); };
        }
        const fetchDreamContext = async () => {
            setDreamContextLoading(true);
            try {
                const response = await fetch('/api/dream-context', { signal: controller.signal });
                if (!response.ok) throw new Error('请求失败');
                const data = await response.json() as { dreamContext?: { dailyFortune?: string } };
                if (!isActive) return;
                setDreamContext(current => ({ ...current, dailyFortune: data.dreamContext?.dailyFortune }));
            } catch (error) {
                if (!isActive) return;
                console.error('获取解梦上下文失败:', error);
                setDreamContext(current => ({ ...current, dailyFortune: undefined }));
            } finally {
                if (isActive) setDreamContextLoading(false);
            }
        };
        void fetchDreamContext();
        return () => { isActive = false; controller.abort(); };
    }, [isDreamMode, userId, setDreamContext, setDreamContextLoading]);

    // Stream manager subscription
    useEffect(() => {
        const unsubscribe = chatStreamManager.subscribe((event) => {
            const convId = event.task.conversationId;
            const currentActiveConversationId = activeConversationIdRef.current;
            const isActiveConversationEvent = convId === currentActiveConversationId;
            const taskDreamContext = (event.task.metadata as AIMessageMetadata | undefined)?.dreamContext;
            const isAuthRequired = event.errorCode === 'AUTH_REQUIRED'
                || event.errorMessage?.includes('请先登录') === true;

            if (event.type === 'task_started') {
                setStreamingConversationIds(prev => {
                    if (prev.has(convId)) return prev;
                    const next = new Set(prev); next.add(convId); return next;
                });
            } else if (event.type === 'task_completed' || event.type === 'task_stopped' || event.type === 'task_failed') {
                setStreamingConversationIds(prev => {
                    if (!prev.has(convId)) return prev;
                    const next = new Set(prev); next.delete(convId); return next;
                });
            }

            if (isActiveConversationEvent) {
                if (
                    event.type === 'task_failed' &&
                    !isAuthRequired &&
                    event.errorCode !== 'INSUFFICIENT_CREDITS' &&
                    event.task.content.trim().length === 0
                ) {
                    const errorMessage: ChatMessage = {
                        id: `chat-error-${Date.now()}`,
                        role: 'assistant',
                        content: event.errorMessage || '抱歉，服务暂时不可用。请稍后再试。',
                        createdAt: new Date().toISOString(),
                        model: customProviderConfig ? `custom:${customProviderConfig.modelId}` : undefined,
                        modelName: customProviderConfig
                            ? (customProviderConfig.modelName || customProviderConfig.modelId)
                            : undefined,
                        metadata: customProviderConfig && shouldShowCheckKeyAction(event.errorMessage)
                            ? { customProviderErrorAction: 'check-key' }
                            : undefined,
                    };
                    setMessages([...event.task.messages, errorMessage]);
                } else {
                    setMessages(event.task.messages);
                }
                if (taskDreamContext) setDreamContext(taskDreamContext);
            }

            const shouldCachePersistedMessages = event.type === 'task_completed'
                || event.type === 'task_stopped'
                || (event.type === 'task_failed' && event.errorCode !== 'PERSIST_FAILED');

            if (shouldCachePersistedMessages && event.task.messages.length > 0) {
                cacheConversationMessages(convId, event.task.messages, {
                    updatedAt: new Date().toISOString(),
                });
            }

            if (event.type === 'task_billed' || event.type === 'task_completed' || event.type === 'task_stopped' || event.type === 'task_failed') {
                debouncedRefreshViewerState();
            }
            if (hasLoadedConversationsRef.current && (event.type === 'task_completed' || event.type === 'task_stopped' || event.type === 'task_failed')) {
                void refreshConversationList();
            }
            if (event.type === 'task_failed' && event.errorCode === 'INSUFFICIENT_CREDITS' && isActiveConversationEvent) {
                markCreditsExhausted(event.errorMessage);
            }
            if (event.type === 'task_failed' && event.errorCode === 'PERSIST_FAILED' && isActiveConversationEvent) {
                showToast('error', event.errorMessage || '保存对话失败，请稍后重试');
            }
            if (event.type === 'task_failed' && isAuthRequired) {
                showToast('info', event.errorMessage || '请先登录后再使用 AI 对话');
            }
        });
        return unsubscribe;
    }, [cacheConversationMessages, markCreditsExhausted, debouncedRefreshViewerState, refreshConversationList, showToast, activeConversationIdRef, hasLoadedConversationsRef, setMessages, setStreamingConversationIds, setDreamContext, customProviderConfig]);

    const handleArchiveMessage = useCallback((message: ChatMessage) => {
        if (!activeConversationId || !knowledgeBaseEnabled) return;
        setKbTargetMessage(message);
        setKbModalOpen(true);
    }, [activeConversationId, knowledgeBaseEnabled, setKbTargetMessage, setKbModalOpen]);

    const closeKbModal = useCallback(() => {
        setKbModalOpen(false);
        setKbTargetMessage(null);
    }, [setKbModalOpen, setKbTargetMessage]);

    // Stop AI reply
    const handleStop = useCallback(() => {
        if (agent.active) { agent.stop(); return; }
        if (!activeConversationId) return;
        chatStreamManager.stopTask(activeConversationId);
    }, [activeConversationId, agent]);

    const handleQueueMessage = async () => {
        if (!agent.active || !inputValue.trim() || isSendingToList) return;
        const clearSubmittedDraft = state.captureSubmittedDraft(true);
        setIsSendingToList(true);
        try { await agent.sendCommand(inputValue.trim(), true); clearSubmittedDraft(); }
        catch (error) { showToast('error', error instanceof Error ? error.message : '发送失败'); }
        finally { setIsSendingToList(false); }
    };

    // Send message; `context` is the rich chart quote attached above the composer.
    const handleSend = async (context?: string) => {
        const trimmedInput = [context?.trim(), inputValue.trim()].filter(Boolean).join('\n\n');
        if (agent.active && trimmedInput && !isSendingToList) {
            const clearSubmittedDraft = state.captureSubmittedDraft(true);
            setIsSendingToList(true);
            try { await agent.sendCommand(trimmedInput); clearSubmittedDraft(); }
            catch (error) { showToast('error', error instanceof Error ? error.message : '发送失败'); }
            finally { setIsSendingToList(false); }
            return;
        }
        if (!trimmedInput || isLoading || isSendingToList) return;
        if (attachmentState.uploaded?.length && agent.mode !== 'agent') { showToast('info', '私有图片和文本资料请使用 Agent 模式发送'); return; }
        if (isDreamMode && dreamContextLoading) return;
        let isCurrent = agent.captureConversation();
        const clearSubmittedDraft = state.captureSubmittedDraft(true);
        setIsSendingToList(true);

        const messageMentions = sanitizeOutgoingMentions(mentions);
        const isNewConversation = !activeConversationId;
        const draftTitle = isNewConversation ? buildDraftTitle(trimmedInput) : null;
        let conversationId = activeConversationId;
        try {
            if (!isNewConversation && !conversationValidatedRef.current) {
                showToast('info', '会话加载中，请稍后再试');
                return;
            }
            if (isNewConversation && userId) {
                setPendingSidebarTitle(draftTitle || DEFAULT_CONVERSATION_TITLE);
                setHasLoadedConversations(true);
                const newId = await createConversation({
                    personality: 'general',
                    title: draftTitle || DEFAULT_CONVERSATION_TITLE,
                });
                if (newId) {
                    conversationId = newId;
                    if (!isCurrent()) return;
                    state.conversationEpochRef.current += 1;
                    activeConversationIdRef.current = newId;
                    conversationValidatedRef.current = true;
                    state.moveDraft(newId);
                    setActiveConversationId(newId);
                    isCurrent = agent.captureConversation(newId);
                    if (searchParams.get('id') !== newId) router.replace(`/chat?id=${newId}`);
                    setPendingSidebarTitle(null);
                    const nowIso = new Date().toISOString();
                    setConversations(prev => {
                        const nextConversation: ConversationListItem = {
                            id: newId, userId,
                            personality: 'general', title: draftTitle || DEFAULT_CONVERSATION_TITLE,
                            createdAt: nowIso, updatedAt: nowIso, sourceType: 'chat', questionPreview: null,
                            isArchived: false, archivedKbIds: [],
                        };
                        return [nextConversation, ...prev.filter(c => c.id !== newId)];
                    });
                    setHasLoadedConversations(true);
                } else {
                    setPendingSidebarTitle(null);
                }
            }
            if (!conversationId) { showToast('error', '创建对话失败，请重试'); return; }
            if (chatStreamManager.isConversationRunning(conversationId)) { showToast('info', '当前会话正在生成中，请稍后再试'); return; }

            const dreamInfo: DreamInterpretationInfo | undefined = isDreamMode ? {
                userName: user?.user_metadata?.nickname || ANONYMOUS_DISPLAY_NAME,
                dreamDate: new Date().toISOString(),
                dreamContent: trimmedInput.slice(0, 50),
            } : undefined;

            const userMessage: ChatMessage = {
                id: Date.now().toString(), role: 'user', content: trimmedInput, createdAt: new Date().toISOString(),
                mentions: messageMentions.length ? [...messageMentions] : undefined,
                attachments: (attachmentState.file || attachmentState.uploaded?.length || attachmentState.webSearchEnabled) ? { fileName: attachmentState.file?.name || attachmentState.uploaded?.map(item=>item.name).join('、') || '', ids: attachmentState.uploaded?.map(item=>item.id), webSearchEnabled: attachmentState.webSearchEnabled } : undefined,
                dreamInfo,
            };
            const newMessages = [...messages, userMessage];
            const activeCustomProvider = getCustomProvider();
            const customProviderLabel = getCustomProviderDisplayName(activeCustomProvider);
            const effectiveModelId = activeCustomProvider ? `custom:${activeCustomProvider.modelId}` : selectedModel;
            if (agent.mode === 'agent') {
                if (isCurrent()) setMessages(newMessages);
                try {
                    let fileContent: string | undefined;
                    if (attachmentState.file) {
                        const form = new FormData(); form.append('mode', 'file'); form.append('query', trimmedInput); form.append('file', attachmentState.file);
                        const response = await fetch('/api/dify/enhance', { method: 'POST', body: form });
                        const result = await response.json();
                        if (!response.ok || !result.success) throw new Error(result.error || '附件解析失败');
                        fileContent = result.data?.file_content;
                    }
                    await agent.start(conversationId, userMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, provider: activeCustomProvider, fileContent });
                    clearSubmittedDraft();
                } catch (error) {
                    if (isCurrent()) {
                        setMessages(messages);
                        void state.retryConversationLoad();
                    }
                    showToast('error', error instanceof Error ? error.message : '创建任务失败');
                }
                return;
            }
            const assistantMessageId = (Date.now() + 1).toString();
            const initialAssistantMessage: ChatMessage = {
                id: assistantMessageId, role: 'assistant', content: '', createdAt: new Date().toISOString(), model: effectiveModelId,
                modelName: activeCustomProvider ? (customProviderLabel || activeCustomProvider.modelId) : resolveClientModelName(selectedModel, selectedModel),
            };
            const optimisticMessages = [...newMessages, initialAssistantMessage];
            setMessages(optimisticMessages);
            const saveSucceeded = await saveMessages(conversationId, newMessages, isNewConversation ? (draftTitle || undefined) : undefined);
            if (!saveSucceeded) {
                if (isNewConversation) {
                    await deleteConversation(conversationId);
                    if (activeConversationIdRef.current === conversationId) {
                        activeConversationIdRef.current = null;
                        conversationValidatedRef.current = false;
                        setActiveConversationId(null);
                        setMessages([]);
                        router.replace('/chat');
                    }
                    removeConversationDetail(conversationId);
                    setConversations(prev => prev.filter(conv => conv.id !== conversationId));
                    setPendingSidebarTitle(null);
                    setHasLoadedConversations(true);
                    void refreshConversationList(userId);
                } else if (conversationId === activeConversationIdRef.current) {
                    setMessages(messages);
                }
                showToast('error', '保存对话失败，请重试');
                return;
            }
            clearSubmittedDraft();

            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            let difyContext: DifyContext | undefined;
            if (attachmentState.file || attachmentState.webSearchEnabled) {
                const mode = attachmentState.file && attachmentState.webSearchEnabled ? 'all' : attachmentState.file ? 'file' : 'web';
                const formData = new FormData();
                formData.append('mode', mode);
                formData.append('query', trimmedInput);
                if (attachmentState.file) formData.append('file', attachmentState.file);
                const difyResponse = await fetch('/api/dify/enhance', { method: 'POST', body: formData });
                if (difyResponse.ok) {
                    const difyResult = await difyResponse.json();
                    if (difyResult.success && difyResult.data) {
                        difyContext = { webContent: difyResult.data.web_content, fileContent: difyResult.data.file_content };
                        setAttachmentState(prev => ({ ...prev, file: undefined }));
                    }
                } else {
                    const errorData = await difyResponse.json();
                    if (errorData.code === 'MEMBERSHIP_REQUIRED') console.warn('Dify权限不足:', errorData.error);
                }
            }

            // 读取可视化设置
            const visualizationSettings = readLocalVisualizationSettings(localStorage);

            const startResult = await chatStreamManager.startTask({
                conversationId, requestHeaders: headers,
                requestBody: {
                    messages: newMessages,
                    personality: 'general',
                    stream: true,
                    model: activeCustomProvider ? activeCustomProvider.modelId : selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: activeCustomProvider ? false : reasoningEnabled,
                    reasoningEffort: activeCustomProvider ? null : state.reasoningEffort,
                    difyContext,
                    mentions: messageMentions.map(m => ({ ...m })),
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings,
                },
                baseMessages: newMessages, assistantMessage: initialAssistantMessage,
                runner: activeCustomProvider ? createCustomProviderChatRunner(activeCustomProvider) : undefined,
            });
            if (!startResult.ok) {
                if (conversationId === activeConversationIdRef.current) setMessages(newMessages);
                if (startResult.code === 'INSUFFICIENT_CREDITS') markCreditsExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('发送失败:', error);
            if (conversationId === activeConversationIdRef.current) {
                const errorMessage: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: '抱歉，服务暂时不可用。请稍后再试。', createdAt: new Date().toISOString() };
                setMessages(prev => { const last = prev[prev.length - 1]; return last?.role === 'assistant' && !last.content ? [...prev.slice(0, -1), errorMessage] : [...prev, errorMessage]; });
            }
        } finally {
            setPendingSidebarTitle(null);
            setIsSendingToList(false);
        }
    };

    // Edit message and resend
    const handleEditMessage = async (messageId: string, newContent: string, nextMentions?: Mention[]) => {
        if (agent.active) { showToast('info', '请先停止当前任务，再编辑历史消息'); return; }
        const targetConversationId = activeConversationIdRef.current;
        if (!targetConversationId) return;
        const isTargetActive = agent.captureConversation(targetConversationId);
        const originalSnapshot = messages;
        const messageIndex = messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;

        const originalMessage = messages[messageIndex];
        const originalAiMessage = messages[messageIndex + 1];
        const originalAiContent = originalAiMessage?.role === 'assistant' ? originalAiMessage.content : '';
        const previousMessages = messages.slice(0, messageIndex);
        const subsequentMessages = messages.slice(messageIndex + 2);

        const existingVersions = [...(originalMessage.versions || [])];
        if (existingVersions.length === 0 && originalMessage.content) {
            existingVersions.push({ userContent: originalMessage.content, attachments: originalMessage.attachments, mentions: originalMessage.mentions ? [...originalMessage.mentions] : undefined, aiContent: originalAiContent, aiAgent: originalAiMessage?.agent, aiMetadata: originalAiMessage?.metadata, createdAt: originalMessage.createdAt, subsequentMessages: subsequentMessages.length > 0 ? subsequentMessages : undefined });
        } else if (existingVersions.length > 0 && subsequentMessages.length > 0) {
            const idx = originalMessage.currentVersionIndex ?? existingVersions.length - 1;
            if (existingVersions[idx] && !existingVersions[idx].subsequentMessages) existingVersions[idx] = { ...existingVersions[idx], subsequentMessages };
        }

        const messageMentions = sanitizeOutgoingMentions(Array.isArray(nextMentions) ? nextMentions : (originalMessage.mentions ?? []));
        const updatedUserMessage: ChatMessage = { ...originalMessage, content: newContent, mentions: messageMentions.length ? [...messageMentions] : undefined, versions: existingVersions, currentVersionIndex: existingVersions.length - 1 };
        const newMessages = [...previousMessages, updatedUserMessage];
        if (agent.mode === 'agent') {
            if (isTargetActive()) setMessages(newMessages);
            try { await agent.start(targetConversationId, updatedUserMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, provider: getCustomProvider(), replaceFromMessageId: originalMessage.id }); }
            catch (error) { if (isTargetActive()) setMessages(originalSnapshot); showToast('error', error instanceof Error ? error.message : '编辑失败'); }
            return;
        }
        if (isTargetActive()) setMessages(newMessages);

        const assistantMessageId = (Date.now() + 1).toString();
        const activeCustomProvider = getCustomProvider();
        const customProviderLabel = getCustomProviderDisplayName(activeCustomProvider);
        const effectiveModelId = activeCustomProvider ? `custom:${activeCustomProvider.modelId}` : selectedModel;
        const initialAssistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            model: effectiveModelId,
            modelName: activeCustomProvider ? (customProviderLabel || activeCustomProvider.modelId) : resolveClientModelName(selectedModel, selectedModel),
        };
        if (isTargetActive()) setMessages([...newMessages, initialAssistantMessage]);

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            const onBeforeSave = (finalMessages: ChatMessage[], assistantContent: string): ChatMessage[] => {
                const newVersion = { userContent: newContent, attachments: updatedUserMessage.attachments, mentions: messageMentions.length ? [...messageMentions] : undefined, aiContent: assistantContent || '抱歉，我暂时无法回答这个问题。', createdAt: new Date().toISOString() };
                const updatedVersions = [...existingVersions, newVersion];
                const finalUserMessage: ChatMessage = { ...updatedUserMessage, versions: updatedVersions, currentVersionIndex: updatedVersions.length - 1 };
                return finalMessages.map(msg => msg.id === updatedUserMessage.id ? finalUserMessage : msg);
            };

            const startResult = await chatStreamManager.startTask({
                conversationId: targetConversationId, requestHeaders: headers,
                requestBody: {
                    messages: newMessages,
                    personality: 'general',
                    stream: true,
                    model: activeCustomProvider ? activeCustomProvider.modelId : selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: activeCustomProvider ? false : reasoningEnabled,
                    reasoningEffort: activeCustomProvider ? null : state.reasoningEffort,
                    mentions: messageMentions,
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings: readLocalVisualizationSettings(localStorage),
                },
                baseMessages: newMessages, assistantMessage: initialAssistantMessage, onBeforeSave,
                runner: activeCustomProvider ? createCustomProviderChatRunner(activeCustomProvider) : undefined,
            });
            if (!startResult.ok) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (startResult.code === 'INSUFFICIENT_CREDITS') markCreditsExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('编辑发送失败:', error);
            if (isTargetActive()) setMessages(prev => [...prev.slice(0, -1), { id: (Date.now() + 1).toString(), role: 'assistant', content: '抱歉，服务暂时不可用。', createdAt: new Date().toISOString() }]);
        }
    };

    // Regenerate AI response
    const handleRegenerateResponse = async (messageId: string) => {
        if (agent.active) { showToast('info', '请先停止当前任务，再重新生成'); return; }
        const targetConversationId = activeConversationIdRef.current;
        if (!targetConversationId) return;
        const isTargetActive = agent.captureConversation(targetConversationId);
        const originalSnapshot = messages;
        const messageIndex = messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1 || messageIndex === 0) return;

        const oldAiMessage = messages[messageIndex];
        const oldAiContent = oldAiMessage.role === 'assistant' ? oldAiMessage.content : '';
        const previousMessages = messages.slice(0, messageIndex);
        const subsequentMessages = messages.slice(messageIndex + 1);

        const userMessageIndex = [...previousMessages].reverse().findIndex(msg => msg.role === 'user');
        const lastUserMessage = userMessageIndex >= 0 ? previousMessages[previousMessages.length - 1 - userMessageIndex] : undefined;
        const messageMentions = sanitizeOutgoingMentions(lastUserMessage?.mentions ?? []);
        if (agent.mode === 'agent' && lastUserMessage) {
            if (isTargetActive()) setMessages(previousMessages);
            try { await agent.start(targetConversationId, lastUserMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, provider: getCustomProvider(), replaceFromMessageId: lastUserMessage.id }); }
            catch (error) { if (isTargetActive()) setMessages(originalSnapshot); showToast('error', error instanceof Error ? error.message : '重新生成失败'); }
            return;
        }

        let updatedPreviousMessages = previousMessages;
        let existingVersions: NonNullable<ChatMessage['versions']> = [];
        if (lastUserMessage) {
            existingVersions = [...(lastUserMessage.versions || [])];
            if (existingVersions.length === 0 && oldAiContent) {
                existingVersions.push({ userContent: lastUserMessage.content, attachments: lastUserMessage.attachments, mentions: lastUserMessage.mentions ? [...lastUserMessage.mentions] : undefined, aiContent: oldAiContent, aiAgent: oldAiMessage.agent, aiMetadata: oldAiMessage.metadata, createdAt: oldAiMessage.createdAt || new Date().toISOString(), subsequentMessages: subsequentMessages.length > 0 ? subsequentMessages : undefined });
            } else if (existingVersions.length > 0 && subsequentMessages.length > 0) {
                const currentVersionIdx = lastUserMessage.currentVersionIndex ?? existingVersions.length - 1;
                if (existingVersions[currentVersionIdx] && !existingVersions[currentVersionIdx].subsequentMessages) existingVersions[currentVersionIdx] = { ...existingVersions[currentVersionIdx], subsequentMessages };
            }
            const updatedUserMessage: ChatMessage = {
                ...lastUserMessage,
                mentions: messageMentions.length ? [...messageMentions] : undefined,
                versions: existingVersions,
                currentVersionIndex: existingVersions.length - 1,
            };
            updatedPreviousMessages = previousMessages.map(m => m.id === lastUserMessage.id ? updatedUserMessage : m);
        }

        const assistantMessageId = (Date.now() + 1).toString();
        const activeCustomProvider = getCustomProvider();
        const customProviderLabel = getCustomProviderDisplayName(activeCustomProvider);
        const effectiveModelId = activeCustomProvider ? `custom:${activeCustomProvider.modelId}` : selectedModel;
        const initialAssistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            model: effectiveModelId,
            modelName: activeCustomProvider ? (customProviderLabel || activeCustomProvider.modelId) : resolveClientModelName(selectedModel, selectedModel),
        };
        if (isTargetActive()) setMessages([...updatedPreviousMessages, initialAssistantMessage]);

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            const onBeforeSave = lastUserMessage
                ? (finalMessages: ChatMessage[], assistantContent: string): ChatMessage[] => {
                    const newVersion = { userContent: lastUserMessage.content, attachments: lastUserMessage.attachments, mentions: messageMentions.length ? [...messageMentions] : undefined, aiContent: assistantContent || '抱歉，我暂时无法回答这个问题。', createdAt: new Date().toISOString() };
                    const updatedVersions = [...existingVersions, newVersion];
                    const finalUserMessage: ChatMessage = {
                        ...lastUserMessage,
                        mentions: messageMentions.length ? [...messageMentions] : undefined,
                        versions: updatedVersions,
                        currentVersionIndex: updatedVersions.length - 1,
                    };
                    return finalMessages.map(msg => msg.id === lastUserMessage.id ? finalUserMessage : msg);
                }
                : undefined;

            const startResult = await chatStreamManager.startTask({
                conversationId: targetConversationId, requestHeaders: headers,
                requestBody: {
                    messages: updatedPreviousMessages,
                    personality: 'general',
                    stream: true,
                    model: activeCustomProvider ? activeCustomProvider.modelId : selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: activeCustomProvider ? false : reasoningEnabled,
                    reasoningEffort: activeCustomProvider ? null : state.reasoningEffort,
                    mentions: messageMentions,
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings: readLocalVisualizationSettings(localStorage),
                },
                baseMessages: updatedPreviousMessages, assistantMessage: initialAssistantMessage, onBeforeSave,
                runner: activeCustomProvider ? createCustomProviderChatRunner(activeCustomProvider) : undefined,
            });
            if (!startResult.ok) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (startResult.code === 'INSUFFICIENT_CREDITS') markCreditsExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('重新生成失败:', error);
            if (isTargetActive()) setMessages(prev => [...prev.slice(0, -1), { id: (Date.now() + 1).toString(), role: 'assistant', content: '抱歉，服务暂时不可用。', createdAt: new Date().toISOString() }]);
        }
    };

    // Switch message version
    const handleSwitchVersion = useCallback((messageId: string, versionIndex: number) => {
        if (agent.active) return;
        setMessages(prev => {
            const messageIndex = prev.findIndex(m => m.id === messageId);
            if (messageIndex === -1) return prev;
            const message = prev[messageIndex];
            if (!message.versions || versionIndex < 0 || versionIndex >= message.versions.length) return prev;
            const version = message.versions[versionIndex];
            const previousMessages = prev.slice(0, messageIndex);
            const versionMentions = sanitizeOutgoingMentions(version.mentions ?? message.mentions);
            const updatedUserMessage: ChatMessage = { ...message, content: version.userContent, attachments: Object.hasOwn(version, 'attachments') ? version.attachments : message.attachments, mentions: versionMentions ? [...versionMentions] : undefined, currentVersionIndex: versionIndex };
            const aiMessage: ChatMessage = { id: `ai-version-${versionIndex}-${Date.now()}`, role: 'assistant', content: version.aiContent, createdAt: version.createdAt, agent: version.aiAgent, metadata: version.aiMetadata };
            let newMessages = [...previousMessages, updatedUserMessage, aiMessage];
            if (version.subsequentMessages?.length) newMessages = [...newMessages, ...version.subsequentMessages];
            if (userId && activeConversationId) void saveMessages(activeConversationId, newMessages);
            return newMessages;
        });
    }, [activeConversationId, agent.active, sanitizeOutgoingMentions, saveMessages, setMessages, userId]);

    return {
        agent,
        handleQueueMessage,
        scrollToBottom,
        handleMessageListScroll,
        markCreditsExhausted,
        handleArchiveMessage,
        closeKbModal,
        handleStop,
        handleSend,
        handleEditMessage,
        handleRegenerateResponse,
        handleSwitchVersion,
    };
}
