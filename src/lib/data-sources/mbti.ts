import { PERSONALITY_BASICS } from '@/lib/divination/mbti';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type MbtiRow = {
    id: string;
    user_id: string;
    mbti_type: string;
    scores: unknown;
    percentages: unknown;
    created_at: string;
    conversation_id: string | null;
};

export const mbtiProvider: DataSourceProvider<MbtiRow> = {
    type: 'mbti_reading',
    displayName: 'MBTI记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('mbti_readings')
                .select(['id', 'mbti_type', 'created_at'])
                .where('user_id', '=', userId), ctx, ['mbti_type']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => ({
            id: row.id,
            type: 'mbti_reading',
            name: `MBTI · ${row.mbti_type}`,
            preview: `人格类型：${row.mbti_type}`,
            createdAt: row.created_at ?? '',
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<MbtiRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('mbti_readings')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return (data as MbtiRow) || null;
    },

    formatForAI(r: MbtiRow): string {
        const basic = PERSONALITY_BASICS[r.mbti_type as keyof typeof PERSONALITY_BASICS];
        const percentages = (r.percentages && typeof r.percentages === 'object')
            ? r.percentages as {
                EI?: { E?: number; I?: number };
                SN?: { S?: number; N?: number };
                TF?: { T?: number; F?: number };
                JP?: { J?: number; P?: number };
            }
            : null;
        return [
            `## MBTI 测评：${r.mbti_type}`,
            basic?.title ? `- 类型名称：${basic.title}` : '',
            basic?.description ? `- 类型描述：${basic.description}` : '',
            percentages ? '\n## 维度分析' : '',
            percentages?.EI ? `- 外向(E) ${percentages.EI.E ?? 0}% vs 内向(I) ${percentages.EI.I ?? 0}%` : '',
            percentages?.SN ? `- 实感(S) ${percentages.SN.S ?? 0}% vs 直觉(N) ${percentages.SN.N ?? 0}%` : '',
            percentages?.TF ? `- 思考(T) ${percentages.TF.T ?? 0}% vs 情感(F) ${percentages.TF.F ?? 0}%` : '',
            percentages?.JP ? `- 判断(J) ${percentages.JP.J ?? 0}% vs 知觉(P) ${percentages.JP.P ?? 0}%` : '',
            r.scores ? `- 分数：${JSON.stringify(r.scores)}` : '',
            !percentages && r.percentages ? `- 比例：${JSON.stringify(r.percentages)}` : '',
        ].filter(Boolean).join('\n');
    },

    summarize(r: MbtiRow): string {
        return r.mbti_type;
    }
};
