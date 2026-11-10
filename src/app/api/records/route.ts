/**
 * 记录列表 API 路由
 * GET: 获取记录列表
 * POST: 创建新记录
 */

import { NextRequest } from 'next/server';
import { RecordCategory, RecordFilters, normalizeRecordInput } from '@/lib/records';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';
import { arrayValue, escapeLike } from '@/lib/db/sql-helpers';

export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const { searchParams } = new URL(request.url);
        const rawPage = searchParams.get('page');
        const rawPageSize = searchParams.get('pageSize');

        const page = rawPage == null ? 1 : Number(rawPage);
        if (!Number.isInteger(page) || page < 1) {
            return jsonError('page 参数无效', 400);
        }

        const pageSize = rawPageSize == null ? 20 : Number(rawPageSize);
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            return jsonError('pageSize 参数无效', 400);
        }

        const category = searchParams.get('category') as RecordCategory | null;
        const search = searchParams.get('search');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const isPinned = searchParams.get('isPinned');
        const tags = searchParams.getAll('tag');
        const sort = searchParams.get('sort');
        if (sort != null && sort !== 'date') {
            return jsonError('sort 参数无效', 400);
        }

        const filters: RecordFilters = {};
        if (category) filters.category = category;
        if (search) filters.search = search;
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        if (isPinned === 'true') filters.isPinned = true;
        if (isPinned === 'false') filters.isPinned = false;
        if (tags.length > 0) filters.tags = tags;

        // 分页
        const from = (page - 1) * pageSize;
        const pattern = filters.search ? `%${escapeLike(filters.search)}%` : null;

        const { rows, totalRow } = await auth.db.tx(async (trx) => {
            let query = trx
                .selectFrom('ming_records_with_archive_status')
                .where('user_id', '=', user.id);
            if (filters.category) query = query.where('category', '=', filters.category);
            if (filters.isPinned !== undefined) query = query.where('is_pinned', '=', filters.isPinned);
            if (filters.startDate) query = query.where('event_date', '>=', filters.startDate);
            if (filters.endDate) query = query.where('event_date', '<=', filters.endDate);
            if (filters.tags && filters.tags.length > 0) query = query.where('tags', '&&', arrayValue(filters.tags));
            if (pattern) {
                // 标签也参与搜索：数组拼成一段文本再做模糊匹配，避免逐标签正则在路由里展开。
                query = query.where((eb) => eb.or([
                    eb('title', 'ilike', pattern),
                    eb('content', 'ilike', pattern),
                    eb(eb.fn('array_to_string', [eb.ref('tags'), eb.val(' ')]), 'ilike', pattern),
                ]));
            }
            // sort=date：按记录所在的日期排（事件日期，没有就用写入时间），置顶仍在前。
            const rows = await (sort === 'date'
                ? query.selectAll()
                    .orderBy('is_pinned', 'desc')
                    .orderBy((eb) => eb.fn.coalesce(eb.ref('event_date'), eb.ref('created_at')), 'desc')
                    .orderBy('created_at', 'desc')
                : query.selectAll()
                    .orderBy('is_pinned', 'desc')
                    .orderBy('created_at', 'desc'))
                .offset(from)
                .limit(pageSize)
                .execute();
            const totalRow = await query.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
            return { rows, totalRow };
        }, { isolationLevel: 'repeatable read' });

        return jsonOk({
            records: rows,
            total: Number(totalRow?.count ?? 0),
        });
    } catch (error) {
        console.error('获取记录失败:', error);
        return jsonError('获取记录失败', 500);
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return jsonError('请求体不是合法 JSON', 400);
        }
        const normalized = normalizeRecordInput(body, 'create');
        if ('error' in normalized) {
            return jsonError(normalized.error, 400);
        }

        const data = await auth.db.tx((trx) => trx
            .insertInto('ming_records')
            .values({
                user_id: user.id,
                ...normalized.data,
            } as never)
            .returningAll()
            .executeTakeFirstOrThrow());

        return jsonOk(data as unknown as Record<string, unknown>);
    } catch (error) {
        console.error('创建记录失败:', error);
        return jsonError('创建记录失败', 500);
    }
}
