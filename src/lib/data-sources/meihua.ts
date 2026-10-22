import { buildMeihuaCanonicalText, type MeihuaWebBundle } from '@/lib/divination/meihua';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type MeihuaRow = {
  id: string;
  user_id: string | null;
  question: string;
  method: string;
  cast_datetime: string;
  main_hexagram: string;
  changed_hexagram: string | null;
  input_data: Record<string, unknown>;
  result_data: MeihuaWebBundle;
  conversation_id: string | null;
  created_at: string;
};

export const meihuaProvider: DataSourceProvider<MeihuaRow> = {
  type: 'meihua_divination',
  displayName: '梅花易数记录',

  async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
    const db = requireQueryDb(ctx);
    const data = await db.tx(async (trx) => {
      const query = applyListFilters(trx
        .selectFrom('meihua_divinations')
        .select(['id', 'question', 'method', 'cast_datetime', 'main_hexagram', 'changed_hexagram', 'created_at'])
        .where('user_id', '=', userId), ctx, ['question']);
      if (!query) return [];
      return query.orderBy('created_at', 'desc').limit(ctx?.limit ?? 50).execute();
    });
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: 'meihua_divination' as const,
      name: `梅花易数 · ${String(row.main_hexagram || '本卦')}`,
      preview: typeof row.question === 'string' && row.question.trim() ? row.question : `${row.cast_datetime || ''}`,
      createdAt: String(row.created_at || ''),
    }));
  },

  async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<MeihuaRow | null> {
    const db = requireQueryDb(ctx);
    const data = await db.tx((trx) => trx
        .selectFrom('meihua_divinations')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
    return data as unknown as MeihuaRow | null;
  },

  formatForAI(row: MeihuaRow): string {
    return row.result_data?.result
      ? buildMeihuaCanonicalText(row.result_data.result)
      : '梅花易数排盘记录缺失';
  },

  summarize(row: MeihuaRow): string {
    const changed = row.changed_hexagram ? ` 变 ${row.changed_hexagram}` : '';
    return `梅花易数 ${row.main_hexagram}${changed}${row.question ? ` · ${row.question}` : ''}`;
  },
};
