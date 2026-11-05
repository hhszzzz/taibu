import { type NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { requireFeatureUserContext } from '@/lib/feature-gate-utils';
export async function POST(request: NextRequest) {
    const auth = await requireFeatureUserContext(request, 'notifications', '通知功能当前未启用');
    if ('response' in auth) return auth.response;
    let body: { id?: string }; try { body = await request.json(); } catch { return jsonError('通知无效', 400); }
    if (!body || typeof body.id !== 'string' || !isValidUUID(body.id)) return jsonError('通知无效', 400);
    try {
        const data = await auth.db.rpc('claim_notification_popup', { p_id: body.id });
        return jsonOk({ claimed: data === true });
    } catch {
        return jsonError('通知领取失败', 500);
    }
}
