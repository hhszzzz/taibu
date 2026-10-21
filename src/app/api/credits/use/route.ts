/**
 * 积分扣减 API
 *
 * 服务端接口用于扣减用户积分
 */

import { NextRequest } from 'next/server';
import { attemptCreditUse, UserStateResolutionError } from '@/lib/user/credits';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';

export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const creditUse = await attemptCreditUse(user.id, {
            db: auth.scoped,
            user,
        });
        if (!creditUse.ok) {
            if (creditUse.reason === 'insufficient_credits') {
                return jsonError('积分不足', 400, { code: 'INSUFFICIENT_CREDITS' });
            }
            return jsonError('扣减失败', 500, { code: 'DEDUCTION_FAILED' });
        }

        return jsonOk({
            success: true,
            remaining: creditUse.remaining,
        });
    } catch (error) {
        if (error instanceof UserStateResolutionError) {
            return jsonError(error.message, 500, { code: error.code });
        }
        console.error('[credits/use] Error:', error);
        return jsonError('服务器错误', 500);
    }
}
