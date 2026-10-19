import 'server-only';
import { createAnonClient } from '@/lib/api-utils';
import { isShareToken, parseSharedSnapshot, type SharedMessage } from './conversation-share';

export type PublicConversationShare = {
    title: string;
    messages: SharedMessage[];
    includeCharts: boolean;
    createdAt: string;
    updatedAt: string;
};

type PublicShareRow = { title: string; snapshot: unknown; include_charts: boolean; created_at: string; updated_at: string };

/**
 * Resolve an active public share anonymously. Malformed, unknown and revoked tokens
 * all return null so callers render the same 404; database failures throw.
 */
export async function loadPublicShare(token: string): Promise<PublicConversationShare | null> {
    if (!isShareToken(token)) return null;
    const { data, error } = await createAnonClient().rpc('get_conversation_share', { p_token: token });
    if (error) throw new Error('读取分享失败');
    const row = (Array.isArray(data) ? data[0] : null) as PublicShareRow | null | undefined;
    if (!row) return null;
    return {
        title: row.title || '对话',
        messages: parseSharedSnapshot(row.snapshot),
        includeCharts: row.include_charts === true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
