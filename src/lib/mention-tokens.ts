import type { Mention } from '@/types';

export type MentionToken = {
    start: number;
    end: number;
    name: string;
};

export type MentionTokenMatch = {
    token: MentionToken;
    mention?: Mention;
};

/** 提及在草稿里的写法：「@ 名称」——@ 后留一个空格，让图标与名称之间有自然间距。 */
export const buildMentionToken = (mention: Mention): string => `@ ${mention.name}`;

export const extractMentionTokens = (value: string, mentionList: Mention[]): MentionToken[] => {
    const tokens: MentionToken[] = [];
    const names = Array.from(new Set(mentionList.map(m => m.name).filter(Boolean)))
        .sort((a, b) => b.length - a.length);
    if (names.length === 0) return tokens;
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] !== '@') continue;
        // 新草稿写「@ 名称」；旧草稿与旧消息里的「@名称」仍然认。
        const name = names.find(item => value.startsWith(`@ ${item}`, i) || value.startsWith(`@${item}`, i));
        if (!name) continue;
        const spaced = value.startsWith(`@ ${name}`, i);
        const end = i + (spaced ? 2 : 1) + name.length;
        tokens.push({ start: i, end, name });
        i = end - 1;
    }
    return tokens;
};

export const mapMentionsToTokens = (tokens: MentionToken[], mentions: Mention[]): MentionTokenMatch[] => {
    const mentionsByName = new Map<string, Mention[]>();
    for (const mention of mentions) {
        const list = mentionsByName.get(mention.name) || [];
        list.push(mention);
        mentionsByName.set(mention.name, list);
    }

    const tokensByName = new Map<string, MentionToken[]>();
    for (const token of tokens) {
        const list = tokensByName.get(token.name) || [];
        list.push(token);
        tokensByName.set(token.name, list);
    }

    const matches: MentionTokenMatch[] = [];
    for (const [name, tokenList] of tokensByName.entries()) {
        const mentionList = mentionsByName.get(name) || [];
        tokenList.forEach((token, index) => {
            matches.push({ token, mention: mentionList[index] });
        });
    }

    return matches.sort((a, b) => a.token.start - b.token.start);
};

export const filterMentionsByTokens = (mentions: Mention[], tokens: MentionToken[]): Mention[] => {
    return mapMentionsToTokens(tokens, mentions)
        .map(match => match.mention)
        .filter((mention): mention is Mention => !!mention);
};

export const removeMentionsByTokens = (
    mentions: Mention[],
    tokens: MentionToken[],
    removedTokens: MentionToken[]
): Mention[] => {
    const removedSet = new Set(removedTokens);
    return mapMentionsToTokens(tokens, mentions)
        .filter(match => !removedSet.has(match.token))
        .map(match => match.mention)
        .filter((mention): mention is Mention => !!mention);
};
