import { DEFAULT_DIVINATION_TIMEZONE } from 'taibu-core/timezone-utils';
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

type StoredBirth = {
    name?: string; year?: number; month?: number; day?: number; hour?: number; minute?: number;
    calendarType?: string; isLeapMonth?: boolean; gender?: string; timezone?: string; longitude?: number;
};

/** 「甲：1990年1月15日 9:05（农历闰月，男，经度 116.4）」：一方的出生资料，足够据此重排八字或合盘。 */
function birthLine(person: StoredBirth, fallbackName: string): string {
    const time = typeof person.hour === 'number' ? ` ${person.hour}:${String(person.minute ?? 0).padStart(2, '0')}` : '';
    const notes = [
        person.calendarType === 'lunar' ? `农历${person.isLeapMonth ? '闰月' : ''}` : '',
        person.gender === 'male' ? '男' : person.gender === 'female' ? '女' : '',
        person.timezone && person.timezone !== DEFAULT_DIVINATION_TIMEZONE ? person.timezone : '',
        typeof person.longitude === 'number' ? `经度 ${person.longitude}` : '',
    ].filter(Boolean);
    return `- ${person.name || fallbackName}：${person.year ?? '-'}年${person.month ?? '-'}月${person.day ?? '-'}日${time}${notes.length ? `（${notes.join('，')}）` : ''}`;
}

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
                person1?: StoredBirth;
                person2?: StoredBirth;
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
            person1 ? birthLine(person1, r.person1_name) : '',
            person2 ? birthLine(person2, r.person2_name) : '',
            (result?.overallScore ?? r.compatibility_score) != null ? `- 综合契合度：${result?.overallScore ?? r.compatibility_score}分` : '',
            dimensionsSummary ? `\n## 各维度分析\n${dimensionsSummary}` : '',
            `\n## 潜在冲突点\n${conflictsSummary}`,
        ].filter(Boolean).join('\n');
    },

    summarize(r: HepanRow): string {
        return `${r.person1_name} × ${r.person2_name}`;
    }
};
