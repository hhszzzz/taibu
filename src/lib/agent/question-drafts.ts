import type { AgentAnswers, AgentQuestion } from './questions';

/** A partly answered question set: chosen option IDs (null when skipped) and typed text, per question. */
export interface AgentQuestionDraft {
    answers: AgentAnswers;
    custom: Record<string, string>;
}

const PREFIX = 'taibu.question:';
/** A draft belongs to one ask_user call; `scope` names its owner, conversation and task. */
export const questionDraftKey = (scope: string, questionId: string) => `${PREFIX}${scope}:${questionId}`;

/** Reads a stored draft for these questions; unknown questions are dropped and malformed values read as unanswered. */
export function parseQuestionDraft(raw: string | null, questions: readonly AgentQuestion[]): AgentQuestionDraft {
    try {
        const value = JSON.parse(raw ?? '{}');
        return {
            answers: Object.fromEntries(questions.map(q => [q.id, value.answers?.[q.id] === null ? null : Array.isArray(value.answers?.[q.id]) ? value.answers[q.id].filter((v: unknown) => typeof v === 'string').slice(0, 31) : []])),
            custom: Object.fromEntries(questions.map(q => [q.id, typeof value.custom?.[q.id] === 'string' ? value.custom[q.id].slice(0, 8000) : ''])),
        };
    } catch { return { answers: {}, custom: {} }; }
}

/** What submitting would send: chosen options followed by typed text, or null for a skipped question. */
export function getDraftAnswers(questions: readonly AgentQuestion[], draft: AgentQuestionDraft): AgentAnswers {
    return Object.fromEntries(questions.map(q => [q.id, draft.answers[q.id] === null ? null
        : [...draft.answers[q.id] ?? [], ...(draft.custom[q.id]?.trim() ? [draft.custom[q.id].trim()] : [])]]));
}

/** An answer as the reader sees it: option labels and typed text, 已跳过 when skipped, null while empty. */
export function describeQuestionAnswer(question: AgentQuestion, answer: string[] | null | undefined): string | null {
    if (answer === null) return '已跳过';
    return answer?.length ? answer.map(value => question.options?.find(option => option.id === value)?.label ?? value).join('、') : null;
}

/**
 * Per-tab draft cache shared by the answer panel and the workspace, so both show
 * a draft as it is typed. Changes made in other tabs arrive through `forget`.
 */
export function createQuestionDraftStore(storage: () => Storage | undefined) {
    const cache = new Map<string, string | null>();
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    const persist = (key: string, raw: string | null) => {
        cache.set(key, raw);
        try {
            if (raw === null) storage()?.removeItem(key);
            else storage()?.setItem(key, raw);
        } catch { /* The draft stays in memory when storage is unavailable or full. */ }
        notify();
    };
    return {
        /** The stored draft text; the same string until the draft changes. */
        read(key: string): string | null {
            if (!cache.has(key)) {
                let raw: string | null = null;
                try { raw = storage()?.getItem(key) ?? null; } catch { /* Private browsing can deny storage. */ }
                cache.set(key, raw);
            }
            return cache.get(key) ?? null;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        write: (key: string, draft: AgentQuestionDraft) => persist(key, JSON.stringify(draft)),
        remove: (key: string) => persist(key, null),
        /** Rereads a draft another tab changed; a null key means that tab cleared storage. */
        forget(key: string | null) {
            if (key === null) cache.clear();
            else if (key.startsWith(PREFIX)) cache.delete(key);
            else return;
            notify();
        },
    };
}
