/**
 * 全局对话列表 Context
 *
 * 从 useChatState 提取对话列表管理逻辑，使主侧边栏在所有页面
 * 都能展示对话列表。仅登录用户才加载数据。
 *
 * 'use client' 标记说明：
 * - 使用 React hooks 管理全局对话列表状态
 */
'use client';

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { createConversationListCache, EMPTY_CONVERSATIONS } from '@/lib/query/conversation-list-cache';
import type { ConversationListItem } from '@/types';
import {
  CONVERSATION_PAGE_SIZE,
  loadConversations,
  loadConversationWindow,
  deleteConversation,
  renameConversation,
} from '@/lib/chat/conversation';
import { normalizeConversationWindowTargetCount } from '@/lib/chat/conversation-list-window';
import {
  HISTORY_SUMMARY_DELETED_EVENT,
  KNOWLEDGE_BASE_SYNC_EVENT,
} from '@/lib/browser-api';
import { useSessionSafe } from '@/lib/hooks/session-context';

export const CHAT_CONVERSATION_DELETED_EVENT = 'taibu:chat:conversation-deleted';
export const CHAT_NEW_EVENT = 'taibu:chat:new';

interface ConversationListContextType {
  conversations: ConversationListItem[];
  setConversations: React.Dispatch<React.SetStateAction<ConversationListItem[]>>;
  conversationsLoading: boolean;
  loadingMoreConversations: boolean;
  hasLoadedConversations: boolean;
  hasMoreConversations: boolean;
  conversationListError: string | null;
  setHasLoadedConversations: React.Dispatch<React.SetStateAction<boolean>>;
  pendingSidebarTitle: string | null;
  setPendingSidebarTitle: React.Dispatch<React.SetStateAction<string | null>>;
  refreshConversationList: (
    targetUserId?: string | null,
    options?: { targetCount?: number },
  ) => Promise<void>;
  retryConversationListLoad: () => Promise<void>;
  triggerConversationListLoad: (targetCount?: number) => void;
  loadMoreConversations: () => Promise<void>;
  removeConversationFromList: (id: string) => boolean;
  handleDeleteConversation: (id: string) => Promise<boolean>;
  handleRenameConversation: (id: string, title: string) => Promise<boolean>;
  handleNewChat: () => Promise<void>;
  manualRenamedConversationIdsRef: React.MutableRefObject<Set<string>>;
  conversationsRef: React.MutableRefObject<ConversationListItem[]>;
}

const ConversationListContext = createContext<ConversationListContextType | undefined>(undefined);

function mergeConversations(current: ConversationListItem[], incoming: ConversationListItem[]) {
  if (incoming.length === 0) {
    return current;
  }

  const merged = current.slice();
  const indexById = new Map(current.map((conversation, index) => [conversation.id, index] as const));
  let changed = false;

  for (const conversation of incoming) {
    const index = indexById.get(conversation.id);
    if (index == null) {
      indexById.set(conversation.id, merged.length);
      merged.push(conversation);
      changed = true;
      continue;
    }

    merged[index] = {
      ...merged[index],
      ...conversation,
    };
    changed = true;
  }

  return changed ? merged : current;
}

function preserveManualConversationTitles(
  current: ConversationListItem[],
  incoming: ConversationListItem[],
  manualRenamedIds: Set<string>,
) {
  if (incoming.length === 0 || manualRenamedIds.size === 0) {
    return incoming;
  }

  const currentById = new Map(current.map((conversation) => [conversation.id, conversation] as const));
  return incoming.map((conversation) => {
    if (!manualRenamedIds.has(conversation.id)) {
      return conversation;
    }

    const currentConversation = currentById.get(conversation.id);
    if (!currentConversation) {
      return conversation;
    }

    if (currentConversation.title === conversation.title) {
      manualRenamedIds.delete(conversation.id);
      return conversation;
    }

    return {
      ...conversation,
      title: currentConversation.title,
    };
  });
}

export function ConversationListProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useSessionSafe();
  const userId = user?.id ?? null;

  const queryClient = useQueryClient();
  const accountScope = useMemo(() => ({ userId }), [userId]);
  const accountScopeRef = useRef<typeof accountScope | null>(accountScope);
  useLayoutEffect(() => { accountScopeRef.current = accountScope; }, [accountScope]);
  const conversationCache = useMemo(() => createConversationListCache(
    queryClient,
    userId,
    () => accountScopeRef.current === accountScope,
  ), [accountScope, queryClient, userId]);
  // Deliberately disabled: existing idle/window/stream triggers own fetching.
  const { data } = useQuery<ConversationListItem[]>({
    queryKey: conversationCache.queryKey,
    queryFn: skipToken,
    enabled: false,
  });
  const conversations = userId ? data ?? EMPTY_CONVERSATIONS : EMPTY_CONVERSATIONS;
  const setConversations = conversationCache.update;
  const conversationsRef = conversationCache.ref;
  useEffect(() => () => {
    if (conversationCache.isCurrent()) {
      accountScopeRef.current = null;
      activeRequestIdRef.current += 1;
      requestControllerRef.current?.abort();
    }
    conversationCache.clear();
  }, [conversationCache]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [refreshingConversations, setRefreshingConversations] = useState(false);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [conversationListError, setConversationListError] = useState<string | null>(null);
  const [pendingSidebarTitle, setPendingSidebarTitle] = useState<string | null>(null);

  const manualRenamedConversationIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);
  const userIdRef = useRef<string | null>(userId);
  const nextOffsetRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef(0);
  const prevUserIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const idleCallbackHandleRef = useRef<number | null>(null);
  const idleTimeoutHandleRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => { hasLoadedRef.current = hasLoadedConversations; }, [hasLoadedConversations]);
  useLayoutEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => {
    loadingRef.current = conversationsLoading || refreshingConversations;
  }, [conversationsLoading, refreshingConversations]);
  useEffect(() => { loadingMoreRef.current = loadingMoreConversations; }, [loadingMoreConversations]);

  const clearScheduledIdleLoad = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (idleCallbackHandleRef.current !== null && 'cancelIdleCallback' in window) {
      (window as Window & {
        cancelIdleCallback: (handle: number) => void;
      }).cancelIdleCallback(idleCallbackHandleRef.current);
      idleCallbackHandleRef.current = null;
    }

    if (idleTimeoutHandleRef.current !== null) {
      window.clearTimeout(idleTimeoutHandleRef.current);
      idleTimeoutHandleRef.current = null;
    }
  }, []);

  const resetConversationState = useCallback(() => {
    activeRequestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    nextOffsetRef.current = null;
    hasLoadedRef.current = false;
    loadingRef.current = false;
    loadingMoreRef.current = false;
    setConversations([]);
    setConversationsLoading(false);
    setRefreshingConversations(false);
    setLoadingMoreConversations(false);
    setHasLoadedConversations(false);
    setHasMoreConversations(false);
    setConversationListError(null);
    setPendingSidebarTitle(null);
    manualRenamedConversationIdsRef.current.clear();
  }, [setConversations]);

  const requestConversationPage = useCallback(async ({
    targetUserId,
    offset,
    append,
  }: {
    targetUserId: string;
    offset: number;
    append: boolean;
  }) => {
    if (!conversationCache.isCurrent() || targetUserId !== userIdRef.current) return false;
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    if (append) {
      setLoadingMoreConversations(true);
    } else {
      setConversationsLoading(true);
    }

    try {
      const payload = await loadConversations({
        limit: CONVERSATION_PAGE_SIZE,
        offset,
        signal: controller.signal,
      });

      if (
        !payload
        || !conversationCache.isCurrent()
        || controller.signal.aborted
        || activeRequestIdRef.current !== requestId
        || userIdRef.current !== targetUserId
      ) {
        return false;
      }

      nextOffsetRef.current = payload.pagination.nextOffset;
      setHasMoreConversations(payload.pagination.hasMore);
      setHasLoadedConversations(true);
      setConversationListError(null);
      setConversations((current) => (
        append
          ? mergeConversations(current, payload.conversations)
          : payload.conversations
      ));

      return true;
    } catch (error) {
      if (
        conversationCache.isCurrent()
        && activeRequestIdRef.current === requestId
        && !controller.signal.aborted
        && !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        console.error('[conversation] 对话列表分页加载失败', error);
        setConversationListError(error instanceof Error ? error.message : '加载对话列表失败');
      }
      return false;
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }

      if (conversationCache.isCurrent() && activeRequestIdRef.current === requestId) {
        if (append) {
          setLoadingMoreConversations(false);
        } else {
          setConversationsLoading(false);
        }
      }
    }
  }, [conversationCache, setConversations]);

  const refreshConversationList = useCallback(async (
    targetUserId?: string | null,
    options: { targetCount?: number } = {},
  ) => {
    const id = targetUserId ?? userId;
    if (!id || !conversationCache.isCurrent() || id !== userIdRef.current) return;

    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const shouldShowBlockingLoader = !hasLoadedRef.current || conversationsRef.current.length === 0;
    if (shouldShowBlockingLoader) {
      setConversationsLoading(true);
    } else {
      setRefreshingConversations(true);
    }

    try {
      const loadedCount = conversationsRef.current.length;
      const loadedConversationIds = conversationsRef.current.map((conversation) => conversation.id);
      const requestedWindowCount = normalizeConversationWindowTargetCount({
        loadedCount,
        requestedCount: options.targetCount,
        fallbackCount: CONVERSATION_PAGE_SIZE,
      });
      const payload = await loadConversationWindow({
        targetCount: requestedWindowCount,
        preserveIds: loadedConversationIds,
        pageSize: CONVERSATION_PAGE_SIZE,
        signal: controller.signal,
      });

      if (
        !payload
        || !conversationCache.isCurrent()
        || controller.signal.aborted
        || activeRequestIdRef.current !== requestId
        || userIdRef.current !== id
      ) {
        return;
      }

      nextOffsetRef.current = payload.pagination.nextOffset;
      setHasMoreConversations(payload.pagination.hasMore);
      setHasLoadedConversations(true);
      setConversationListError(null);
      setConversations(preserveManualConversationTitles(
        conversationsRef.current,
        payload.conversations,
        manualRenamedConversationIdsRef.current,
      ));
    } catch (error) {
      if (
        conversationCache.isCurrent()
        && activeRequestIdRef.current === requestId
        && !controller.signal.aborted
        && !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        console.error('[conversation] 对话列表刷新失败', error);
        setConversationListError(error instanceof Error ? error.message : '加载对话列表失败');
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }

      if (conversationCache.isCurrent() && activeRequestIdRef.current === requestId) {
        if (shouldShowBlockingLoader) {
          setConversationsLoading(false);
        } else {
          setRefreshingConversations(false);
        }
      }
    }
  }, [conversationCache, conversationsRef, setConversations, userId]);

  const triggerConversationListLoad = useCallback((targetCount?: number) => {
    if (!userId || loadingRef.current || loadingMoreRef.current) {
      return;
    }

    if (hasLoadedRef.current) {
      const currentWindowCount = conversationsRef.current.length;
      const requestedWindowCount = normalizeConversationWindowTargetCount({
        loadedCount: currentWindowCount,
        requestedCount: targetCount,
        fallbackCount: CONVERSATION_PAGE_SIZE,
      });

      if (currentWindowCount >= requestedWindowCount || !hasMoreConversations) {
        return;
      }
    }

    void refreshConversationList(userId, { targetCount });
  }, [conversationsRef, hasMoreConversations, refreshConversationList, userId]);

  const retryConversationListLoad = useCallback(async () => {
    if (!userId) return;
    await refreshConversationList(userId);
  }, [refreshConversationList, userId]);

  const loadMoreConversations = useCallback(async () => {
    if (
      !userId
      || !hasLoadedRef.current
      || !hasMoreConversations
      || nextOffsetRef.current == null
      || loadingRef.current
      || loadingMoreRef.current
    ) {
      return;
    }

    await requestConversationPage({
      targetUserId: userId,
      offset: nextOffsetRef.current,
      append: true,
    });
  }, [hasMoreConversations, requestConversationPage, userId]);

  const removeConversationFromList = useCallback((id: string) => {
    let removed = false;
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== id);
      removed = next.length !== current.length;
      return removed ? next : current;
    });
    if (removed) {
      nextOffsetRef.current = nextOffsetRef.current == null ? null : Math.max(nextOffsetRef.current - 1, 0);
    }
    return removed;
  }, [setConversations]);

  const broadcastConversationDeleted = useCallback((id: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.dispatchEvent(new CustomEvent(CHAT_CONVERSATION_DELETED_EVENT, {
      detail: { id },
    }));
  }, []);

  // Reset state when the active auth user changes.
  useEffect(() => {
    if (sessionLoading) return;

    if (prevUserIdRef.current === userId) {
      return;
    }

    prevUserIdRef.current = userId;
    clearScheduledIdleLoad();
    resetConversationState();
  }, [clearScheduledIdleLoad, resetConversationState, sessionLoading, userId]);

  // Preload the first page after sign-in, regardless of the current route.
  useEffect(() => {
    clearScheduledIdleLoad();

    if (
      sessionLoading
      || !userId
      || hasLoadedRef.current
    ) {
      return;
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleCallbackHandleRef.current = (
        window as Window & { requestIdleCallback: (cb: () => void) => number }
      ).requestIdleCallback(() => {
        idleCallbackHandleRef.current = null;
        triggerConversationListLoad();
      });
      return clearScheduledIdleLoad;
    }

    idleTimeoutHandleRef.current = globalThis.setTimeout(() => {
      idleTimeoutHandleRef.current = null;
      triggerConversationListLoad();
    }, 1200);

    return clearScheduledIdleLoad;
  }, [clearScheduledIdleLoad, sessionLoading, triggerConversationListLoad, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleHistorySummaryDeleted = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string | null }>).detail?.conversationId;
      if (!conversationId) {
        return;
      }

      if (removeConversationFromList(conversationId)) {
        broadcastConversationDeleted(conversationId);
      }
    };

    window.addEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
    return () => {
      window.removeEventListener(HISTORY_SUMMARY_DELETED_EVENT, handleHistorySummaryDeleted as EventListener);
    };
  }, [broadcastConversationDeleted, removeConversationFromList]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKnowledgeBaseSync = (event: Event) => {
      const pathname = (event as CustomEvent<{ pathname?: string }>).detail?.pathname;
      if (
        pathname
        && !pathname.startsWith('/api/knowledge-base/ingest')
        && !pathname.startsWith('/api/knowledge-base/archive')
      ) {
        return;
      }

      const targetUserId = userIdRef.current;
      if (!targetUserId) {
        return;
      }

      void refreshConversationList(targetUserId);
    };

    window.addEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleKnowledgeBaseSync as EventListener);
    return () => {
      window.removeEventListener(KNOWLEDGE_BASE_SYNC_EVENT, handleKnowledgeBaseSync as EventListener);
    };
  }, [refreshConversationList]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (!conversationCache.isCurrent()) return false;
    const previousConversations = conversationsRef.current;
    const previousNextOffset = nextOffsetRef.current;
    const removed = removeConversationFromList(id);
    const success = await deleteConversation(id);
    if (!conversationCache.isCurrent()) return success;
    if (!success) {
      if (removed) {
        setConversations(previousConversations);
        nextOffsetRef.current = previousNextOffset;
      }
      return false;
    }

    if (removed) {
      broadcastConversationDeleted(id);
    }
    return true;
  }, [broadcastConversationDeleted, conversationCache, conversationsRef, removeConversationFromList, setConversations]);

  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    if (!conversationCache.isCurrent()) return false;
    manualRenamedConversationIdsRef.current.add(id);
    const previousConversations = conversationsRef.current;
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
    const success = await renameConversation(id, title);
    if (!conversationCache.isCurrent()) return success;
    if (!success) {
      manualRenamedConversationIdsRef.current.delete(id);
      setConversations(previousConversations);
      return false;
    }
    return true;
  }, [conversationCache, conversationsRef, setConversations]);

  const handleNewChat = useCallback(async () => {
    window.dispatchEvent(new CustomEvent(CHAT_NEW_EVENT));
  }, []);

  return (
    <ConversationListContext.Provider value={{
      conversations,
      setConversations,
      conversationsLoading,
      loadingMoreConversations,
      hasLoadedConversations,
      hasMoreConversations,
      conversationListError,
      setHasLoadedConversations,
      pendingSidebarTitle,
      setPendingSidebarTitle,
      refreshConversationList,
      retryConversationListLoad,
      triggerConversationListLoad,
      loadMoreConversations,
      removeConversationFromList,
      handleDeleteConversation,
      handleRenameConversation,
      handleNewChat,
      manualRenamedConversationIdsRef,
      conversationsRef,
    }}>
      {children}
    </ConversationListContext.Provider>
  );
}

export function useConversationList() {
  const ctx = useContext(ConversationListContext);
  if (!ctx) {
    throw new Error('useConversationList must be used within ConversationListProvider');
  }
  return ctx;
}
