import { systemDb } from '@/lib/db/context.server';
import type { DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { getProvider } from '@/lib/data-sources';
import { estimateTokens, truncateToTokens } from '@/lib/ai/token-estimate';
import type { Mention } from '@/types/mentions';

export function parseMentions(content: string): Mention[] {
    const results: Mention[] = [];
    const jsonObjectToken = /@\{(\{[\s\S]*?\})\}/g;
    for (const match of content.matchAll(jsonObjectToken)) {
        const raw = match[1];
        try {
            const parsed = JSON.parse(raw) as Mention;
            if (parsed && parsed.type && parsed.name) results.push(parsed);
        } catch {
        }
    }

    const kvToken = /@\{([^{}]+)\}/g;
    for (const match of content.matchAll(kvToken)) {
        const raw = match[1];
        try {
            const parsed = JSON.parse(raw) as Mention;
            if (parsed && parsed.type && parsed.name) {
                results.push(parsed);
                continue;
            }
        } catch {
        }
        try {
            const parsed = JSON.parse(`{${raw}}`) as Mention;
            if (parsed && parsed.type && parsed.name) results.push(parsed);
        } catch {
        }
    }
    return results;
}

export function stripMentionTokens(content: string): string {
    return content
        .replace(/@\{(\{[\s\S]*?\}|[^{}]+)\}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export async function resolveMention(mention: Mention, userId: string, ctx?: DataSourceQueryContext): Promise<string> {
    if (!mention.id) {
        console.warn(`[mention-resolve] SKIP: mention.id is missing for type=${mention.type} name=${mention.name}`);
        return '';
    }

    const key = mentionCacheKey(mention, userId, ctx);
    const cached = mentionCache.get(key);
    if (cached && cached.expires > Date.now()) {
        mentionCache.delete(key);
        mentionCache.set(key, cached);
        return cached.value;
    }

    const resolve = async () => {
        if (mention.type === 'knowledge_base') {
            return await resolveKnowledgeBase(mention.id!, userId, ctx);
        }
        try {
            const provider = await getProvider(mention.type);
            const data = await provider.get(mention.id!, userId, ctx);
            if (!data) {
                console.warn(`[mention-resolve] provider.get returned null for type=${mention.type} id=${mention.id}`);
            }
            return data ? await provider.formatForAI(data, ctx) : '';
        } catch (err) {
            console.error(`[mention-resolve] ERROR for type=${mention.type} id=${mention.id}:`, err);
            return '';
        }
    };

    const content = await resolve();
    if (content) {
        if (mentionCache.size >= MENTION_CACHE_LIMIT) mentionCache.delete(mentionCache.keys().next().value!);
        mentionCache.set(key, { value: content, expires: Date.now() + MENTION_CACHE_TTL_MS });
    }
    return content;
}

const MENTION_CACHE_TTL_MS = 60_000;
const MENTION_CACHE_LIMIT = 200;
const mentionCache = new Map<string, { value: string; expires: number }>();

function mentionCacheKey(mention: Mention, userId: string, ctx?: DataSourceQueryContext): string {
    return [
        userId, mention.type, mention.id ?? '',
        ctx?.maxTokens ?? '', ctx?.maxChars ?? '', ctx?.model ?? '', ctx?.chartPromptDetailLevel ?? '', ctx?.caseEventLimit ?? '',
    ].join('|');
}

export function invalidateMentionCache(referenceId: string): void {
    for (const key of mentionCache.keys()) {
        if (key.split('|')[2] === referenceId) mentionCache.delete(key);
    }
}

async function resolveKnowledgeBase(kbId: string, userId: string, ctx?: DataSourceQueryContext): Promise<string> {
    const db = ctx?.db ?? systemDb();
    const model = ctx?.model ?? '';
    const kb = await db.tx((trx) => trx
        .selectFrom('knowledge_bases')
        .select(['id', 'name', 'description', 'weight'])
        .where('id', '=', kbId)
        .where('user_id', '=', userId)
        .executeTakeFirst()).catch(() => undefined);

    if (!kb) return '';

    const header = [
        `## 知识库：${kb.name}`,
        kb.description ? `- 描述：${kb.description}` : '',
        kb.weight ? `- 权重：${kb.weight}` : ''
    ].filter(Boolean).join('\n');

    const entryLimit = kb.weight === 'high' ? 320 : kb.weight === 'low' ? 120 : 200;
    const pageSize = Math.min(200, entryLimit);
    let offset = 0;
    const bodyParts: string[] = [];
    let entriesUsed = 0;
    const maxTokens = ctx?.maxTokens;
    const maxChars = ctx?.maxChars;
    let remainingTokens = typeof maxTokens === 'number' && maxTokens > 0
        ? Math.max(0, maxTokens - estimateTokens(model, header))
        : null;
    let remainingChars = typeof maxChars === 'number' && maxChars > 0
        ? Math.max(0, maxChars - header.length)
        : null;

    while (true) {
        if (entriesUsed >= entryLimit) break;
        const remainingEntries = entryLimit - entriesUsed;
        const rangeSize = Math.min(pageSize, remainingEntries);
        const rows = await db.tx((trx) => trx
            .selectFrom('knowledge_entries')
            .select(['content'])
            .where('kb_id', '=', kbId)
            .orderBy('created_at', 'desc')
            .offset(offset)
            .limit(rangeSize)
            .execute()).catch(() => []);
        if (rows.length === 0) break;
        for (const row of rows) {
            if (entriesUsed >= entryLimit) break;
            const raw = typeof row.content === 'string' ? row.content : '';
            if (!raw) continue;
            let next = raw;
            if (remainingTokens != null) {
                if (remainingTokens <= 0) break;
                const tokens = estimateTokens(model, next);
                if (tokens > remainingTokens) {
                    next = truncateToTokens(model, next, remainingTokens);
                }
            }
            if (remainingChars != null) {
                if (remainingChars <= 0) break;
                if (next.length > remainingChars) {
                    next = next.slice(0, remainingChars);
                }
            }
            if (!next) continue;
            bodyParts.push(next);
            entriesUsed += 1;
            if (remainingTokens != null) {
                remainingTokens -= estimateTokens(model, next);
            }
            if (remainingChars != null) {
                remainingChars -= next.length;
            }
            if ((remainingTokens != null && remainingTokens <= 0) || (remainingChars != null && remainingChars <= 0)) {
                break;
            }
        }
        if (rows.length < pageSize) break;
        if ((remainingTokens != null && remainingTokens <= 0) || (remainingChars != null && remainingChars <= 0)) {
            break;
        }
        offset += rangeSize;
    }

    const body = bodyParts.join('\n\n');
    return body ? `${header}\n\n${body}` : header;
}
