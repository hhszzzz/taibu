import { getSystemAdminClient } from '@/lib/api-utils';
import { getHepanTypeName, type HepanType } from '@/lib/divination/hepan';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type HepanRow = {
    id: string;
    user_id: string | null;
    type: string;
    person1_name: string;
    person1_birth: unknown;
    person2_name: string;
    person2_birth: unknown;
    compatibility_score: number | null;
    created_at: string;
    conversation_id: string | null;
    result_data: unknown;
};

export const hepanProvider: DataSourceProvider<HepanRow> = {
    type: 'hepan_chart',
    displayName: '合盘记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('hepan_charts')
            .select('id, type, person1_name, person2_name, compatibility_score, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; type: string; person1_name: string; person2_name: string; compatibility_score: number | null; created_at: string }) => {
            const typeName = getHepanTypeName(row.type as HepanType);
            const preview = row.compatibility_score != null
                ? `匹配度：${row.compatibility_score} / ${typeName}`
                : `类型：${typeName}`;
            return {
                id: row.id,
                type: 'hepan_chart',
                name: `${typeName} - ${row.person1_name} × ${row.person2_name}`,
                preview,
                createdAt: row.created_at,
                hepanType: row.type as HepanType
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<HepanRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('hepan_charts')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as HepanRow) || null;
    },

    formatForAI(r: HepanRow): string {
        const result = (r.result_data && typeof r.result_data === 'object')
            ? r.result_data as {
                type?: string;
                overallScore?: number;
                person1?: { name?: string; year?: number; month?: number; day?: number };
                person2?: { name?: string; year?: number; month?: number; day?: number };
                dimensions?: Array<{ name?: string; score?: number; description?: string }>;
                conflicts?: Array<{ severity?: string; title?: string; description?: string }>;
            }
            : null;
        const typeName = getHepanTypeName((result?.type || r.type) as HepanType);
        const person1 = result?.person1;
        const person2 = result?.person2;
        const dimensionsSummary = Array.isArray(result?.dimensions) && result!.dimensions.length > 0
            ? result!.dimensions
                .map((d) => `${d.name || '维度'}: ${d.score ?? 0}分${d.description ? ` - ${d.description}` : ''}`)
                .join('\n')
            : '';
        const conflictsSummary = Array.isArray(result?.conflicts) && result!.conflicts.length > 0
            ? result!.conflicts
                .map((c) => `[${c.severity || '未知'}] ${c.title || '冲突'}${c.description ? `: ${c.description}` : ''}`)
                .join('\n')
            : '无明显冲突';

        return [
            `## 合盘分析：${r.person1_name} × ${r.person2_name}`,
            `- 合盘类型：${typeName}`,
            person1 ? `- ${person1.name || r.person1_name}：${person1.year ?? '-'}年${person1.month ?? '-'}月${person1.day ?? '-'}日` : '',
            person2 ? `- ${person2.name || r.person2_name}：${person2.year ?? '-'}年${person2.month ?? '-'}月${person2.day ?? '-'}日` : '',
            (result?.overallScore ?? r.compatibility_score) != null ? `- 综合契合度：${result?.overallScore ?? r.compatibility_score}分` : '',
            dimensionsSummary ? `\n## 各维度分析\n${dimensionsSummary}` : '',
            `\n## 潜在冲突点\n${conflictsSummary}`,
        ].filter(Boolean).join('\n');
    },

    summarize(r: HepanRow): string {
        return `${r.person1_name} × ${r.person2_name}`;
    }
};
