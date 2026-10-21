import { type NextRequest } from 'next/server';

import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { ensureUserRecordRow } from '@/lib/user/profile-record';
import { buildMembershipInfo, type MembershipInfoSource } from '@/lib/user/membership';

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) {
        return jsonError(auth.error.message, auth.error.status);
    }

    const loadMembershipRow = async () => await auth.db
        .from('users')
        .select('membership, membership_expires_at, ai_chat_count')
        .eq('id', auth.user.id)
        .maybeSingle();

    let { data, error } = await loadMembershipRow();
    if (!data && !error) {
        const recoveryProbe = auth.db.from('users');
        if (typeof recoveryProbe.upsert !== 'function') {
            return jsonError('获取会员信息失败', 500);
        }
        const ensured = await ensureUserRecordRow(auth.scoped, auth.user);
        if (ensured.ok) {
            const nextResult = await loadMembershipRow();
            data = nextResult.data;
            error = nextResult.error;
        } else {
            return jsonError('获取会员信息失败', 500);
        }
    }

    if (error) {
        return jsonError('获取会员信息失败', 500);
    }

    if (!data || typeof data.ai_chat_count !== 'number' || Number.isNaN(data.ai_chat_count)) {
        return jsonError('获取会员信息失败', 500);
    }

    return jsonOk({
        userId: auth.user.id,
        membership: buildMembershipInfo(data as MembershipInfoSource),
    });
}
