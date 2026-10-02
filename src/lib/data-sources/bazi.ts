import { getSystemAdminClient } from '@/lib/api-utils';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { type BaziCaseProfile } from '@/lib/bazi-case-profile';
import { formatBaziPromptText } from '@/lib/bazi-prompt';
import { getBaziCaseProfileByChartId } from '@/lib/server/bazi-case-profile';

type BaziRow = {
    id: string;
    user_id: string | null;
    name: string;
    gender: 'male' | 'female' | null;
    birth_date: string;
    birth_time: string | null;
    birth_place: string | null;
    longitude: number | null;
    calendar_type: string | null;
    is_leap_month: boolean | null;
    created_at: string;
    caseProfile?: Pick<BaziCaseProfile, 'masterReview' | 'ownerFeedback' | 'events'> | null;
};

export const baziProvider: DataSourceProvider<BaziRow> = {
    type: 'bazi_chart',
    displayName: '八字命盘',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('bazi_charts')
            .select('id, name, birth_date, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        const rows = (data || []) as Array<{ id: string; name: string | null; birth_date: string; created_at: string }>;
        return rows.map((chart) => ({
            id: chart.id,
            type: 'bazi_chart',
            name: chart.name || '未命名命盘',
            preview: `八字命盘 - ${chart.birth_date}`,
            createdAt: chart.created_at
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<BaziRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('bazi_charts')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const caseProfile = await getBaziCaseProfileByChartId(supabase, id, userId);
        return {
            ...(data as BaziRow),
            caseProfile,
        };
    },

    formatForAI(chart: BaziRow, ctx?: DataSourceQueryContext): string {
        const name = chart.name || '未命名';
        return formatBaziPromptText({
            name,
            gender: chart.gender ?? 'male',
            birthDate: chart.birth_date,
            birthTime: chart.birth_time || undefined,
            birthPlace: chart.birth_place || undefined,
            longitude: chart.longitude ?? undefined,
            calendarType: (chart.calendar_type as 'solar' | 'lunar' | undefined) || 'solar',
            isLeapMonth: chart.is_leap_month ?? undefined,
        }, chart.caseProfile || null, ctx?.chartPromptDetailLevel);
    },

    summarize(chart: BaziRow): string {
        return `${chart.name || '未命名'} - ${chart.birth_date}`;
    }
};
