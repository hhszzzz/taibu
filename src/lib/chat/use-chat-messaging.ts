/**
 * 消息发送、流式响应、中止、重试逻辑 hook
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AIReasoningEffort, ChatAttachment, ChatMessage, ConversationListItem, Mention, AIMessageMetadata, DreamInterpretationInfo } from '@/types';
import { extractPlainAttachment } from '@/lib/chat/composer-files';
import { ANONYMOUS_DISPLAY_NAME } from '@/types';
import { createConversation, deleteConversation, DEFAULT_CONVERSATION_TITLE } from '@/lib/chat/conversation';
import { buildDraftTitle } from '@/lib/chat/draft-title';
import { isNearBottom } from '@/lib/chat/chat-scroll';
import { chatStreamManager, ChatRunnerError, type ChatStreamTaskRunner } from '@/lib/chat/chat-stream-manager';
import { resolveClientModelName } from '@/lib/ai/model-name-cache';
import { byokThinking, isByokRef } from '@/lib/byok/config';
import { useOwnModels, type OwnModel } from '@/lib/byok/client';
import { generateImagesInBrowser, missingKeyMessage, runBrowserByok, type GeneratedImagesPayload } from '@/lib/byok/browser';
import type { ByokChatMessage } from '@/lib/byok/pi-model';
import { requestByokKey } from '@/lib/byok/key-request';
import type { ChatStateReturn } from '@/lib/chat/use-chat-state';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useUserCharts } from '@/lib/hooks/useUserCharts';
import { selectPrimarySavedBaziChart } from '@/lib/user/charts-client';
import { filterMentionsByFeature, getEnabledDataSourceTypes } from '@/lib/data-sources/catalog';
import { readLocalVisualizationSettings } from '@/lib/visualization/settings';
import { useAgentChat } from '@/lib/agent/use-agent-chat';
import { parseAgentCompactCommand } from '@/lib/agent/compaction';
import { browserTimeZone } from '@/lib/ai/prompt-time';
import { captureCurrentBranch, switchToVersion, withPendingVersion } from '@/lib/chat/message-versions';
import { normalizeMessageQuotes, type MessageQuote } from '@/lib/chat/quotes';
import { requestBrowserJson } from '@/lib/browser-api';
import { AgentHttpError } from '@/lib/agent/browser-client';
import { TOP_UP_TOAST } from '@/lib/billing/client';

/** An own model with the key on this device: the site prepares the prompt, this browser calls the provider. */
function createOwnModelRunner(model: OwnModel): ChatStreamTaskRunner {
    return async ({ requestHeaders, requestBody, signal, fetcher, appendContentDelta, appendReasoningDelta, setMetadata }) => {
        const prepareResponse = await fetcher.call(globalThis, '/api/chat/direct/prepare', {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!prepareResponse.ok) {
            const data = await prepareResponse.json().catch(() => null) as { error?: unknown } | null;
            const message = typeof data?.error === 'string' && data.error.trim() ? data.error : '生成对话上下文失败，请稍后重试';
            throw new ChatRunnerError(message, prepareResponse.status);
        }
        const prepared = await prepareResponse.json() as {
            systemPrompt: string;
            sanitizedMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
            metadata?: AIMessageMetadata;
        };
        if (prepared.metadata) setMetadata(prepared.metadata);
        await runBrowserByok(model, {
            systemPrompt: prepared.systemPrompt,
            messages: prepared.sanitizedMessages.filter((message): message is ByokChatMessage & { content: string } => message.role !== 'system'),
            thinking: byokThinking(requestBody.reasoning === true, requestBody.reasoningEffort as AIReasoningEffort | null | undefined, model.thinkingLevels),
            source: 'chat',
            conversationId: typeof requestBody.conversationId === 'string' ? requestBody.conversationId : undefined,
            signal,
            onText: appendContentDelta,
            onReasoning: appendReasoningDelta,
        });
    };
}

/** Local-only failure notice: never saved, so it offers no fork. */
const unavailableReply = (content: string): ChatMessage => ({ id: (Date.now() + 1).toString(), role: 'assistant', content, createdAt: new Date().toISOString(), metadata: { unsaved: true } });

interface UseChatMessagingParams {
    state: ChatStateReturn;
    userId: string | null;
    user: { name?: string | null } | null;
    refreshViewerState: () => Promise<unknown>;
    markViewerBalanceExhausted: () => void;
    /** The known balance cannot pay for the chosen platform model; checked again when sending. */
    balanceInsufficient: boolean;
    showToast: ReturnType<typeof import('@/components/ui/Toast').useToast>['showToast'];
    router: ReturnType<typeof import('next/navigation').useRouter>;
    searchParams: ReturnType<typeof import('next/navigation').useSearchParams>;
}

export function useChatMessaging({
    state,
    userId,
    user,
    refreshViewerState,
    markViewerBalanceExhausted,
    balanceInsufficient,
    showToast,
    router,
    searchParams,
}: UseChatMessagingParams) {
    const initialAgentMode = searchParams.get('mode') === 'agent' ? 'agent' as const : 'plain' as const;
    const agent = useAgentChat(state, userId, refreshViewerState, initialAgentMode);
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
        imageModel,
        attachmentState,
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

    const own = useOwnModels(userId);
    const findOwnModel = useCallback((ref: string | null | undefined) => (ref ? own.models.find(model => model.ref === ref) ?? null : null), [own.models]);

    /**
     * Whether these models can be used now: an own model must still exist, and its key must be stored on the site or
     * kept on this device. Tells the reader why not (with a way to fill the key in) and returns false.
     */
    const ownModelsUsable = (refs: Array<string | null | undefined>): boolean => {
        for (const ref of refs) {
            if (!isByokRef(ref)) continue;
            const model = findOwnModel(ref);
            if (!model) {
                showToast('info', own.loading ? '自定义模型加载中，请稍后再试' : '这个自定义模型已不存在，请重新选择模型');
                return false;
            }
            if (!model.ready) {
                showToast('info', missingKeyMessage(model), { action: { label: '填写 Key', onClick: () => requestByokKey(model.ref) } });
                return false;
            }
        }
        return true;
    };

    /** The keys this device hands an Agent task for the own models it uses whose calls the site cannot make itself. */
    const agentByokKeys = (refs: Array<string | null | undefined>): Record<string, string> => {
        const keys: Record<string, string> = {};
        for (const ref of refs) {
            const model = findOwnModel(ref);
            if (model?.deviceKey) keys[model.connection.id] = model.deviceKey;
        }
        return keys;
    };

    /** The models a send uses: an Agent task also takes its members and image model. */
    const usedModels = () => (agent.mode === 'agent' ? [selectedModel, ...state.collaborators.map(member => member.model), imageModel] : [selectedModel]);

    /** How a reply from the selected model is labelled and run. */
    const replyModel = (ref: string) => {
        const model = findOwnModel(ref);
        return {
            model: ref,
            modelName: model?.displayName ?? resolveClientModelName(ref, ref),
            runner: model && !model.serverKey ? createOwnModelRunner(model) : undefined,
        };
    };

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

    const markBalanceExhausted = useCallback((message?: string) => {
        markViewerBalanceExhausted();
        // 钱包关闭时没有可以去的充值入口：只提示余额不足。
        const walletOpen = isFeatureEnabled('billing');
        showToast('info', walletOpen ? (message || '余额不足，请充值、兑换或订阅后再试') : '余额不足', walletOpen ? TOP_UP_TOAST : undefined);
    }, [isFeatureEnabled, markViewerBalanceExhausted, showToast]);

    /** 缓存的余额可能落后于刚完成的充值：拦下发送前再读一次，只有确认仍为空才提示。 */
    const guardBalance = useCallback(async () => {
        if (!balanceInsufficient) return true;
        let spendable: number | null | undefined;
        try {
            const data = await refreshViewerState() as { billing?: { spendableMicros?: number } | null } | null;
            spendable = data?.billing?.spendableMicros;
        } catch {
            spendable = undefined;
        }
        // 读不到时交给服务端判断；只有明确为零才拦。
        if (typeof spendable !== 'number' || spendable > 0) return true;
        markBalanceExhausted();
        return false;
    }, [balanceInsufficient, markBalanceExhausted, refreshViewerState]);

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
                    event.errorCode !== 'INSUFFICIENT_BALANCE' &&
                    event.task.content.trim().length === 0
                ) {
                    // An own model's failure carries the provider's status and text; its settings are one click away.
                    const errorMessage: ChatMessage = {
                        id: `chat-error-${Date.now()}`,
                        role: 'assistant',
                        content: event.errorMessage || '抱歉，服务暂时不可用。请稍后再试。',
                        createdAt: new Date().toISOString(),
                        model: event.task.model,
                        modelName: event.task.modelName,
                        metadata: isByokRef(event.task.model) ? { unsaved: true, byokErrorAction: 'settings' } : { unsaved: true },
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

            if (event.type === 'task_completed' || event.type === 'task_stopped' || event.type === 'task_failed') {
                debouncedRefreshViewerState();
            }
            if (hasLoadedConversationsRef.current && (event.type === 'task_completed' || event.type === 'task_stopped' || event.type === 'task_failed')) {
                void refreshConversationList();
            }
            if (event.type === 'task_failed' && event.errorCode === 'INSUFFICIENT_BALANCE' && isActiveConversationEvent) {
                markBalanceExhausted(event.errorMessage);
            }
            if (event.type === 'task_failed' && event.errorCode === 'PERSIST_FAILED' && isActiveConversationEvent) {
                showToast('error', event.errorMessage || '保存对话失败，请稍后重试');
            }
            if (event.type === 'task_failed' && isAuthRequired) {
                showToast('info', event.errorMessage || '请先登录后再使用 AI 对话');
            }
        });
        return unsubscribe;
    }, [cacheConversationMessages, markBalanceExhausted, debouncedRefreshViewerState, refreshConversationList, showToast, activeConversationIdRef, hasLoadedConversationsRef, setMessages, setStreamingConversationIds, setDreamContext]);

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

    /** A new conversation for a draft, with the sidebar, route and caches in step; null when it cannot be created. */
    const createDraftConversation = async (draftTitle: string, isCurrent: () => boolean) => {
        if (!userId) return null;
        setPendingSidebarTitle(draftTitle || DEFAULT_CONVERSATION_TITLE);
        setHasLoadedConversations(true);
        const newId = await createConversation({
            personality: 'general',
            title: draftTitle || DEFAULT_CONVERSATION_TITLE,
        });
        if (!newId) { setPendingSidebarTitle(null); return null; }
        if (!isCurrent()) return null;
        state.bumpConversationEpoch();
        activeConversationIdRef.current = newId;
        conversationValidatedRef.current = true;
        state.moveDraft(newId);
        setActiveConversationId(newId);
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
        return newId;
    };

    /** Removes a conversation created for a failed send, so the sidebar keeps no empty shell. */
    const discardDraftConversation = async (conversationId: string) => {
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
    };

    /**
     * 输入框直接生图：先建好对话，再调用生图接口，成功后把用户消息和助手消息一起写入。
     * 失败时不留下空对话；预扣的费用由服务端按没生成的张数退回。Key 只在本设备的自定义生图模型由浏览器直连生成。
     */
    const handleImageGenerate = async (options: { prompt: string; size: string; count: number }) => {
        const prompt = options.prompt.trim();
        if (!userId || !prompt || isLoading || isSendingToList) return;
        if (!ownModelsUsable([imageModel])) return;
        const ownImage = findOwnModel(imageModel);
        let isCurrent = agent.captureConversation();
        const clearSubmittedDraft = state.captureSubmittedDraft(true);
        setIsSendingToList(true);
        const isNewConversation = !activeConversationId;
        const draftTitle = isNewConversation ? buildDraftTitle(prompt) : null;
        let conversationId = activeConversationId;
        const assistantId = (Date.now() + 1).toString();
        const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: prompt, createdAt: new Date().toISOString() };
        let insufficientBalance = false;
        try {
            if (!isNewConversation && !conversationValidatedRef.current) {
                showToast('info', '会话加载中，请稍后再试');
                return;
            }
            if (isNewConversation) {
                const newId = await createDraftConversation(draftTitle || DEFAULT_CONVERSATION_TITLE, isCurrent);
                if (!newId) {
                    if (!isCurrent()) return;
                    showToast('error', '创建对话失败，请重试');
                    return;
                }
                conversationId = newId;
                isCurrent = agent.captureConversation(newId);
            }
            if (!conversationId) { showToast('error', '创建对话失败，请重试'); return; }
            const pendingMessage: ChatMessage = {
                id: assistantId, role: 'assistant', content: '正在生成图片…', createdAt: new Date().toISOString(),
                metadata: { sources: [], pending: true },
            };
            if (isCurrent()) setMessages(prev => [...prev, userMessage, pendingMessage]);
            const response = ownImage && !ownImage.serverKey
                ? await generateImagesInBrowser(ownImage, { conversationId, prompt, size: options.size, count: options.count })
                : await requestBrowserJson<GeneratedImagesPayload>('/api/images/generate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conversationId, prompt, size: options.size, count: options.count, ...(imageModel ? { model: imageModel } : {}) }),
                });
            const images = response.data?.images ?? [];
            if (response.status === 402) { insufficientBalance = true; markViewerBalanceExhausted(); }
            if (response.error || !images.length) throw new Error(response.error?.message ?? '生成图片失败，请重试');
            const assistantMessage: ChatMessage = {
                id: assistantId, role: 'assistant', createdAt: new Date().toISOString(),
                content: `已生成 ${images.length} 张图片。`,
                model: response.data?.model.id,
                modelName: response.data?.model.name,
                metadata: { sources: [], generatedImages: images.map(({ id, size, mimeType }) => ({ id, size, mimeType })) },
            };
            const nextMessages = [...messages, userMessage, assistantMessage];
            const saved = await saveMessages(conversationId, nextMessages, isNewConversation ? (draftTitle || undefined) : undefined);
            if (!saved) throw new Error('保存对话失败，请重试');
            clearSubmittedDraft();
            if (isCurrent()) setMessages(nextMessages);
            void refreshViewerState().catch(() => undefined);
        } catch (error) {
            if (isCurrent()) setMessages(prev => prev.filter(message => message.id !== assistantId && message.id !== userMessage.id));
            if (isNewConversation && conversationId) await discardDraftConversation(conversationId);
            else if (conversationId === activeConversationIdRef.current) setMessages(messages);
            if (insufficientBalance) markBalanceExhausted(error instanceof Error ? error.message : undefined);
            else showToast('error', error instanceof Error ? error.message : '生成图片失败，请重试');
        } finally {
            setIsSendingToList(false);
        }
    };

    // Send message; `context` is the rich chart quote attached above the composer, `quotes` the answers the user quoted.
    const handleSend = async (context?: string, quotes?: MessageQuote[]) => {
        const trimmedInput = [context?.trim(), inputValue.trim()].filter(Boolean).join('\n\n');
        const messageQuotes = normalizeMessageQuotes(quotes);
        // `/compact` compacts an idle Agent conversation; it is never sent to a model as a question or instruction.
        if (parseAgentCompactCommand(inputValue)) {
            const blocked = agent.mode !== 'agent' ? '压缩上下文用于 Agent 对话'
                : agent.active ? '任务进行中，结束后再压缩上下文'
                : !activeConversationId || !messages.length ? '当前对话还没有可压缩的内容'
                : context?.trim() || mentions.length || attachmentState.file || attachmentState.uploaded?.length || messageQuotes.length ? '压缩上下文时不能附带资料或引用' : null;
            if (blocked) { showToast('info', blocked); return; }
        }
        if (agent.active && trimmedInput && !isSendingToList) {
            if (messageQuotes.length) { showToast('info', '任务进行中不能附带引用，请先停止当前任务'); return; }
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
        const modelRefs = usedModels();
        if (!ownModelsUsable(modelRefs)) return;
        if (!(await guardBalance())) return;
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
            // The document is read before anything is created or saved, so a file that cannot be read leaves the draft as it was.
            let attachment: ChatAttachment | undefined;
            if (attachmentState.file) {
                try {
                    attachment = await extractPlainAttachment(attachmentState.file);
                } catch (error) {
                    showToast('error', error instanceof Error ? error.message : '文件解析失败，请重试');
                    return;
                }
                if (!isCurrent()) return;
            }
            if (isNewConversation && userId) {
                const newId = await createDraftConversation(draftTitle || DEFAULT_CONVERSATION_TITLE, isCurrent);
                if (newId) {
                    conversationId = newId;
                    isCurrent = agent.captureConversation(newId);
                } else if (!isCurrent()) {
                    // The conversation was created but the reader switched away while it was being created.
                    return;
                }
            }
            if (!conversationId) { showToast('error', '创建对话失败，请重试'); return; }
            if (chatStreamManager.isConversationRunning(conversationId)) { showToast('info', '当前会话正在生成中，请稍后再试'); return; }

            const dreamInfo: DreamInterpretationInfo | undefined = isDreamMode ? {
                userName: user?.name || ANONYMOUS_DISPLAY_NAME,
                dreamDate: new Date().toISOString(),
                dreamContent: trimmedInput.slice(0, 50),
            } : undefined;

            const userMessage: ChatMessage = {
                id: Date.now().toString(), role: 'user', content: trimmedInput, createdAt: new Date().toISOString(),
                mentions: messageMentions.length ? [...messageMentions] : undefined,
                quotes: messageQuotes.length ? messageQuotes : undefined,
                attachments: (attachmentState.file || attachmentState.uploaded?.length || attachmentState.webSearchEnabled) ? { fileName: attachmentState.file?.name || attachmentState.uploaded?.map(item=>item.name).join('、') || '', ids: attachmentState.uploaded?.map(item=>item.id), webSearchEnabled: attachmentState.webSearchEnabled } : undefined,
                dreamInfo,
            };
            const newMessages = [...messages, userMessage];
            if (agent.mode === 'agent') {
                if (isCurrent()) setMessages(newMessages);
                try {
                    await agent.start(conversationId, userMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, attachment, imageModel, byokKeys: agentByokKeys(modelRefs) });
                    clearSubmittedDraft();
                } catch (error) {
                    if (isCurrent()) {
                        setMessages(messages);
                        void state.retryConversationLoad();
                    }
                    if (error instanceof AgentHttpError && error.status === 402) markBalanceExhausted(error.message);
                    else showToast('error', error instanceof Error ? error.message : '创建任务失败');
                }
                return;
            }
            const assistantMessageId = (Date.now() + 1).toString();
            const reply = replyModel(selectedModel);
            const initialAssistantMessage: ChatMessage = {
                id: assistantMessageId, role: 'assistant', content: '', createdAt: new Date().toISOString(), model: reply.model, modelName: reply.modelName,
            };
            const optimisticMessages = [...newMessages, initialAssistantMessage];
            setMessages(optimisticMessages);
            const saveSucceeded = await saveMessages(conversationId, newMessages, isNewConversation ? (draftTitle || undefined) : undefined);
            if (!saveSucceeded) {
                if (isNewConversation) await discardDraftConversation(conversationId);
                else if (conversationId === activeConversationIdRef.current) setMessages(messages);
                showToast('error', '保存对话失败，请重试');
                return;
            }
            clearSubmittedDraft();

            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            // 读取可视化设置
            const visualizationSettings = readLocalVisualizationSettings(localStorage);

            const startResult = await chatStreamManager.startTask({
                conversationId, requestHeaders: headers,
                requestBody: {
                    messages: newMessages,
                    personality: 'general',
                    conversationId,
                    stream: true,
                    model: selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: reasoningEnabled,
                    reasoningEffort: state.reasoningEffort,
                    attachment,
                    webSearch: attachmentState.webSearchEnabled || undefined,
                    mentions: messageMentions.map(m => ({ ...m })),
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings,
                    timezone: browserTimeZone(),
                },
                baseMessages: newMessages, assistantMessage: initialAssistantMessage, runner: reply.runner,
            });
            if (!startResult.ok) {
                if (conversationId === activeConversationIdRef.current) setMessages(newMessages);
                if (startResult.code === 'INSUFFICIENT_BALANCE') markBalanceExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('发送失败:', error);
            if (conversationId === activeConversationIdRef.current) {
                const errorMessage = unavailableReply('抱歉，服务暂时不可用。请稍后再试。');
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
        const modelRefs = usedModels();
        if (!ownModelsUsable(modelRefs)) return;
        if (!(await guardBalance())) return;
        const isTargetActive = agent.captureConversation(targetConversationId);
        const originalSnapshot = messages;
        const messageIndex = messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;

        const originalMessage = messages[messageIndex];
        const originalAiMessage = messages[messageIndex + 1];
        const previousMessages = messages.slice(0, messageIndex);
        const subsequentMessages = messages.slice(messageIndex + 2);

        // The branch being replaced is always re-captured from what is on screen, so later
        // follow-ups on it survive (same rule as agent_create_run on the server).
        const branch = captureCurrentBranch(originalMessage, originalAiMessage, subsequentMessages);
        const existingVersions = branch.versions;

        const messageMentions = sanitizeOutgoingMentions(Array.isArray(nextMentions) ? nextMentions : (originalMessage.mentions ?? []));
        const updatedUserMessage: ChatMessage = { ...originalMessage, content: newContent, mentions: messageMentions.length ? [...messageMentions] : undefined, versions: existingVersions, currentVersionIndex: branch.index };
        const newMessages = [...previousMessages, updatedUserMessage];
        if (agent.mode === 'agent') {
            // Server versions replace this optimistic slot when the run ends and the conversation reloads.
            const pending = withPendingVersion(branch, newContent, { attachments: originalMessage.attachments, mentions: updatedUserMessage.mentions });
            const runningUserMessage: ChatMessage = { ...updatedUserMessage, versions: pending.versions, currentVersionIndex: pending.index };
            if (isTargetActive()) setMessages([...previousMessages, runningUserMessage]);
            try { await agent.start(targetConversationId, runningUserMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, replaceFromMessageId: originalMessage.id, imageModel, byokKeys: agentByokKeys(modelRefs) }); }
            catch (error) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (error instanceof AgentHttpError && error.status === 402) markBalanceExhausted(error.message);
                else showToast('error', error instanceof Error ? error.message : '编辑失败');
            }
            return;
        }
        if (isTargetActive()) setMessages(newMessages);

        const assistantMessageId = (Date.now() + 1).toString();
        const reply = replyModel(selectedModel);
        const initialAssistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            model: reply.model,
            modelName: reply.modelName,
        };
        if (isTargetActive()) setMessages([...newMessages, initialAssistantMessage]);

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            const onBeforeSave = (finalMessages: ChatMessage[], assistantContent: string): ChatMessage[] => {
                const newVersion = { userContent: newContent, attachments: updatedUserMessage.attachments, mentions: messageMentions.length ? [...messageMentions] : undefined, aiContent: assistantContent || '抱歉，我暂时无法回答这个问题。', aiMessageId: initialAssistantMessage.id, aiModel: initialAssistantMessage.model, aiModelName: initialAssistantMessage.modelName, createdAt: new Date().toISOString() };
                const updatedVersions = [...existingVersions, newVersion];
                const finalUserMessage: ChatMessage = { ...updatedUserMessage, versions: updatedVersions, currentVersionIndex: updatedVersions.length - 1 };
                return finalMessages.map(msg => msg.id === updatedUserMessage.id ? finalUserMessage : msg);
            };

            const startResult = await chatStreamManager.startTask({
                conversationId: targetConversationId, requestHeaders: headers,
                requestBody: {
                    messages: newMessages,
                    personality: 'general',
                    conversationId: targetConversationId,
                    stream: true,
                    model: selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: reasoningEnabled,
                    reasoningEffort: state.reasoningEffort,
                    mentions: messageMentions,
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings: readLocalVisualizationSettings(localStorage),
                    timezone: browserTimeZone(),
                },
                baseMessages: newMessages, assistantMessage: initialAssistantMessage, onBeforeSave, runner: reply.runner,
            });
            if (!startResult.ok) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (startResult.code === 'INSUFFICIENT_BALANCE') markBalanceExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('编辑发送失败:', error);
            if (isTargetActive()) setMessages(prev => [...prev.slice(0, -1), unavailableReply('抱歉，服务暂时不可用。')]);
        }
    };

    // Regenerate AI response
    const handleRegenerateResponse = async (messageId: string) => {
        if (agent.active) { showToast('info', '请先停止当前任务，再重新生成'); return; }
        const targetConversationId = activeConversationIdRef.current;
        if (!targetConversationId) return;
        const modelRefs = usedModels();
        if (!ownModelsUsable(modelRefs)) return;
        if (!(await guardBalance())) return;
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
            // Keep the replaced reply as a version locally too; previously it vanished until reload.
            const pending = withPendingVersion(captureCurrentBranch(lastUserMessage, oldAiMessage, subsequentMessages), lastUserMessage.content, { attachments: lastUserMessage.attachments, mentions: lastUserMessage.mentions });
            const runningUserMessage: ChatMessage = { ...lastUserMessage, versions: pending.versions, currentVersionIndex: pending.index };
            if (isTargetActive()) setMessages(previousMessages.map(message => message.id === lastUserMessage.id ? runningUserMessage : message));
            try { await agent.start(targetConversationId, lastUserMessage, { model: selectedModel, reasoning: reasoningEnabled, mentions: messageMentions, replaceFromMessageId: lastUserMessage.id, imageModel, byokKeys: agentByokKeys(modelRefs) }); }
            catch (error) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (error instanceof AgentHttpError && error.status === 402) markBalanceExhausted(error.message);
                else showToast('error', error instanceof Error ? error.message : '重新生成失败');
            }
            return;
        }

        let updatedPreviousMessages = previousMessages;
        let existingVersions: NonNullable<ChatMessage['versions']> = [];
        if (lastUserMessage) {
            // An empty failed reply on an unversioned turn is not worth a version of its own.
            const branch = lastUserMessage.versions?.length || oldAiContent
                ? captureCurrentBranch(lastUserMessage, oldAiMessage, subsequentMessages)
                : { versions: [], index: -1 };
            existingVersions = branch.versions;
            const updatedUserMessage: ChatMessage = {
                ...lastUserMessage,
                mentions: messageMentions.length ? [...messageMentions] : undefined,
                versions: existingVersions,
                currentVersionIndex: branch.index < 0 ? undefined : branch.index,
            };
            updatedPreviousMessages = previousMessages.map(m => m.id === lastUserMessage.id ? updatedUserMessage : m);
        }

        const assistantMessageId = (Date.now() + 1).toString();
        const reply = replyModel(selectedModel);
        const initialAssistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            model: reply.model,
            modelName: reply.modelName,
        };
        if (isTargetActive()) setMessages([...updatedPreviousMessages, initialAssistantMessage]);

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            const onBeforeSave = lastUserMessage
                ? (finalMessages: ChatMessage[], assistantContent: string): ChatMessage[] => {
                    const newVersion = { userContent: lastUserMessage.content, attachments: lastUserMessage.attachments, mentions: messageMentions.length ? [...messageMentions] : undefined, aiContent: assistantContent || '抱歉，我暂时无法回答这个问题。', aiMessageId: initialAssistantMessage.id, aiModel: initialAssistantMessage.model, aiModelName: initialAssistantMessage.modelName, createdAt: new Date().toISOString() };
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
                    conversationId: targetConversationId,
                    stream: true,
                    model: selectedModel,
                    mangpaiMode: isMangpaiMode || undefined,
                    reasoning: reasoningEnabled,
                    reasoningEffort: state.reasoningEffort,
                    mentions: messageMentions,
                    dreamMode: isDreamMode || undefined,
                    visualizationSettings: readLocalVisualizationSettings(localStorage),
                    timezone: browserTimeZone(),
                },
                baseMessages: updatedPreviousMessages, assistantMessage: initialAssistantMessage, onBeforeSave, runner: reply.runner,
            });
            if (!startResult.ok) {
                if (isTargetActive()) setMessages(originalSnapshot);
                if (startResult.code === 'INSUFFICIENT_BALANCE') markBalanceExhausted(startResult.message);
                else showToast(startResult.code === 'CONVERSATION_BUSY' ? 'info' : 'error', startResult.message);
            }
        } catch (error) {
            console.error('重新生成失败:', error);
            if (isTargetActive()) setMessages(prev => [...prev.slice(0, -1), unavailableReply('抱歉，服务暂时不可用。')]);
        }
    };

    // Switch message version
    const handleSwitchVersion = useCallback((messageId: string, versionIndex: number) => {
        // A streaming reply would overwrite whichever branch is shown when it finishes.
        if (agent.active || isLoading) return;
        setMessages(prev => {
            const switched = switchToVersion(prev, messageId, versionIndex, sanitizeOutgoingMentions);
            if (!switched) return prev;
            if (userId && activeConversationId) void saveMessages(activeConversationId, switched);
            return switched;
        });
    }, [activeConversationId, agent.active, isLoading, sanitizeOutgoingMentions, saveMessages, setMessages, userId]);

    return {
        agent,
        handleQueueMessage,
        scrollToBottom,
        handleMessageListScroll,
        markBalanceExhausted,
        handleArchiveMessage,
        closeKbModal,
        handleStop,
        handleSend,
        handleImageGenerate,
        handleEditMessage,
        handleRegenerateResponse,
        handleSwitchVersion,
    };
}
