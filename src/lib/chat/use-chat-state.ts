/**
 * 对话管理状态 hook
 *
 * 管理当前对话、加载状态、消息、模型选择等。
 * 对话列表数据由全局 ConversationListContext 管理。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, Mention, Conversation, ConversationListItem, AIReasoningEffort } from '@/types';
import type { AgentCollaborator } from './model-settings';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import {
    loadConversation,
    saveConversation,
    DEFAULT_CONVERSATION_TITLE,
} from '@/lib/chat/conversation';
import { chatStreamManager } from '@/lib/chat/chat-stream-manager';
import {
    CHAT_CONVERSATION_DELETED_EVENT,
    CHAT_NEW_EVENT,
    useConversationList,
} from '@/lib/chat/ConversationListContext';
import type { AttachmentState } from '@/types';
import { useConversationDraft } from './use-conversation-draft';

export type ChatMode = 'normal' | 'dream' | 'mangpai';

type ConversationDetailOverrides = Partial<Pick<
    Conversation,
    'userId' | 'personality' | 'title' | 'createdAt' | 'updatedAt' | 'sourceType' | 'sourceData' | 'isArchived' | 'archivedKbIds'
>>;

export interface ChatStateReturn {
  // Conversation list (from global context)
  conversations: ConversationListItem[];
  setConversations: React.Dispatch<React.SetStateAction<ConversationListItem[]>>;
  conversationsLoading: boolean;
  conversationLoading: boolean;
  conversationError: string | null;
  hasLoadedConversations: boolean;
    setHasLoadedConversations: React.Dispatch<React.SetStateAction<boolean>>;
    pendingSidebarTitle: string | null;
    setPendingSidebarTitle: React.Dispatch<React.SetStateAction<string | null>>;

    // Active conversation
    activeConversationId: string | null;
    setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;
    activeConversationIdRef: React.MutableRefObject<string | null>;
    conversationValidatedRef: React.MutableRefObject<boolean>;
    conversationSelectRequestRef: React.MutableRefObject<number>;
    // Selection lifetime; reloading the same conversation does not invalidate it.
    conversationEpochRef: React.MutableRefObject<number>;
    bumpConversationEpoch: () => void;
    hasLoadedConversationsRef: React.MutableRefObject<boolean>;
    manualRenamedConversationIdsRef: React.MutableRefObject<Set<string>>;
    conversationsRef: React.MutableRefObject<ConversationListItem[]>;

    // Messages
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    moveDraft: (conversationId: string) => void;
    captureSubmittedDraft: (clearAttachment?: boolean) => () => void;
    isSendingToList: boolean;
    setIsSendingToList: React.Dispatch<React.SetStateAction<boolean>>;
    messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
    messageScrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
    shouldAutoScrollRef: React.MutableRefObject<boolean>;

    // Chat mode (normal / dream / mangpai)
    chatMode: ChatMode;
    setChatMode: React.Dispatch<React.SetStateAction<ChatMode>>;

    // Model & reasoning
    selectedModel: string;
    setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
    reasoningEnabled: boolean;
    setReasoningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    reasoningEffort: AIReasoningEffort | null;
    setReasoningEffort: React.Dispatch<React.SetStateAction<AIReasoningEffort | null>>;
    collaborators: AgentCollaborator[];
    setCollaborators: React.Dispatch<React.SetStateAction<AgentCollaborator[]>>;
    /** The image model for 生图 and the Agent's image tool; null until the menu picks the default. */
    imageModel: string | null;
    setImageModel: (model: string | null) => void;

    // Attachments & mentions
    attachmentState: AttachmentState;
    setAttachmentState: React.Dispatch<React.SetStateAction<AttachmentState>>;
    mentions: Mention[];
    setMentions: React.Dispatch<React.SetStateAction<Mention[]>>;

    // Knowledge base modal
    kbModalOpen: boolean;
    setKbModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    kbTargetMessage: ChatMessage | null;
    setKbTargetMessage: React.Dispatch<React.SetStateAction<ChatMessage | null>>;

    // Dream context (kept separate — only relevant when chatMode === 'dream')
    dreamContext: { baziChartName?: string; dailyFortune?: string } | undefined;
    setDreamContext: React.Dispatch<React.SetStateAction<{ baziChartName?: string; dailyFortune?: string } | undefined>>;
    dreamContextLoading: boolean;
    setDreamContextLoading: React.Dispatch<React.SetStateAction<boolean>>;

    // Streaming
    streamingConversationIds: Set<string>;
    setStreamingConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    isLoading: boolean;

    // Actions
  refreshConversationList: (targetUserId?: string | null, options?: { targetCount?: number }) => Promise<void>;
  triggerConversationListLoad: (targetCount?: number) => void;
  handleSelectConversation: (id: string, options?: { updateUrl?: boolean; forceReload?: boolean }) => Promise<void>;
  retryConversationLoad: () => Promise<void>;
  handleNewChat: () => Promise<void>;
    handleDeleteConversation: (id: string) => Promise<void>;
    handleRenameConversation: (id: string, title: string) => Promise<void>;
    saveMessages: (conversationId: string, newMessages: ChatMessage[], title?: string) => Promise<boolean | undefined>;
    cacheConversationDetail: (conversation: Conversation) => void;
    cacheConversationMessages: (conversationId: string, messages: ChatMessage[], overrides?: ConversationDetailOverrides) => void;
    removeConversationDetail: (conversationId: string) => void;
}

const imageModelKey = (userId: string) => `taibu.image-model:${userId}`;

/** The account's last image model on this device. */
function readImageModel(userId: string | null): string | null {
    if (!userId || typeof window === 'undefined') return null;
    try { return localStorage.getItem(imageModelKey(userId)) || null; } catch { return null; }
}

function writeImageModel(userId: string | null, model: string | null) {
    if (!userId) return;
    try {
        if (model) localStorage.setItem(imageModelKey(userId), model);
        else localStorage.removeItem(imageModelKey(userId));
    } catch { /* optional preference */ }
}

/** A forced reload of the conversation already validated on screen keeps its messages while fetching. */
export function isInPlaceReload({ forceReload, sameConversation, validated }: { forceReload?: boolean; sameConversation: boolean; validated: boolean }) {
    return forceReload === true && sameConversation && validated;
}

export function useChatState({
    userId,
    sessionLoading,
    bootstrapLoading,
    router,
    searchParams,
}: {
    userId: string | null;
    sessionLoading: boolean;
    bootstrapLoading: boolean;
    router: ReturnType<typeof import('next/navigation').useRouter>;
    searchParams: ReturnType<typeof import('next/navigation').useSearchParams>;
}): ChatStateReturn {
    // Get conversation list state from global context
    const convList = useConversationList();
    const {
        conversations,
        setConversations,
        conversationsLoading,
        hasLoadedConversations,
        setHasLoadedConversations,
        pendingSidebarTitle,
        setPendingSidebarTitle,
        refreshConversationList,
        triggerConversationListLoad,
        manualRenamedConversationIdsRef,
        conversationsRef,
    } = convList;

    // Active conversation state (local to chat page)
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const conversationEpochRef = useRef(0);
    const bumpConversationEpoch = useCallback(() => { conversationEpochRef.current += 1; }, []);
    const [conversationLoading, setConversationLoading] = useState(false);
    const [conversationError, setConversationError] = useState<string | null>(null);

    // Messages state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const { inputValue, setInputValue, mentions, setMentions, attachmentState, setAttachmentState, removeDraft, moveDraft, captureSubmittedDraft } = useConversationDraft(userId, activeConversationId);
    const [isSendingToList, setIsSendingToList] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messageScrollContainerRef = useRef<HTMLDivElement | null>(null);
    const shouldAutoScrollRef = useRef(true);
    const activeConversationIdRef = useRef<string | null>(null);
    const hasLoadedConversationsRef = useRef(false);
    const conversationSelectRequestRef = useRef(0);
    const conversationValidatedRef = useRef(false);
    const conversationDetailsRef = useRef<Map<string, Conversation>>(new Map());

    // Chat mode
    const [chatMode, setChatMode] = useState<ChatMode>('normal');

    // Model & reasoning
    const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [analysisSettings, setAnalysisSettings] = useState<{ owner: string | null; reasoningEffort: AIReasoningEffort | null; collaborators: AgentCollaborator[] }>({ owner: userId, reasoningEffort: null, collaborators: [] });
    const reasoningEffort = analysisSettings.owner === userId ? analysisSettings.reasoningEffort : null;
    const collaborators = analysisSettings.owner === userId ? analysisSettings.collaborators : [];
    const setReasoningEffort = useCallback((value: React.SetStateAction<AIReasoningEffort | null>) => setAnalysisSettings(previous => ({
        owner: userId,
        reasoningEffort: typeof value === 'function' ? value(previous.owner === userId ? previous.reasoningEffort : null) : value,
        collaborators: previous.owner === userId ? previous.collaborators : [],
    })), [userId]);
    const setCollaborators = useCallback((value: React.SetStateAction<AgentCollaborator[]>) => setAnalysisSettings(previous => ({
        owner: userId,
        reasoningEffort: previous.owner === userId ? previous.reasoningEffort : null,
        collaborators: typeof value === 'function' ? value(previous.owner === userId ? previous.collaborators : []) : value,
    })), [userId]);
    const [imageModelChoice, setImageModelChoice] = useState(() => ({ owner: userId, model: readImageModel(userId) }));
    // React's documented "adjust state during render": the choice belongs to the signed-in account.
    if (imageModelChoice.owner !== userId) setImageModelChoice({ owner: userId, model: readImageModel(userId) });
    const imageModel = imageModelChoice.owner === userId ? imageModelChoice.model : null;
    const setImageModel = useCallback((model: string | null) => {
        setImageModelChoice({ owner: userId, model });
        writeImageModel(userId, model);
    }, [userId]);

    // Attachments & mentions
    const [kbModalOpen, setKbModalOpen] = useState(false);
    const [kbTargetMessage, setKbTargetMessage] = useState<ChatMessage | null>(null);

    // Dream context
    const [dreamContext, setDreamContext] = useState<{ baziChartName?: string; dailyFortune?: string } | undefined>(undefined);
    const [dreamContextLoading, setDreamContextLoading] = useState(false);

    // Streaming state
    const [streamingConversationIds, setStreamingConversationIds] = useState<Set<string>>(new Set());
    const isLoading = activeConversationId ? streamingConversationIds.has(activeConversationId) : false;

    // Sync refs
    useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);
    useEffect(() => { hasLoadedConversationsRef.current = hasLoadedConversations; }, [hasLoadedConversations]);

    const buildConversationDetail = useCallback((
        conversationId: string,
        messagesToCache: ChatMessage[],
        overrides: ConversationDetailOverrides = {},
    ): Conversation => {
        const existing = conversationDetailsRef.current.get(conversationId) ?? null;
        const listItem = conversationsRef.current.find((conversation) => conversation.id === conversationId) ?? null;
        const nowIso = new Date().toISOString();

        return {
            id: conversationId,
            userId: overrides.userId ?? existing?.userId ?? listItem?.userId,
            personality: overrides.personality ?? existing?.personality ?? listItem?.personality ?? 'general',
            title: overrides.title ?? existing?.title ?? listItem?.title ?? DEFAULT_CONVERSATION_TITLE,
            messages: messagesToCache,
            createdAt: overrides.createdAt ?? existing?.createdAt ?? listItem?.createdAt ?? nowIso,
            updatedAt: overrides.updatedAt ?? existing?.updatedAt ?? listItem?.updatedAt ?? nowIso,
            sourceType: overrides.sourceType ?? existing?.sourceType ?? listItem?.sourceType ?? 'chat',
            sourceData: overrides.sourceData ?? existing?.sourceData,
            isArchived: overrides.isArchived ?? existing?.isArchived ?? listItem?.isArchived ?? false,
            archivedKbIds: overrides.archivedKbIds ?? existing?.archivedKbIds ?? listItem?.archivedKbIds ?? [],
        };
    }, [conversationsRef]);

    const cacheConversationDetail = useCallback((conversation: Conversation) => {
        conversationDetailsRef.current.set(conversation.id, conversation);
    }, []);

    const cacheConversationMessages = useCallback((
        conversationId: string,
        messagesToCache: ChatMessage[],
        overrides: ConversationDetailOverrides = {},
    ) => {
        conversationDetailsRef.current.set(
            conversationId,
            buildConversationDetail(conversationId, messagesToCache, overrides),
        );
    }, [buildConversationDetail]);

    const removeConversationDetail = useCallback((conversationId: string) => {
        conversationDetailsRef.current.delete(conversationId);
    }, []);

    const resetDeletedConversationState = useCallback((conversationId: string) => {
        removeDraft(conversationId);
        removeConversationDetail(conversationId);
        if (
            activeConversationIdRef.current !== conversationId
            && searchParams.get('id') !== conversationId
        ) {
            return;
        }

        conversationEpochRef.current += 1;
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setConversationLoading(false);
        setConversationError(null);
        setMessages([]);
        conversationValidatedRef.current = false;
        if (searchParams.get('id') === conversationId) {
            router.replace('/chat');
        }
    }, [removeConversationDetail, removeDraft, router, searchParams]);

    // Init: reset on logout
    useEffect(() => {
        if (sessionLoading || bootstrapLoading) return;
        if (!userId) {
            setMessages([]); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: reset on logout
            activeConversationIdRef.current = null;
            conversationEpochRef.current += 1;
            conversationSelectRequestRef.current += 1;
            setConversationLoading(false);
            setConversationError(null);
            setActiveConversationId(null);
            conversationDetailsRef.current.clear();
        }
    }, [bootstrapLoading, sessionLoading, userId]);

    // Select conversation
    const handleSelectConversation = useCallback(async (
        id: string,
        options?: { updateUrl?: boolean; forceReload?: boolean }
    ) => {
        // Refreshing the conversation already on screen (e.g. after an Agent run) keeps the
        // visible messages until the server copy arrives: the detail cache can still hold
        // the pre-edit transcript, and a failed reload must not leave that on screen.
        const inPlace = isInPlaceReload({ forceReload: options?.forceReload, sameConversation: activeConversationIdRef.current === id, validated: conversationValidatedRef.current });
        if (!inPlace) shouldAutoScrollRef.current = true;
        const requestId = conversationSelectRequestRef.current + 1;
        conversationSelectRequestRef.current = requestId;

        if (activeConversationIdRef.current !== id) conversationEpochRef.current += 1;
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setConversationError(null);
        conversationValidatedRef.current = inPlace;

        const runningMessages = chatStreamManager.getTaskMessages(id);
        // In-place reloads keep the current transcript; the fetch below replaces it.
        if (!inPlace && runningMessages) {
            setConversationLoading(false);
            setMessages(runningMessages);
            conversationValidatedRef.current = true;
        } else if (!inPlace) {
            const cachedConversation = conversationDetailsRef.current.get(id);
            const cachedMessages = cachedConversation?.messages || [];
            // An owned, loaded conversation with zero messages is valid too.
            // Treating it as missing while skipping its cached fetch leaves the
            // loading flag stuck and prevents Agent restoration on return.
            const hasCachedDetail = !!cachedConversation;
            setConversationLoading(!hasCachedDetail);
            setMessages(cachedMessages);
            if (hasCachedDetail) {
                conversationValidatedRef.current = true;
            }
        }

        if (options?.updateUrl !== false && searchParams.get('id') !== id) {
            router.replace(`/chat?id=${id}`);
        }

        if (!options?.forceReload && (runningMessages || conversationDetailsRef.current.has(id))) {
            return;
        }

        const conv = await loadConversation(id);
        if (requestId !== conversationSelectRequestRef.current) return;
        setConversationLoading(false);
        if (!conv.ok) {
            if (!conv.notFound) {
                setConversationError(conv.error);
                return;
            }
            activeConversationIdRef.current = null;
            conversationEpochRef.current += 1;
            setConversationLoading(false);
            setActiveConversationId(null);
            setMessages([]);
            removeConversationDetail(id);
            conversationValidatedRef.current = false;
            router.replace('/chat');
            return;
        }

        conversationValidatedRef.current = true;
        cacheConversationDetail(conv.conversation);
        const taskMessages = chatStreamManager.getTaskMessages(id);
        const sourceMessages = taskMessages || conv.conversation.messages;
        setMessages(sourceMessages);
    }, [cacheConversationDetail, removeConversationDetail, router, searchParams]);

    const retryConversationLoad = useCallback(async () => {
        const targetId = activeConversationIdRef.current;
        if (!targetId) return;
        await handleSelectConversation(targetId, {
            updateUrl: false,
            forceReload: true,
        });
    }, [handleSelectConversation]);

    // New chat
    const handleNewChat = useCallback(async () => {
        shouldAutoScrollRef.current = true;
        conversationSelectRequestRef.current += 1;
        conversationEpochRef.current += 1;
        activeConversationIdRef.current = null;
        setConversationLoading(false);
        setConversationError(null);
        setActiveConversationId(null);
        setMessages([]);
        conversationValidatedRef.current = false;
        setChatMode('normal');
        if (searchParams.get('id')) {
            router.replace('/chat');
        }
    }, [router, searchParams]);

    // URL-based conversation selection
    useEffect(() => {
        if (!userId) return;
        const targetConversationId = searchParams.get('id');
        if (!targetConversationId) {
            if (activeConversationIdRef.current !== null) {
                queueMicrotask(() => {
                    void handleNewChat();
                });
            }
            return;
        }
        if (targetConversationId === activeConversationIdRef.current) return;
        queueMicrotask(() => {
            void handleSelectConversation(targetConversationId, { updateUrl: false });
        });
    }, [handleNewChat, handleSelectConversation, searchParams, userId]);

    // Handle global new chat signal
    useEffect(() => {
        const handler = () => {
            void handleNewChat();
        };
        window.addEventListener(CHAT_NEW_EVENT, handler);
        return () => window.removeEventListener(CHAT_NEW_EVENT, handler);
    }, [handleNewChat]);

    useEffect(() => {
        const handler = (event: Event) => {
            const deletedConversationId = (event as CustomEvent<{ id?: string }>).detail?.id;
            if (!deletedConversationId) {
                return;
            }
            resetDeletedConversationState(deletedConversationId);
        };

        window.addEventListener(CHAT_CONVERSATION_DELETED_EVENT, handler as EventListener);
        return () => window.removeEventListener(CHAT_CONVERSATION_DELETED_EVENT, handler as EventListener);
    }, [resetDeletedConversationState]);

    // Delete conversation — delegate to context, clean up local active state
    const handleDeleteConversation = useCallback(async (id: string) => {
        const success = await convList.handleDeleteConversation(id);
        if (!success) {
            return;
        }
        resetDeletedConversationState(id);
    }, [convList, resetDeletedConversationState]);

    // Rename conversation — delegate to context
    const handleRenameConversation = useCallback(async (id: string, title: string) => {
        const success = await convList.handleRenameConversation(id, title);
        if (!success) {
            return;
        }

        const existing = conversationDetailsRef.current.get(id);
        if (existing) {
            conversationDetailsRef.current.set(id, {
                ...existing,
                title,
            });
        }
    }, [convList]);

    // Save messages
    const saveMessagesAction = useCallback(async (conversationId: string, newMessages: ChatMessage[], title?: string) => {
        if (!userId) return false;
        const success = await saveConversation(conversationId, newMessages, title);
        if (success) {
            cacheConversationMessages(conversationId, newMessages, {
                title,
                updatedAt: new Date().toISOString(),
                userId,
            });
        }
        return success;
    }, [cacheConversationMessages, userId]);

    return {
        conversations, setConversations,
        conversationsLoading, conversationLoading, conversationError, hasLoadedConversations, setHasLoadedConversations,
        pendingSidebarTitle, setPendingSidebarTitle,
        activeConversationId, setActiveConversationId,
        activeConversationIdRef, conversationValidatedRef,
        conversationSelectRequestRef, conversationEpochRef, bumpConversationEpoch, hasLoadedConversationsRef,
        manualRenamedConversationIdsRef, conversationsRef,
        messages, setMessages,
        inputValue, setInputValue,
        moveDraft, captureSubmittedDraft,
        isSendingToList, setIsSendingToList,
        messagesEndRef, messageScrollContainerRef, shouldAutoScrollRef,
        chatMode, setChatMode,
        selectedModel, setSelectedModel,
        reasoningEnabled, setReasoningEnabled,
        reasoningEffort, setReasoningEffort, collaborators, setCollaborators,
        imageModel,
        setImageModel,
        attachmentState, setAttachmentState,
        mentions, setMentions,
        kbModalOpen, setKbModalOpen,
        kbTargetMessage, setKbTargetMessage,
        dreamContext, setDreamContext,
        dreamContextLoading, setDreamContextLoading,
        streamingConversationIds, setStreamingConversationIds,
        isLoading,
        refreshConversationList,
        triggerConversationListLoad,
        handleSelectConversation,
        retryConversationLoad,
        handleNewChat,
        handleDeleteConversation,
        handleRenameConversation,
        saveMessages: saveMessagesAction,
        cacheConversationDetail,
        cacheConversationMessages,
        removeConversationDetail,
    };
}
