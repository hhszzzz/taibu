import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';
import { toQimenText } from 'taibu-core/qimen';
import {
    calculateQimenBundle,
    fromStoredQimenZhiFuJiGong,
    type QimenInput,
} from '@/lib/divination/qimen';
import { resolveChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

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

export function qimenInputFromRecord(r: QimenRow): QimenInput {
    return {
        year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute,
        timezone: r.timezone || DEFAULT_DIVINATION_TIMEZONE, question: r.question ?? undefined,
        panType: r.pan_type, juMethod: r.ju_method,
        zhiFuJiGong: fromStoredQimenZhiFuJiGong(r.zhi_fu_ji_gong),
        juNumber: r.ju_number, dunType: r.dun_type === 'yin' || r.dun_type === 'yang' ? r.dun_type : undefined,
    };
}

export const qimenProvider: DataSourceProvider<QimenRow> = {
    type: 'qimen_chart',
    displayName: '奇门遁甲',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('qimen_charts')
                .select(['id', 'question', 'dun_type', 'ju_number', 'created_at'])
                .where('user_id', '=', userId), ctx, ['question']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return (data || []).map((row: { id: string; question: string | null; dun_type: string; ju_number: number; created_at: string }) => {
            const dunLabel = DUN_LABEL[row.dun_type] || row.dun_type;
            return {
                id: row.id,
                type: 'qimen_chart' as const,
                name: `${dunLabel}${row.ju_number}局`,
                preview: row.question ? `问题：${row.question}` : `${dunLabel}${row.ju_number}局`,
                createdAt: row.created_at,
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<QimenRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('qimen_charts')
        .select(['id', 'question', 'dun_type', 'ju_number', 'year', 'month', 'day', 'hour', 'minute', 'timezone', 'pan_type', 'ju_method', 'zhi_fu_ji_gong', 'created_at'])
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return (data as QimenRow) || null;
    },

    async formatForAI(r: QimenRow, ctx?: DataSourceQueryContext): Promise<string> {
        const { output } = await calculateQimenBundle(qimenInputFromRecord(r));

        return toQimenText(r.question ? { ...output, question: r.question } : output, {
            detailLevel: resolveChartTextDetailLevel('qimen', ctx?.chartPromptDetailLevel),
        });
    },

    summarize(r: QimenRow): string {
        return r.question || '奇门遁甲排盘';
    },
};
