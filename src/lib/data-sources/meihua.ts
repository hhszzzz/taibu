import { getSystemAdminClient } from '@/lib/api-utils';
import { buildMeihuaCanonicalText, type MeihuaWebBundle } from '@/lib/divination/meihua';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

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
    const supabase = ctx?.client ?? getSystemAdminClient();
    const { data, error } = await supabase
      .from('meihua_divinations')
      .select('id, question, method, cast_datetime, main_hexagram, changed_hexagram, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(ctx?.limit ?? 50);
    if (error) throw new Error(error.message);
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: 'meihua_divination' as const,
      name: `梅花易数 · ${String(row.main_hexagram || '本卦')}`,
      preview: typeof row.question === 'string' && row.question.trim() ? row.question : `${row.cast_datetime || ''}`,
      createdAt: String(row.created_at || ''),
    }));
  },

  async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<MeihuaRow | null> {
    const supabase = ctx?.client ?? getSystemAdminClient();
    const { data, error } = await supabase.from('meihua_divinations').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as MeihuaRow | null;
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
