import type { Mention, MentionType } from '@/types';
import { extractMentionTokens, mapMentionsToTokens } from '@/lib/mention-tokens';

export type MentionHighlightedPart =
    | { kind: 'text'; value: string }
    | { kind: 'mention'; value: string; type: MentionType; start: number; end: number };

export function buildMentionHighlightedParts(content: string, mentions: Mention[]): MentionHighlightedPart[] {
    if (!content) return [];
    const tokens = extractMentionTokens(content, mentions);
    if (tokens.length === 0) return [{ kind: 'text', value: content }];

    const tokenMatches = mapMentionsToTokens(tokens, mentions);
    let cursor = 0;
    const parts: MentionHighlightedPart[] = [];

    for (const match of tokenMatches) {
        const token = match.token;
        if (token.start > cursor) {
            parts.push({ kind: 'text', value: content.slice(cursor, token.start) });
        }
        parts.push({
            kind: 'mention',
            value: content.slice(token.start, token.end),
            type: (match.mention?.type ?? 'knowledge_base') as MentionType,
            start: token.start,
            end: token.end,
        });
        cursor = token.end;
    }

    if (cursor < content.length) {
        parts.push({ kind: 'text', value: content.slice(cursor) });
    }

    return parts;
}
