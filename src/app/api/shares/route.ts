import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { shareSummaryFromRow, type ConversationShareRow } from '@/lib/chat/conversation-share';

const SHARE_LIST_LIMIT = 200;

/** The caller's active public links, newest first. Owner scoping is enforced by RLS and the filter. */
export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const rows = await auth.scoped.tx((trx) => trx
        .selectFrom('conversation_shares')
        .select(['token', 'conversation_id', 'title', 'include_charts', 'created_at', 'updated_at'])
        .where('user_id', '=', auth.user.id)
        .where('revoked_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(SHARE_LIST_LIMIT)
        .execute()).catch(() => null);
    if (rows === null) return jsonError('读取分享链接失败', 500);
    return jsonOk({ shares: (rows as ConversationShareRow[]).map(shareSummaryFromRow) });
}
