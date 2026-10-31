import 'server-only';
import { searchWeb, webRouteAvailable } from '@/lib/agent/mcp/web-route.server';
import { WEB_SEARCH_QUERY_MAX, type WebSearchResult } from '@/lib/agent/mcp/web-results';

export type { WebSearchResult };

/** What plain chat found for one question; a search that cannot run never stops the answer. */
export type ChatWebSearch =
    | { status: 'ok'; query: string; results: WebSearchResult[] }
    | { status: 'failed' | 'unavailable'; query: string };

/**
 * Searches for the user's question as asked, cut to the length every route accepts, through the search services an
 * administrator set up (see web-route.server.ts).
 */
export async function searchChatWeb(question: string, signal?: AbortSignal): Promise<ChatWebSearch> {
    const query = Array.from(question.replace(/\s+/gu, ' ').trim()).slice(0, WEB_SEARCH_QUERY_MAX).join('');
    if (!(await webRouteAvailable('search'))) return { status: 'unavailable', query };
    if (!query) return { status: 'ok', query, results: [] };
    try {
        return { status: 'ok', query, results: await searchWeb(query, { signal }) };
    } catch {
        signal?.throwIfAborted();
        console.warn('[chat-web-search]', { code: 'WEB_SEARCH_FAILED' });
        return { status: 'failed', query };
    }
}
