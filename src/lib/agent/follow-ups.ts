/**
 * Follow-up questions the model appends to its final answer, one per line:
 *
 *   <followups>
 *   适合往哪个城市发展？
 *   </followups>
 *
 * The block never reaches the visible answer, including while it streams in;
 * the reader sees at most three short, distinct suggestions instead.
 */
const OPEN = '<followups>';
const CLOSE = '</followups>';
export const AGENT_FOLLOW_UP_LIMIT = 3;
/** Longer lines are prose that slipped into the block, not a question to offer. */
const MAX_LENGTH = 40;

export function splitAgentFollowUps(text: string): { text: string; followUps: string[] } {
    const start = text.lastIndexOf(OPEN);
    if (start < 0) {
        // An opening tag still streaming in sits alone at the start of the last line.
        const partial = /(?:^|\n)[ \t]*(<[a-z]*)$/u.exec(text);
        return partial && OPEN.startsWith(partial[1]) ? { text: text.slice(0, partial.index).trimEnd(), followUps: [] } : { text, followUps: [] };
    }
    const end = text.indexOf(CLOSE, start + OPEN.length);
    const lines = text.slice(start + OPEN.length, end < 0 ? undefined : end).split('\n')
        .map(line => line.replace(/^\s*(?:[-*•]|\d{1,2}[.、)）])\s*/u, '').trim())
        .filter(line => line && line.length <= MAX_LENGTH && !line.startsWith('<'));
    const rest = end < 0 ? '' : text.slice(end + CLOSE.length).trim();
    const answer = text.slice(0, start).trimEnd();
    return { text: rest ? (answer ? `${answer}\n\n${rest}` : rest) : answer, followUps: [...new Set(lines)].slice(0, AGENT_FOLLOW_UP_LIMIT) };
}
