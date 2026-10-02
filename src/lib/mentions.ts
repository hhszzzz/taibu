import { getSystemAdminClient } from '@/lib/api-utils';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { getProvider } from '@/lib/data-sources';
import { countTokens, truncateToTokens } from '@/lib/token-utils';
import type { Mention, MentionTarget, MentionType } from '@/types/mentions';

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

export async function searchMentionTargets(
    userId: string,
    type: MentionType,
    query: string,
    ctx?: DataSourceQueryContext
): Promise<MentionTarget[]> {
    if (type === 'knowledge_base') {
        return await searchKnowledgeBases(userId, query, ctx);
    }

    const provider = await getProvider(type);
    const list = await provider.list(userId, ctx);
    return list
        .filter(item => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return item.name.toLowerCase().includes(q) || item.preview.toLowerCase().includes(q);
        })
        .slice(0, 20)
        .map(item => ({
            id: item.id,
            type,
            name: item.name,
            preview: item.preview
        }));
}

async function searchKnowledgeBases(userId: string, query: string, ctx?: DataSourceQueryContext): Promise<MentionTarget[]> {
    const supabase = ctx?.client ?? getSystemAdminClient();
    let q = supabase
        .from('knowledge_bases')
        .select('id, name, description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

    const keyword = query.trim();
    if (keyword) {
        q = q.ilike('name', `%${keyword}%`);
    }

    const { data } = await q;
    return (data || []).map((kb: { id: string; name: string; description: string | null }) => ({
        id: kb.id,
        type: 'knowledge_base',
        name: kb.name,
        preview: kb.description || '知识库'
    }));
}

export async function resolveMention(mention: Mention, userId: string, ctx?: DataSourceQueryContext): Promise<string> {
    if (!mention.id) {
        console.warn(`[mention-resolve] SKIP: mention.id is missing for type=${mention.type} name=${mention.name}`);
        return '';
    }
    if (mention.type === 'knowledge_base') {
        return await resolveKnowledgeBase(mention.id, userId, ctx);
    }

    try {
        const provider = await getProvider(mention.type);
        const data = await provider.get(mention.id, userId, ctx);
        if (!data) {
            console.warn(`[mention-resolve] provider.get returned null for type=${mention.type} id=${mention.id}`);
        }
        return data ? await provider.formatForAI(data, ctx) : '';
    } catch (err) {
        console.error(`[mention-resolve] ERROR for type=${mention.type} id=${mention.id}:`, err);
        return '';
    }
}

async function resolveKnowledgeBase(kbId: string, userId: string, ctx?: DataSourceQueryContext): Promise<string> {
    const supabase = ctx?.client ?? getSystemAdminClient();
    const { data: kb } = await supabase
        .from('knowledge_bases')
        .select('id, name, description, weight')
        .eq('id', kbId)
        .eq('user_id', userId)
        .maybeSingle();

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
        ? Math.max(0, maxTokens - countTokens(header))
        : null;
    let remainingChars = typeof maxChars === 'number' && maxChars > 0
        ? Math.max(0, maxChars - header.length)
        : null;

    while (true) {
        if (entriesUsed >= entryLimit) break;
        const remainingEntries = entryLimit - entriesUsed;
        const rangeSize = Math.min(pageSize, remainingEntries);
        const { data } = await supabase
            .from('knowledge_entries')
            .select('content, created_at')
            .eq('kb_id', kbId)
            .order('created_at', { ascending: false })
            .range(offset, offset + rangeSize - 1);
        if (!data || data.length === 0) break;
        for (const row of data as Array<{ content: string | null }>) {
            if (entriesUsed >= entryLimit) break;
            const raw = typeof row.content === 'string' ? row.content : '';
            if (!raw) continue;
            let next = raw;
            if (remainingTokens != null) {
                if (remainingTokens <= 0) break;
                const tokens = countTokens(next);
                if (tokens > remainingTokens) {
                    next = truncateToTokens(next, remainingTokens);
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
                remainingTokens -= countTokens(next);
            }
            if (remainingChars != null) {
                remainingChars -= next.length;
            }
            if ((remainingTokens != null && remainingTokens <= 0) || (remainingChars != null && remainingChars <= 0)) {
                break;
            }
        }
        if (data.length < pageSize) break;
        if ((remainingTokens != null && remainingTokens <= 0) || (remainingChars != null && remainingChars <= 0)) {
            break;
        }
        offset += rangeSize;
    }

    const body = bodyParts.join('\n\n');
    return body ? `${header}\n\n${body}` : header;
}

export async function mentionFromSummary(summary: DataSourceSummary): Promise<Mention> {
    return {
        type: summary.type,
        id: summary.id,
        name: summary.name,
        preview: summary.preview
    };
}
