import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';
import { toQimenText } from 'taibu-core/qimen';
import { getSystemAdminClient } from '@/lib/api-utils';
import {
    calculateQimenBundle,
    fromStoredQimenZhiFuJiGong,
    type QimenInput,
} from '@/lib/divination/qimen';
import { resolveChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type QimenRow = {
    id: string;
    user_id: string;
    question: string | null;
    dun_type: string;
    ju_number: number;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    timezone: string;
    pan_type: QimenInput['panType'];
    ju_method: QimenInput['juMethod'];
    zhi_fu_ji_gong: string | null;
    created_at: string;
};

const DUN_LABEL: Record<string, string> = { yang: '阳遁', yin: '阴遁' };

export const qimenProvider: DataSourceProvider<QimenRow> = {
    type: 'qimen_chart',
    displayName: '奇门遁甲',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('qimen_charts')
            .select('id, question, dun_type, ju_number, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; question: string | null; dun_type: string; ju_number: number; created_at: string }) => {
            const dunLabel = DUN_LABEL[row.dun_type] || row.dun_type;
            return {
                id: row.id,
                type: 'qimen_chart' as const,
                name: `奇门遁甲 - ${dunLabel}${row.ju_number}局`,
                preview: row.question ? `问题：${row.question}` : `${dunLabel}${row.ju_number}局`,
                createdAt: row.created_at,
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<QimenRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('qimen_charts')
            .select('id, question, dun_type, ju_number, year, month, day, hour, minute, timezone, pan_type, ju_method, zhi_fu_ji_gong, created_at')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as QimenRow) || null;
    },

    async formatForAI(r: QimenRow, ctx?: DataSourceQueryContext): Promise<string> {
        const { output } = await calculateQimenBundle({
            year: r.year,
            month: r.month,
            day: r.day,
            hour: r.hour,
            minute: r.minute,
            timezone: r.timezone || DEFAULT_DIVINATION_TIMEZONE,
            question: r.question ?? undefined,
            panType: r.pan_type,
            juMethod: r.ju_method,
            zhiFuJiGong: fromStoredQimenZhiFuJiGong(r.zhi_fu_ji_gong),
        });

        return toQimenText(r.question ? { ...output, question: r.question } : output, {
            detailLevel: resolveChartTextDetailLevel('qimen', ctx?.chartPromptDetailLevel),
        });
    },

    summarize(r: QimenRow): string {
        return r.question || '奇门遁甲排盘';
    },
};
