import { getHepanTypeName, type HepanType } from '@/lib/divination/hepan';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

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
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('hepan_charts')
                .select(['id', 'type', 'person1_name', 'person2_name', 'compatibility_score', 'created_at'])
                .where('user_id', '=', userId), ctx, ['person1_name', 'person2_name']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => {
            const typeName = getHepanTypeName(row.type as HepanType);
            const preview = row.compatibility_score != null
                ? `匹配度：${row.compatibility_score} / ${typeName}`
                : `类型：${typeName}`;
            return {
                id: row.id,
                type: 'hepan_chart',
                name: `${typeName} - ${row.person1_name} × ${row.person2_name}`,
                preview,
                createdAt: row.created_at ?? '',
                hepanType: row.type as HepanType
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<HepanRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('hepan_charts')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
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
