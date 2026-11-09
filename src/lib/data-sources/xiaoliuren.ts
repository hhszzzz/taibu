import { buildXiaoliurenCanonicalText, type XiaoliurenWebBundle } from '@/lib/divination/xiaoliuren';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type XiaoliurenRow = {
  id: string;
  user_id: string | null;
  question: string | null;
  solar_datetime: string;
  lunar_month: number;
  lunar_day: number;
  is_leap_month: boolean;
  shichen: string;
  final_status: string;
  input_data: Record<string, unknown> | null;
  result_data: XiaoliurenWebBundle;
  conversation_id: string | null;
  created_at: string;
};

export const xiaoliurenProvider: DataSourceProvider<XiaoliurenRow> = {
  type: 'xiaoliuren_divination',
  displayName: '小六壬记录',

  async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
    const db = requireQueryDb(ctx);
    const data = await db.tx(async (trx) => {
      const query = applyListFilters(trx
        .selectFrom('xiaoliuren_divinations')
        .select(['id', 'question', 'solar_datetime', 'lunar_month', 'lunar_day', 'is_leap_month', 'final_status', 'created_at'])
        .where('user_id', '=', userId), ctx, ['question']);
      if (!query) return [];
      return (ctx?.offset ? query.offset(ctx.offset) : query)
        .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(ctx?.limit ?? 50).execute();
    });
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: 'xiaoliuren_divination' as const,
      name: `小六壬 · ${String(row.final_status || '落宫')}`,
      preview: typeof row.question === 'string' && row.question.trim() ? row.question : `${row.solar_datetime || ''}`,
      createdAt: String(row.created_at || ''),
    }));
  },

  async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<XiaoliurenRow | null> {
    const db = requireQueryDb(ctx);
    const data = await db.tx((trx) => trx
        .selectFrom('xiaoliuren_divinations')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
    return data as unknown as XiaoliurenRow | null;
  },

  formatForAI(row: XiaoliurenRow): string {
    return row.result_data?.result
      ? buildXiaoliurenCanonicalText(row.result_data.result)
      : '小六壬起课记录缺失';
  },

  summarize(row: XiaoliurenRow): string {
    const lunar = `${row.is_leap_month ? '闰' : ''}${row.lunar_month}月${row.lunar_day}日`;
    return `小六壬 ${row.final_status || ''} · ${lunar}${row.question ? ` · ${row.question}` : ''}`;
  },
};
