/**
 * ChatComposer 共享状态 hook
 *
 * 集中管理 ChatComposer 内部的 useState，
 * 按职责分组导出给各子组件使用。
 */
import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import type { Mention, PromptLayerDiagnostic } from '@/types';
import type { MembershipType } from '@/lib/user/membership';
import { DEFAULT_MODEL_ID } from '@/lib/ai/ai-config';
import { DATA_INDEX_INVALIDATED_EVENT } from '@/lib/browser-api';
import { readLocalCache, removeLocalCache, writeLocalCache } from '@/lib/cache/local-storage';
import { shouldRequestChatPreview } from '@/lib/chat/chat-preview';
import { formatPromptLayerLabel } from '@/lib/chat/prompt-labels';
import { mentionTypeLabels } from '@/components/chat/mentionStyles';
import {
    listKnowledgeBases,
    type KnowledgeBaseSummary as BrowserKnowledgeBaseSummary,
} from '@/lib/knowledge-base/browser-client';
import type { DataSourceType, DataSourceSummary, DataSourceLoadError } from '@/lib/data-sources/types';
import { filterMentionsByFeature } from '@/lib/data-sources/catalog';
import type { ChatMode } from '@/lib/chat/use-chat-state';

export type KnowledgeBaseSummary =
    Pick<BrowserKnowledgeBaseSummary, 'id' | 'name' | 'description'>
    & Partial<Omit<BrowserKnowledgeBaseSummary, 'id' | 'name' | 'description'>>;

/** 缓存 TTL：10 分钟 */
const MENTION_CACHE_TTL_MS = 10 * 60 * 1000;

function getMentionCacheKeys(userId: string) {
    return {
        dataKey: `taibu.data_sources.${userId}.v1`,
        legacyDataKey: `mingai.data_sources.${userId}.v1`,
        kbKey: `taibu.knowledge_bases.${userId}.v1`,
        legacyKbKey: `mingai.knowledge_bases.${userId}.v1`,
    };
}

export interface UseComposerStateOptions {
    agentMode?: boolean;
    userId?: string | null;
    membershipType?: MembershipType;
    selectedModel?: string;
    reasoningEnabled?: boolean;
    mentions?: Mention[];
    contextMessages?: Array<{ content?: string }>;
    isLoading: boolean;
    isSendingToList?: boolean;
    chatMode?: ChatMode;
    knowledgeBaseEnabled?: boolean;
    promptKnowledgeBases?: KnowledgeBaseSummary[];
    enabledDataSourceTypes?: readonly DataSourceType[];
}

export function useComposerState(opts: UseComposerStateOptions) {
    const {
        agentMode = false,
        userId,
        membershipType = 'free',
        selectedModel = DEFAULT_MODEL_ID,
        reasoningEnabled = false,
        mentions = [],
        contextMessages = [],
        isLoading,
        isSendingToList = false,
        chatMode = 'normal',
        knowledgeBaseEnabled = true,
        promptKnowledgeBases = [],
        enabledDataSourceTypes = [],
    } = opts;

    // --- Refs ---
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const previewRequestIdRef = useRef(0);
    const mentionLifecycle = useRef<{ identity: string; userId: string | null; controller: AbortController } | null>(null);
    const mentionRequest = useRef<AbortController | null>(null);
    const [mentionOwnerIdentity, setMentionOwnerIdentity] = useState<string | null>(null);

    // --- Mention state ---
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
    const [mentionDataSources, setMentionDataSources] = useState<DataSourceSummary[]>([]);
    const [mentionKnowledgeBases, setMentionKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
    const [mentionLoadError, setMentionLoadError] = useState<string | null>(null);
    const [mentionDataSourceErrors, setMentionDataSourceErrors] = useState<DataSourceLoadError[]>([]);
    const [mentionLoading, setMentionLoading] = useState(false);
    const [mentionDefaultCategory, setMentionDefaultCategory] = useState<'knowledge' | 'data' | null>(null);

    // --- Knowledge base state ---
    const [knowledgeBaseOpen, setKnowledgeBaseOpen] = useState(false);
    const [knowledgeBaseSavingId, setKnowledgeBaseSavingId] = useState<string | null>(null);

    // --- Prompt preview state ---
    const [promptPreviewTokens, setPromptPreviewTokens] = useState(0);
    const [promptPreviewBudget, setPromptPreviewBudget] = useState(0);
    const [promptPreviewLoading, setPromptPreviewLoading] = useState(false);
    const [promptPreviewLayers, setPromptPreviewLayers] = useState<PromptLayerDiagnostic[]>([]);
    const [promptHistoryTokens, setPromptHistoryTokens] = useState(0);
    const [promptContextTotal, setPromptContextTotal] = useState(0);
    const [promptDiagnosticsOpen, setPromptDiagnosticsOpen] = useState(false);
    const [promptPreviewUserTokens, setPromptPreviewUserTokens] = useState(0);

    // --- Derived values ---
    const canUseWeb = membershipType !== 'free';
    const canUseBoth = membershipType === 'pro';
    const canUseKnowledgeBase = membershipType !== 'free' && knowledgeBaseEnabled;
    const canMentionDataSources = enabledDataSourceTypes.length > 0;
    const canMentionAnything = canMentionDataSources || canUseKnowledgeBase;
    const mentionIdentity = JSON.stringify([userId ?? null, membershipType, knowledgeBaseEnabled, [...enabledDataSourceTypes].sort()]);
    const mentionsAreCurrent = !!userId && mentionOwnerIdentity === mentionIdentity;
    const visibleDataSources = useMemo(() => mentionsAreCurrent
        ? mentionDataSources.filter(item => enabledDataSourceTypes.includes(item.type))
        : [], [enabledDataSourceTypes, mentionDataSources, mentionsAreCurrent]);

    const promptUsageProgress = promptPreviewBudget > 0
        ? Math.min(promptPreviewTokens / promptPreviewBudget, 1)
        : 0;
    const contextProgress = promptContextTotal > 0
        ? Math.min(promptHistoryTokens / promptContextTotal, 1)
        : 0;
    const promptProgressPercent = Math.round(promptUsageProgress * 100);
    const contextProgressPercent = Math.round(contextProgress * 100);
    const hasPromptDiagnostics = !!(promptPreviewLayers.length && promptPreviewBudget);
    const displayLayers = promptPreviewLayers;
    const displayUserMessageTokens = promptPreviewUserTokens;
    const promptUsageLabel = `提示词 ${promptProgressPercent}%`;

    const previewMentions = useMemo(
        () => filterMentionsByFeature(mentions, { knowledgeBaseEnabled: canUseKnowledgeBase, enabledDataSourceTypes }),
        [canUseKnowledgeBase, enabledDataSourceTypes, mentions]
    );
    const canRequestPreview = shouldRequestChatPreview({ userId, isLoading, isSendingToList, agentMode });
    const promptKbIdSet = useMemo(() => new Set(promptKnowledgeBases.map(kb => kb.id)), [promptKnowledgeBases]);
    const mentionMap = useMemo(() => new Map(mentions.map(m => [m.id, m])), [mentions]);
    const kbNameMap = useMemo(() => new Map(promptKnowledgeBases.map(kb => [kb.id, kb.name])), [promptKnowledgeBases]);

    // --- Helpers ---
    const formatLayerLabel = useCallback((layerId: string) => {
        return formatPromptLayerLabel(layerId, (id) => {
            if (id.startsWith('mention_')) {
                const mentionId = id.replace('mention_', '');
                const mention = mentionMap.get(mentionId);
                if (!mention) return undefined;
                const typeLabel = mentionTypeLabels[mention.type] || mentionTypeLabels.default;
                return `提及·${typeLabel}${mention.name ? `·${mention.name}` : ''}`;
            }
            if (id.startsWith('kb_')) {
                const kbId = id.replace('kb_', '');
                const kbName = kbNameMap.get(kbId);
                return `知识库${kbName ? `·${kbName}` : ''}`;
            }
            return undefined;
        });
    }, [kbNameMap, mentionMap]);

    const readMentionCache = useCallback(<T,>(key: string): T | null => {
        return readLocalCache<T>(key, MENTION_CACHE_TTL_MS);
    }, []);

    const writeMentionCache = useCallback(<T,>(key: string, value: T) => {
        writeLocalCache(key, value);
    }, []);

    const refreshMentionData = useCallback(async (fresh = true) => {
        const scope = mentionLifecycle.current;
        if (!scope || scope.identity !== mentionIdentity || scope.controller.signal.aborted || !userId || !canMentionAnything) return;
        mentionRequest.current?.abort();
        const request = new AbortController();
        mentionRequest.current = request;
        const isCurrent = () => mentionLifecycle.current === scope && !scope.controller.signal.aborted
            && mentionRequest.current === request && !request.signal.aborted;
        const { dataKey, kbKey, legacyDataKey, legacyKbKey } = getMentionCacheKeys(userId);
        setMentionLoading(true);
        try {
            removeLocalCache(legacyDataKey);
            removeLocalCache(legacyKbKey);
            const [dsResult, kbResult] = await Promise.allSettled([
                canMentionDataSources ? (async () => {
                    const response = await fetch(`/api/data-sources?limit=50${fresh ? '&fresh=1' : ''}`, { signal: request.signal });
                    if (!isCurrent()) return null;
                    if (!response.ok) throw new Error('数据加载失败');
                    const data = await response.json() as { items?: DataSourceSummary[]; errors?: DataSourceLoadError[] };
                    if (!isCurrent()) return null;
                    return data;
                })() : Promise.resolve(null),
                canUseKnowledgeBase ? listKnowledgeBases({ signal: request.signal }) : Promise.resolve(null),
            ]);
            if (!isCurrent()) return;
            // A failed KB read must not discard a successful (possibly partial) source index.
            setMentionLoadError(dsResult.status === 'rejected' || kbResult.status === 'rejected' ? '数据加载失败' : null);
            if (dsResult.status === 'fulfilled') {
                const items = dsResult.value?.items || [];
                const errors = dsResult.value?.errors || [];
                setMentionDataSources(items);
                setMentionDataSourceErrors(errors);
                if (canMentionDataSources) writeMentionCache(dataKey, { items, errors });
            }
            if (kbResult.status === 'fulfilled') {
                const knowledgeBases = kbResult.value || [];
                setMentionKnowledgeBases(knowledgeBases);
                if (canUseKnowledgeBase) writeMentionCache(kbKey, knowledgeBases);
            }
        } catch {
            if (isCurrent()) setMentionLoadError('数据加载失败');
        } finally {
            if (isCurrent()) setMentionLoading(false);
        }
    }, [canMentionAnything, canMentionDataSources, canUseKnowledgeBase, mentionIdentity, userId, writeMentionCache]);

    // --- Effects ---
    // Prompt preview fetch
    useEffect(() => {
        if (!userId || agentMode) {
            setPromptPreviewTokens(0);
            setPromptPreviewBudget(0);
            setPromptPreviewLayers([]);
            setPromptPreviewUserTokens(0);
            setPromptHistoryTokens(0);
            setPromptContextTotal(0);
            setPromptPreviewLoading(false);
            setPromptDiagnosticsOpen(false);
            return;
        }
        if (!canRequestPreview) {
            setPromptPreviewLoading(false);
            return;
        }

        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        const abortController = new AbortController();

        const loadPreview = async () => {
            setPromptPreviewLoading(true);
            try {
                const resp = await fetch('/api/chat/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: selectedModel,
                        reasoning: reasoningEnabled,
                        mentions: previewMentions,
                        messages: contextMessages,
                        mangpaiMode: chatMode === 'mangpai' || undefined,
                        dreamMode: chatMode === 'dream' || undefined
                    }),
                    signal: abortController.signal
                });
                if (!resp.ok || previewRequestIdRef.current !== requestId) return;
                const data = await resp.json();
                if (previewRequestIdRef.current !== requestId) return;
                setPromptPreviewTokens(data.totalTokens || 0);
                setPromptPreviewBudget(data.budgetTotal || 0);
                setPromptPreviewLayers(data.diagnostics || []);
                setPromptPreviewUserTokens(data.userMessageTokens || 0);
                setPromptHistoryTokens(data.historyTokens || 0);
                setPromptContextTotal(data.contextTotal || 0);
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    return;
                }
                console.warn('加载提示词预览失败:', error);
            } finally {
                if (previewRequestIdRef.current === requestId) {
                    setPromptPreviewLoading(false);
                }
            }
        };
        void loadPreview();

        return () => {
            abortController.abort();
        };
    }, [agentMode, canRequestPreview, contextMessages, chatMode, previewMentions, reasoningEnabled, selectedModel, userId]);

    // Close diagnostics when no data
    useEffect(() => {
        if (!hasPromptDiagnostics) {
            setPromptDiagnosticsOpen(false);
        }
    }, [hasPromptDiagnostics]);

    // Identity changes invalidate requests before paint; cached values are only placeholders.
    useLayoutEffect(() => {
        const previousUserId = mentionLifecycle.current?.userId;
        if (previousUserId && previousUserId !== userId) {
            try {
                for (const key of Object.values(getMentionCacheKeys(previousUserId))) removeLocalCache(key);
            } catch {
                // Cache availability cannot prevent account isolation in memory.
            }
        }
        const scope = { identity: mentionIdentity, userId: userId ?? null, controller: new AbortController() };
        mentionLifecycle.current = scope;
        setMentionOwnerIdentity(mentionIdentity);
        setMentionDataSources([]);
        setMentionKnowledgeBases([]);
        setMentionDataSourceErrors([]);
        setMentionLoadError(null);
        setMentionLoading(false);

        if (userId) {
            const { dataKey, kbKey, legacyDataKey, legacyKbKey } = getMentionCacheKeys(userId);
            removeLocalCache(legacyDataKey);
            removeLocalCache(legacyKbKey);
            // Hydrate synchronously, before starting this scope's authoritative request.
            // No queued cache microtask may outlive a refresh or restore a previous account.
            const cachedDs = canMentionDataSources
                ? readMentionCache<{ items: DataSourceSummary[]; errors?: DataSourceLoadError[] }>(dataKey) : null;
            const cachedKb = canUseKnowledgeBase ? readMentionCache<KnowledgeBaseSummary[]>(kbKey) : null;
            if (cachedDs?.items) {
                setMentionDataSources(cachedDs.items);
                setMentionDataSourceErrors(cachedDs.errors || []);
            }
            if (cachedKb) setMentionKnowledgeBases(cachedKb);
            void refreshMentionData(true);
        }

        const onInvalidate = () => { void refreshMentionData(true); };
        window.addEventListener(DATA_INDEX_INVALIDATED_EVENT, onInvalidate);
        return () => {
            scope.controller.abort();
            mentionRequest.current?.abort();
            window.removeEventListener(DATA_INDEX_INVALIDATED_EVENT, onInvalidate);
        };
    }, [canMentionDataSources, canUseKnowledgeBase, mentionIdentity, readMentionCache, refreshMentionData, userId]);

    return {
        // Refs
        textareaRef, fileInputRef, overlayRef, previewRequestIdRef,
        // Mention
        mentionOpen, setMentionOpen,
        mentionQuery, setMentionQuery,
        mentionStartIndex, setMentionStartIndex,
        mentionDataSources: visibleDataSources, setMentionDataSources,
        mentionKnowledgeBases: mentionsAreCurrent && canUseKnowledgeBase ? mentionKnowledgeBases : [], setMentionKnowledgeBases,
        mentionLoadError: mentionsAreCurrent ? mentionLoadError : null, setMentionLoadError,
        mentionDataSourceErrors: mentionsAreCurrent ? mentionDataSourceErrors.filter(error => enabledDataSourceTypes.includes(error.type)) : [], setMentionDataSourceErrors,
        mentionLoading: mentionsAreCurrent && mentionLoading, setMentionLoading,
        mentionDefaultCategory, setMentionDefaultCategory,
        // Knowledge base
        knowledgeBaseOpen, setKnowledgeBaseOpen,
        knowledgeBaseSavingId, setKnowledgeBaseSavingId,
        // Prompt preview
        promptPreviewTokens, setPromptPreviewTokens,
        promptPreviewBudget, setPromptPreviewBudget,
        promptPreviewLoading, setPromptPreviewLoading,
        promptPreviewLayers, setPromptPreviewLayers,
        promptHistoryTokens, setPromptHistoryTokens,
        promptContextTotal, setPromptContextTotal,
        promptDiagnosticsOpen, setPromptDiagnosticsOpen,
        promptPreviewUserTokens, setPromptPreviewUserTokens,
        // Derived
        canUseWeb, canUseBoth, canUseKnowledgeBase,
        canMentionAnything,
        promptUsageProgress, contextProgress,
        promptProgressPercent, contextProgressPercent,
        hasPromptDiagnostics, displayLayers, displayUserMessageTokens,
        promptUsageLabel, previewMentions, canRequestPreview,
        promptKbIdSet, mentionMap, kbNameMap,
        // Helpers
        formatLayerLabel, refreshMentionData, readMentionCache,
    };
}
