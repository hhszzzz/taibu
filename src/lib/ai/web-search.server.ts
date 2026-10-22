import 'server-only';

export interface WebSearchResult {
    title: string;
    url: string;
    content: string;
}

/** Tavily refuses longer queries. */
export const WEB_SEARCH_QUERY_MAX = 400;

/** The Agent's web_search tool and plain chat's web search both need Tavily. */
export function webSearchConfigured(): boolean {
    return !!process.env.TAVILY_API_KEY;
}

/** Searches the web through Tavily and keeps only HTTP(S) results; throws when unconfigured or the request fails. */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('联网检索未配置');
    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false }),
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`联网检索失败 (${response.status})`);
    const data = await response.json() as { results?: unknown };
    return (Array.isArray(data.results) ? data.results : []).filter(isUsableResult);
}

/** A result the prompt and citations can show: text fields and an HTTP(S) address. */
function isUsableResult(value: unknown): value is WebSearchResult {
    if (!value || typeof value !== 'object') return false;
    const { title, url, content } = value as Record<string, unknown>;
    if (typeof title !== 'string' || typeof url !== 'string' || typeof content !== 'string') return false;
    try {
        return ['https:', 'http:'].includes(new URL(url).protocol);
    } catch {
        return false;
    }
}

/** What plain chat found for one question; a search that cannot run never stops the answer. */
export type ChatWebSearch =
    | { status: 'ok'; query: string; results: WebSearchResult[] }
    | { status: 'failed' | 'unavailable'; query: string };

/** Searches for the user's question as asked, cut to the length Tavily accepts. */
export async function searchChatWeb(question: string, signal?: AbortSignal): Promise<ChatWebSearch> {
    const query = Array.from(question.replace(/\s+/gu, ' ').trim()).slice(0, WEB_SEARCH_QUERY_MAX).join('');
    if (!webSearchConfigured()) return { status: 'unavailable', query };
    if (!query) return { status: 'ok', query, results: [] };
    try {
        return { status: 'ok', query, results: await searchWeb(query, signal) };
    } catch {
        signal?.throwIfAborted();
        console.warn('[chat-web-search]', { code: 'WEB_SEARCH_FAILED' });
        return { status: 'failed', query };
    }
}
