import { getSystemAdminClient } from '@/lib/api-utils';
import { formatZiweiPromptText } from '@/lib/ziwei-chart-prompt';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type ZiweiRow = {
    id: string;
    user_id: string | null;
    name: string;
    gender: string | null;
    birth_date: string;
    birth_time: string;
    calendar_type: string | null;
    is_leap_month: boolean | null;
    birth_place: string | null;
    longitude: number | null;
    created_at: string;
};

export const ziweiProvider: DataSourceProvider<ZiweiRow> = {
    type: 'ziwei_chart',
    displayName: '紫微命盘',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('ziwei_charts')
            .select('id, name, birth_date, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((chart: { id: string; name: string | null; birth_date: string; created_at: string }) => ({
            id: chart.id,
            type: 'ziwei_chart',
            name: chart.name || '未命名命盘',
            preview: `紫微命盘 - ${chart.birth_date}`,
            createdAt: chart.created_at
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<ZiweiRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('ziwei_charts')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as ZiweiRow) || null;
    },

    formatForAI(chart: ZiweiRow, ctx?: DataSourceQueryContext): string {
        const name = chart.name || '未命名';
        const birth = `${chart.birth_date} ${chart.birth_time}`;
        const canonicalText = formatZiweiPromptText({
            name,
            gender: (chart.gender === 'male' || chart.gender === 'female') ? chart.gender : undefined,
            birthDate: chart.birth_date,
            birthTime: chart.birth_time,
            birthPlace: chart.birth_place || undefined,
            longitude: chart.longitude ?? undefined,
            calendarType: (chart.calendar_type as 'solar' | 'lunar' | undefined) || 'solar',
            isLeapMonth: chart.is_leap_month ?? false,
        }, ctx?.chartPromptDetailLevel);
        if (canonicalText) return canonicalText;
        return `紫微命盘：${name}\n出生时间：${birth}\n命盘数据不完整，无法重建标准命盘文本。`;
    },

    summarize(chart: ZiweiRow): string {
        return `${chart.name || '未命名'} - ${chart.birth_date}`;
    }
};
