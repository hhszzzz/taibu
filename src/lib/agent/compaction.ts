export function backgroundCompactionTokens(contextWindow: number | null, reserveTokens: number): number {
    const blocking = (contextWindow ?? 0) - reserveTokens;
    return blocking > 0 ? Math.min(32768, Math.floor(blocking / 2)) : 0;
}

/**
 * One model's compaction thresholds: room for its answer, a recent tail the summary keeps verbatim, and how far below
 * the blocking threshold background compaction starts. A model whose window is unknown keeps the defaults; Pi skips
 * its threshold compaction (an unknown window is 0) and relies on overflow recovery.
 */
export function agentCompactionPolicy(window: { maxContext: number; reserveOutput: number } | null, maxTokens: number) {
    const reserveTokens = (window?.reserveOutput ?? maxTokens) + 4000;
    return {
        reserveTokens,
        keepRecentTokens: window ? Math.min(8000, Math.floor(window.maxContext / 4)) : 8000,
        backgroundTokens: backgroundCompactionTokens(window?.maxContext ?? null, reserveTokens),
    };
}

/** Longest instruction `/compact` accepts for what the summary should keep. */
export const AGENT_COMPACT_INSTRUCTIONS_MAX = 500;

/**
 * `/compact`, optionally followed by what the summary should keep, asks to compact an idle Agent conversation instead
 * of asking the model; null for any other message (including `/compactness`).
 */
export function parseAgentCompactCommand(content: string): { instructions: string | null } | null {
    const match = /^\/compact(?:\s+([\s\S]*))?$/u.exec(content.trim());
    if (!match) return null;
    const instructions = match[1]?.trim();
    return { instructions: instructions || null };
}
