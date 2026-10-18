import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext, resolveRequestDbClient } from '@/lib/api-utils';
import { quotePostgrestString } from '@/lib/utils/postgrest';

interface ChartRow { id: string; name: string; birth_date: string; birth_time: string | null }

/** 命盘检索与对话检索并行；命盘查询失败只省略该分组，不让整次搜索失败。 */
export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    // 空词 = 搜索弹层的「最近使用」：只列最近的对话，不查命盘。
    if (!query) {
        const db = resolveRequestDbClient(auth);
        if (!db) return jsonError('搜索暂不可用', 503);
        const { data, error } = await db.from('conversations_with_archive_status')
            .select('id,title,updated_at')
            .eq('user_id', auth.user.id)
            .eq('is_archived', false)
            .order('updated_at', { ascending: false })
            .limit(8)
            .abortSignal(request.signal);
        if (error) return jsonError('搜索失败', 500);
        return jsonOk({
            results: (data ?? []).map(row => ({ conversationId: row.id, messageId: null, title: row.title ?? '对话', preview: '' })),
            charts: [],
        });
    }
    if (query.length > 200) return jsonError('搜索词须为 1–200 个字符', 400);
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('搜索暂不可用', 503);
    const pattern = quotePostgrestString(`%${query}%`);
    const select = 'id,name,birth_date,birth_time';
    const [messages, bazi, ziwei] = await Promise.all([
        db.rpc('search_conversation_messages', { p_query: query, p_limit: 30 }).abortSignal(request.signal),
        db.from('bazi_charts').select(select).eq('user_id', auth.user.id).ilike('name', pattern)
            .order('created_at', { ascending: false }).limit(5).abortSignal(request.signal),
        db.from('ziwei_charts').select(select).eq('user_id', auth.user.id).ilike('name', pattern)
            .order('created_at', { ascending: false }).limit(5).abortSignal(request.signal),
    ]);
    if (messages.error) return jsonError(messages.error.code === '57014' ? '搜索超时，请缩短搜索词后重试' : '搜索失败', messages.error.code === '57014' ? 504 : 500);
    const charts = [
        ...(!bazi.error ? (bazi.data ?? []) as ChartRow[] : []).map(row => ({ ...row, kind: 'bazi' as const })),
        ...(!ziwei.error ? (ziwei.data ?? []) as ChartRow[] : []).map(row => ({ ...row, kind: 'ziwei' as const })),
    ];
    return jsonOk({ results: messages.data ?? [], charts });
}
