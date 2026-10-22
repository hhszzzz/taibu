import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { json } from '@/lib/db/sql-helpers';
import { isValidUUID } from '@/lib/validation';
import { parseNextTaskConfiguration } from '@/lib/chat/model-settings';
async function scope(request: NextRequest, id: string): Promise<
    { response: ReturnType<typeof jsonError> } | { db: ScopedDb; userId: string }
> {
    const auth = await requireUserContext(request);
    if ('error' in auth) return { response: jsonError(auth.error.message, auth.error.status) };
    if (!isValidUUID(id)) return { response: jsonError('对话 ID 无效', 400) };
    return { db: auth.db, userId: auth.user.id };
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const id = (await params).id;
    const ctx = await scope(request, id);
    if ('response' in ctx) return ctx.response;
    const result = await ctx.db.tx((trx) => trx
        .selectFrom('conversations')
        .select('next_task_config')
        .where('id', '=', id)
        .where('user_id', '=', ctx.userId)
        .executeTakeFirst()).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
    if (result.error) return jsonError('读取配置失败', 500);
    const { data } = result;
    if (!data) return jsonError('对话不存在', 404);
    return jsonOk({ configuration: data.next_task_config });
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const id = (await params).id;
    const ctx = await scope(request, id);
    if ('response' in ctx) return ctx.response;
    let configuration;
    try { configuration = parseNextTaskConfiguration(await request.json()); } catch { return jsonError('配置无效', 400); }
    const result = await ctx.db.tx((trx) => trx
        .updateTable('conversations')
        .set({ next_task_config: json(configuration) as never })
        .where('id', '=', id)
        .where('user_id', '=', ctx.userId)
        .returning('id')
        .executeTakeFirst()).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
    if (result.error) return jsonError('保存配置失败', 500);
    if (!result.data) return jsonError('对话不存在', 404);
    return jsonOk({ saved: true });
}
