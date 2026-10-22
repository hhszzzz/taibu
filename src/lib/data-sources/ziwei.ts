import { formatZiweiPromptText } from '@/lib/ziwei-chart-prompt';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';
import type { BirthTimeResolution } from '@/lib/divination/birth-time';

type ZiweiRow = BirthTimeResolution & {
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
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('ziwei_charts')
                .select(['id', 'name', 'birth_date', 'created_at'])
                .where('user_id', '=', userId), ctx, ['name']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return (data || []).map((chart) => ({
            id: chart.id,
            type: 'ziwei_chart',
            name: chart.name || '未命名命盘',
            preview: `紫微命盘 - ${chart.birth_date}`,
            createdAt: chart.created_at ?? '',
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<ZiweiRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('ziwei_charts')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
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
            timezone: chart.timezone,
            disambiguation: chart.disambiguation,
        }, ctx?.chartPromptDetailLevel);
        if (canonicalText) return canonicalText;
        return `紫微命盘：${name}\n出生时间：${birth}\n命盘数据不完整，无法重建标准命盘文本。`;
    },

    summarize(chart: ZiweiRow): string {
        return `${chart.name || '未命名'} - ${chart.birth_date}`;
    }
};
