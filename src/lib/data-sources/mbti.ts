import { getSystemAdminClient } from '@/lib/api-utils';
import { PERSONALITY_BASICS } from '@/lib/divination/mbti';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

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
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('mbti_readings')
            .select('id, mbti_type, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; mbti_type: string; created_at: string }) => ({
            id: row.id,
            type: 'mbti_reading',
            name: `MBTI · ${row.mbti_type}`,
            preview: `人格类型：${row.mbti_type}`,
            createdAt: row.created_at
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<MbtiRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('mbti_readings')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
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
