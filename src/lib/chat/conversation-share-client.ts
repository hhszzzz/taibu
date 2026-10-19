/** Browser calls for public conversation links, shared by the chat share menu and the settings center. */
import { requestBrowserJson, type BrowserRequestInit } from '@/lib/browser-api';
import type { ConversationShareState, ConversationShareSummary } from './conversation-share';

async function shareRequest<T>(url: string, init: BrowserRequestInit | undefined, fallback: string): Promise<T> {
    const result = await requestBrowserJson<T>(url, init);
    if (result.error || !result.data) throw new Error(result.error?.message || fallback);
    return result.data;
}

const shareEndpoint = (conversationId: string) => `/api/conversations/${encodeURIComponent(conversationId)}/share`;

export async function fetchConversationShare(conversationId: string): Promise<ConversationShareState | null> {
    return (await shareRequest<{ share: ConversationShareState | null }>(shareEndpoint(conversationId), undefined, '读取分享状态失败')).share;
}

/** Create the link or refresh its snapshot; the token never changes on refresh. */
export async function saveConversationShare(conversationId: string, includeCharts: boolean): Promise<ConversationShareState> {
    return (await shareRequest<{ share: ConversationShareState }>(shareEndpoint(conversationId), {
        method: 'POST',
        body: JSON.stringify({ includeCharts }),
    }, '更新公开链接失败')).share;
}

export async function deleteConversationShare(conversationId: string): Promise<void> {
    await shareRequest<{ revoked: boolean }>(shareEndpoint(conversationId), { method: 'DELETE' }, '删除公开链接失败');
}

export async function fetchConversationShares(): Promise<ConversationShareSummary[]> {
    return (await shareRequest<{ shares: ConversationShareSummary[] }>('/api/shares', undefined, '读取分享链接失败')).shares;
}

export function shareAbsoluteUrl(path: string): string {
    return new URL(path, window.location.origin).toString();
}

/** Copies the public URL; resolves false when the clipboard is unavailable. */
export async function copyShareUrl(path: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(shareAbsoluteUrl(path));
        return true;
    } catch {
        return false;
    }
}
