import { toDaliurenText, type DaliurenOutput } from 'taibu-core/daliuren';
import { resolveChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type DaliurenRow = {
    id: string;
    user_id: string | null;
    question: string | null;
    solar_date: string;
    day_ganzhi: string;
    hour_ganzhi: string;
    yue_jiang: string;
    result_data: DaliurenOutput;
    settings: Record<string, unknown> | null;
    conversation_id: string | null;
    created_at: string;
};

export const daliurenProvider: DataSourceProvider<DaliurenRow> = {
    type: 'daliuren_divination',
    displayName: '大六壬记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('daliuren_divinations')
                .select(['id', 'question', 'solar_date', 'day_ganzhi', 'hour_ganzhi', 'yue_jiang', 'created_at'])
                .where('user_id', '=', userId), ctx, ['question']);
            if (!query) return [];
            return (ctx?.offset ? query.offset(ctx.offset) : query)
                .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => ({
            id: row.id,
            type: 'daliuren_divination' as const,
            name: `${row.day_ganzhi}日`,
            preview: row.question || `${row.solar_date} 起课`,
            createdAt: row.created_at ?? '',
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<DaliurenRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('daliuren_divinations')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return data as unknown as DaliurenRow | null;
    },

    formatForAI(row: DaliurenRow, ctx?: DataSourceQueryContext): string {
        const result = row.result_data;
        if (!result) {
            return '大六壬排盘记录缺失';
        }
        return toDaliurenText(row.question ? {
            ...result,
            question: row.question,
        } : result, {
            detailLevel: resolveChartTextDetailLevel('daliuren', ctx?.chartPromptDetailLevel),
        });
    },

    summarize(row: DaliurenRow): string {
        const keName = row.result_data?.keName;
        return `大六壬 ${keName || row.day_ganzhi + '日'}${row.question ? ' · ' + row.question : ''}`;
    },
};
