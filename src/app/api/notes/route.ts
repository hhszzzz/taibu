/**
 * 小记 API 路由
 * GET: 获取小记列表
 * POST: 创建小记
 * DELETE: 删除小记
 */

import { NextRequest } from 'next/server';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import type { ScopedDb } from '@/lib/db/context.server';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

type Trx = Parameters<Parameters<ScopedDb['tx']>[0]>[0];

/** The note list and its total share these date filters; both run in their own transaction. */
function notesQuery(trx: Trx, userId: string, date: string | null, startDate: string | null, endDate: string | null) {
    let query = trx.selectFrom('ming_notes').where('user_id', '=', userId);
    if (date) query = query.where('note_date', '=', date);
    if (startDate) query = query.where('note_date', '>=', startDate);
    if (endDate) query = query.where('note_date', '<=', endDate);
    return query;
}

export async function GET(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('records', '命理记录功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const page = Math.max(Number(searchParams.get('page') || 1), 1);
        const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 20), 1), 100);

        const from = (page - 1) * pageSize;

        const [notes, totalRow] = await Promise.all([
            auth.db.tx((trx) => notesQuery(trx, user.id, date, startDate, endDate)
                .selectAll()
                .orderBy('created_at', 'desc')
                .offset(from)
                .limit(pageSize)
                .execute()),
            auth.db.tx((trx) => notesQuery(trx, user.id, date, startDate, endDate)
                .select((eb) => eb.fn.countAll<number>().as('count'))
                .executeTakeFirst()),
        ]);

        return jsonOk({ notes, total: Number(totalRow?.count ?? 0) });
    } catch (error) {
        console.error('获取小记失败:', error);
        return jsonError('获取小记失败', 500);
    }
}

export async function POST(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('records', '命理记录功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const body = await request.json() as {
            content?: unknown;
            note_date?: string;
            mood?: string | null;
        };

        if (!body.content) {
            return jsonError('内容不能为空', 400);
        }

        const data = await auth.db.tx((trx) => trx
            .insertInto('ming_notes')
            .values({
                user_id: user.id,
                note_date: body.note_date || new Date().toISOString().split('T')[0],
                content: body.content,
                mood: body.mood || null,
            } as never)
            .returningAll()
            .executeTakeFirstOrThrow());

        return jsonOk(data as Record<string, unknown>);
    } catch (error) {
        console.error('创建小记失败:', error);
        return jsonError('创建小记失败', 500);
    }
}

export async function DELETE(request: NextRequest) {
    const guard = await ensureFeatureEnabledFresh('records', '命理记录功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return jsonError('缺少 id 参数', 400);
        }

        await auth.db.tx((trx) => trx
            .deleteFrom('ming_notes')
            .where('id', '=', id)
            .where('user_id', '=', user.id)
            .execute());

        return jsonOk({ success: true });
    } catch (error) {
        console.error('删除小记失败:', error);
        return jsonError('删除小记失败', 500);
    }
}
