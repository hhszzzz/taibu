'use client';

import { useEffect, useRef, useState } from 'react';
import {
    loadConversationAnalysisSnapshot,
    type ConversationAnalysisSnapshot,
} from '@/lib/chat/conversation-analysis';
import { resolveHistoryConversationId } from '@/lib/history/client';
import type { HistoryType } from '@/lib/history/registry';

interface AnalysisSnapshotCallbacks {
    /** Called when a saved analysis text is found */
    onAnalysis: (analysis: string) => void;
    /** Called when saved reasoning text is found */
    onReasoning?: (reasoning: string) => void;
    /** Called when a saved model ID is found */
    onModelId?: (modelId: string) => void;
    /** Called with the reasoningEnabled flag */
    onReasoningEnabled?: (enabled: boolean) => void;
    /** Called when conversationId is resolved from history */
    onConversationIdResolved?: (conversationId: string) => void;
    /** Called after the snapshot load attempt settles */
    onComplete?: () => void;
    /** Called when snapshot loading fails for reasons other than not-found */
    onError?: (message: string) => void;
}

interface UseAnalysisSnapshotOptions {
    /** Current conversationId (may be null initially) */
    conversationId: string | null | undefined;
    /** Divination/reading record ID used to look up conversation from history */
    recordId: string | null | undefined;
    /** Divination type for history lookup (e.g. 'tarot', 'liuyao', 'bazi') */
    divinationType: HistoryType;
    /** Session storage key for history lookup */
    sessionKey: string;
    /** Skip loading if analysis already exists */
    hasExistingAnalysis: boolean;
    /** Additional skip condition (e.g. result not loaded yet) */
    skip?: boolean;
    /** Callbacks for setting state from snapshot; the latest ones are used, so callers may pass a fresh object each render */
    callbacks: AnalysisSnapshotCallbacks;
}

/**
 * Shared hook that loads a conversation analysis snapshot from history.
 *
 * Replaces the duplicated `loadAnalysis` useEffect found across
 * tarot, liuyao, qimen, mbti, hepan, daliuren result pages.
 */
export function useAnalysisSnapshot({
    conversationId,
    recordId,
    divinationType,
    sessionKey,
    hasExistingAnalysis,
    skip = false,
    callbacks,
}: UseAnalysisSnapshotOptions): boolean {
    const [loading, setLoading] = useState(false);
    // Callers pass inline callbacks; keeping them out of the load effect's dependencies stops a settled
    // load from re-rendering, getting a new callbacks object and starting the same lookup again.
    const callbacksRef = useRef(callbacks);

    useEffect(() => {
        callbacksRef.current = callbacks;
    });

    useEffect(() => {
        if (skip || hasExistingAnalysis) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        const loadAnalysis = async () => {
            setLoading(true);
            let resolvedId = conversationId ?? null;

            try {
                if (!resolvedId && recordId) {
                    resolvedId = await resolveHistoryConversationId(
                        divinationType,
                        recordId,
                        sessionKey,
                    );
                    if (cancelled) return;
                    if (resolvedId) {
                        callbacksRef.current.onConversationIdResolved?.(resolvedId);
                    }
                }

                if (!resolvedId) return;

                const snapshot: ConversationAnalysisSnapshot | null =
                    await loadConversationAnalysisSnapshot(resolvedId);
                if (cancelled || !snapshot) return;

                if (snapshot.analysis) {
                    callbacksRef.current.onAnalysis(snapshot.analysis);
                }
                if (snapshot.reasoning) {
                    callbacksRef.current.onReasoning?.(snapshot.reasoning);
                }
                if (snapshot.modelId) {
                    callbacksRef.current.onModelId?.(snapshot.modelId);
                }
                callbacksRef.current.onReasoningEnabled?.(snapshot.reasoningEnabled);
            } catch (error) {
                const message = error instanceof Error ? error.message : '加载分析快照失败';
                console.error('[useAnalysisSnapshot] failed to load analysis snapshot:', error);
                callbacksRef.current.onError?.(message);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    callbacksRef.current.onComplete?.();
                }
            }
        };

        void loadAnalysis();
        return () => {
            cancelled = true;
        };
    }, [conversationId, recordId, divinationType, sessionKey, hasExistingAnalysis, skip]);

    return loading;
}
