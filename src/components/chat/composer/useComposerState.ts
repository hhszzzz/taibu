/**
 * ChatComposer 共享状态 hook
 *
 * 集中管理 ChatComposer 内部的 useState，
 * 按职责分组导出给各子组件使用。
 */
import { useState, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import type { MembershipType } from '@/lib/user/membership';
import { DATA_INDEX_INVALIDATED_EVENT } from '@/lib/browser-api';
import { readLocalCache, removeLocalCache, writeLocalCache } from '@/lib/cache/local-storage';
import {
    listKnowledgeBases,
    type KnowledgeBaseSummary as BrowserKnowledgeBaseSummary,
} from '@/lib/knowledge-base/browser-client';
import type { DataSourceType, DataSourceSummary, DataSourceLoadError } from '@/lib/data-sources/types';

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
    userId?: string | null;
    membershipType?: MembershipType;
    knowledgeBaseEnabled?: boolean;
    promptKnowledgeBases?: KnowledgeBaseSummary[];
    enabledDataSourceTypes?: readonly DataSourceType[];
}

export function useComposerState(opts: UseComposerStateOptions) {
    const {
        userId,
        membershipType = 'free',
        knowledgeBaseEnabled = true,
        promptKnowledgeBases = [],
        enabledDataSourceTypes = [],
    } = opts;

    // --- Refs ---
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
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

    const promptKbIdSet = useMemo(() => new Set(promptKnowledgeBases.map(kb => kb.id)), [promptKnowledgeBases]);

    // --- Helpers ---

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
        textareaRef, fileInputRef, overlayRef,
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
        // Derived
        canUseWeb, canUseBoth, canUseKnowledgeBase,
        canMentionAnything,
        promptKbIdSet,
        // Helpers
        refreshMentionData, readMentionCache,
    };
}
