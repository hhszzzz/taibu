import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const { id } = await params;
    if (!isValidUUID(id)) return jsonError('任务 ID 无效', 400);
    const db = auth.scoped;
    let body: { sequence?: number; revision?: number; action?: string; content?: string; sortOrder?: number };
    try { body = await request.json(); } catch { return jsonError('请求体无效', 400); }
    if (!body || !Number.isSafeInteger(body.sequence) || !Number.isSafeInteger(body.revision) || !['edit','withdraw','order','promote'].includes(body.action ?? '')) return jsonError('队列操作无效', 400);
    const { sequence, revision, action } = body as { sequence: number; revision: number; action: string };
    try {
        const command = await db.rpc('agent_change_command', { p_run_id: id, p_sequence: sequence, p_revision: revision, p_action: action, p_payload: { content: body.content, sortOrder: body.sortOrder } });
        return jsonOk({ command });
    } catch (error) {
        const code = (error as { code?: string }).code;
        return jsonError(code === '40001' ? '输入已交给 Agent 或已被另一页面修改，请刷新队列' : '队列操作失败', code === '40001' ? 409 : code === '42501' ? 404 : 400);
    }
}
