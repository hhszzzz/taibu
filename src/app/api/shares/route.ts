import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext, resolveRequestDbClient } from '@/lib/api-utils';
import { shareSummaryFromRow, type ConversationShareRow } from '@/lib/chat/conversation-share';

const SHARE_LIST_LIMIT = 200;

/** The caller's active public links, newest first. Owner scoping is enforced by RLS and the filter. */
export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('读取分享链接失败', 500);
    const { data, error } = await db.from('conversation_shares')
        .select('token,conversation_id,title,include_charts,created_at,updated_at')
        .eq('user_id', auth.user.id)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(SHARE_LIST_LIMIT);
    if (error) return jsonError('读取分享链接失败', 500);
    return jsonOk({ shares: ((data ?? []) as ConversationShareRow[]).map(shareSummaryFromRow) });
}
