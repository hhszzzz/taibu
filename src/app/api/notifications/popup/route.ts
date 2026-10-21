import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    let body: { id?: string }; try { body = await request.json(); } catch { return jsonError('通知无效', 400); }
    if (!body || typeof body.id !== 'string' || !isValidUUID(body.id)) return jsonError('通知无效', 400);
    try {
        const data = await auth.scoped.rpc('claim_notification_popup', { p_id: body.id });
        return jsonOk({ claimed: data === true });
    } catch {
        return jsonError('通知领取失败', 500);
    }
}
