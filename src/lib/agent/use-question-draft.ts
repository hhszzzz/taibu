'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { AgentQuestion } from './questions';
import { createQuestionDraftStore, parseQuestionDraft, type AgentQuestionDraft } from './question-drafts';

const store = createQuestionDraftStore(() => typeof window === 'undefined' ? undefined : window.localStorage);
function subscribe(listener: () => void) {
    const unsubscribe = store.subscribe(listener);
    const sync = (event: StorageEvent) => store.forget(event.key);
    window.addEventListener('storage', sync);
    return () => { unsubscribe(); window.removeEventListener('storage', sync); };
}
const serverSnapshot = () => null;

/** The live draft answers of one ask_user call, shared by the answer panel and the workspace; a null key reads nothing. */
export function useQuestionDraft(key: string | null, questions: readonly AgentQuestion[]) {
    const raw = useSyncExternalStore(subscribe, () => key ? store.read(key) : null, serverSnapshot);
    const draft = useMemo(() => parseQuestionDraft(raw, questions), [raw, questions]);
    const update = useCallback((next: AgentQuestionDraft) => { if (key) store.write(key, next); }, [key]);
    const clear = useCallback(() => { if (key) store.remove(key); }, [key]);
    return { draft, update, clear };
}
