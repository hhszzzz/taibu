import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { shareSummaryFromRow, type ConversationShareRow } from '@/lib/chat/conversation-share';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

const SHARE_LIST_LIMIT = 200;

/** The caller's active public links, newest first. Owner scoping is enforced by RLS and the filter. */
export async function GET(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('shares', '分享功能当前未启用');
    if (guard) return guard;
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const rows = await auth.db.tx((trx) => trx
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
