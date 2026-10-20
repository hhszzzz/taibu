export function backgroundCompactionTokens(contextWindow: number | null, reserveTokens: number): number {
    const blocking = (contextWindow ?? 0) - reserveTokens;
    return blocking > 0 ? Math.min(32768, Math.floor(blocking / 2)) : 0;
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
