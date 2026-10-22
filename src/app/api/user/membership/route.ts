import { type NextRequest } from 'next/server';

import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import { buildMembershipInfo, type MembershipInfoSource } from '@/lib/user/membership';

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const loadMembershipRow = async () => await auth.db.tx((trx) => trx
        .selectFrom('users')
        .select(['membership', 'membership_expires_at', 'ai_chat_count'])
        .where('id', '=', auth.user.id)
        .executeTakeFirst());

    let data;
    try {
        data = await loadMembershipRow();
    } catch (error) {
        console.error('获取会员信息失败:', error);
        return jsonError('获取会员信息失败', 500);
    }

    if (!data) {
        const ensured = await ensureUserRecordRow(auth.db, auth.user);
        if (!ensured.ok) {
            return jsonError('获取会员信息失败', 500);
        }
        try {
            data = await loadMembershipRow();
        } catch (error) {
            console.error('获取会员信息失败:', error);
            return jsonError('获取会员信息失败', 500);
        }
    }

    if (!data || typeof data.ai_chat_count !== 'number' || Number.isNaN(data.ai_chat_count)) {
        return jsonError('获取会员信息失败', 500);
    }

    return jsonOk({
        userId: auth.user.id,
        membership: buildMembershipInfo(data as MembershipInfoSource),
    });
}
