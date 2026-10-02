import { getSystemAdminClient } from '@/lib/api-utils';
import { buildXiaoliurenCanonicalText, type XiaoliurenWebBundle } from '@/lib/divination/xiaoliuren';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

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
    const supabase = ctx?.client ?? getSystemAdminClient();
    const { data, error } = await supabase
      .from('xiaoliuren_divinations')
      .select('id, question, solar_datetime, lunar_month, lunar_day, is_leap_month, final_status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(ctx?.limit ?? 50);
    if (error) throw new Error(error.message);
    return (data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      type: 'xiaoliuren_divination' as const,
      name: `小六壬 · ${String(row.final_status || '落宫')}`,
      preview: typeof row.question === 'string' && row.question.trim() ? row.question : `${row.solar_datetime || ''}`,
      createdAt: String(row.created_at || ''),
    }));
  },

  async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<XiaoliurenRow | null> {
    const supabase = ctx?.client ?? getSystemAdminClient();
    const { data, error } = await supabase.from('xiaoliuren_divinations').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as XiaoliurenRow | null;
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
