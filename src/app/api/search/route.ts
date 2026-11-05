import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { escapeLike } from '@/lib/db/sql-helpers';

interface ChartRow { id: string; name: string; birth_date: string; birth_time: string | null }

function settle<T>(promise: Promise<T>) {
    return promise.then(
        (data) => ({ data, error: null }),
        (error: unknown) => ({ data: null, error }),
    );
}

/** 命盘检索与对话检索并行；命盘查询失败只省略该分组，不让整次搜索失败。 */
export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    // 空词 = 搜索弹层的「最近使用」：只列最近的对话，不查命盘。
    if (!query) {
        const rows = await auth.db.tx((trx) => trx
            .selectFrom('conversations_with_archive_status')
            .select(['id', 'title', 'updated_at'])
            .where('user_id', '=', auth.user.id)
            .where('is_archived', '=', false)
            .orderBy('updated_at', 'desc')
            .limit(8)
            .execute()).catch(() => null);
        if (rows === null) return jsonError('搜索失败', 500);
        return jsonOk({
            results: rows.map(row => ({ conversationId: row.id, messageId: null, title: row.title ?? '对话', preview: '' })),
            charts: [],
        });
    }
    if (query.length > 200) return jsonError('搜索词须为 1–200 个字符', 400);
    const db = auth.db;
    const pattern = `%${escapeLike(query)}%`;
    const [messages, bazi, ziwei] = await Promise.all([
        settle(db.rpc('search_conversation_messages', { p_query: query, p_limit: 30 })),
        settle(db.tx((trx) => trx
            .selectFrom('bazi_charts')
            .select(['id', 'name', 'birth_date', 'birth_time'])
            .where('user_id', '=', auth.user.id)
            .where('name', 'ilike', pattern)
            .orderBy('created_at', 'desc')
            .limit(5)
            .execute())),
        settle(db.tx((trx) => trx
            .selectFrom('ziwei_charts')
            .select(['id', 'name', 'birth_date', 'birth_time'])
            .where('user_id', '=', auth.user.id)
            .where('name', 'ilike', pattern)
            .orderBy('created_at', 'desc')
            .limit(5)
            .execute())),
    ]);
    if (messages.error) {
        const code = (messages.error as { code?: string }).code;
        return jsonError(code === '57014' ? '搜索超时，请缩短搜索词后重试' : '搜索失败', code === '57014' ? 504 : 500);
    }
    const charts = [
        ...(bazi.data ?? []).map(row => ({ ...(row as ChartRow), kind: 'bazi' as const })),
        ...(ziwei.data ?? []).map(row => ({ ...(row as ChartRow), kind: 'ziwei' as const })),
    ];
    return jsonOk({ results: messages.data ?? [], charts });
}
