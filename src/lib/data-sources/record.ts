import { MING_RECORD_SOURCE_TYPE, type DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/data-sources/list-filters';
import { RECORD_CATEGORIES } from '@/lib/records';

type RecordRow = {
    id: string;
    user_id: string;
    title: string;
    content: string | null;
    category: string | null;
    tags: string[] | null;
    event_date: string | null;
    related_chart_type: string | null;
    related_chart_id: string | null;
    /** The Agent task that wrote the record, if one did (20261021_120000_agent_user_archive). */
    source_run_id: string | null;
    created_at: string;
    updated_at: string;
};

const categoryLabel = (category: string | null) => RECORD_CATEGORIES.find(item => item.value === category)?.label ?? category;

export const recordProvider: DataSourceProvider<RecordRow> = {
    type: MING_RECORD_SOURCE_TYPE,
    displayName: '命理记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('ming_records')
                .select(['id', 'title', 'category', 'event_date', 'source_run_id', 'created_at'])
                .where('user_id', '=', userId), ctx, ['title', 'content']);
            if (!query) return [];
            return query.orderBy('created_at', 'desc').limit(limit).execute();
        });
        return ((data || []) as Array<Pick<RecordRow, 'id' | 'title' | 'category' | 'event_date' | 'source_run_id' | 'created_at'>>).map(row => ({
            id: row.id,
            type: MING_RECORD_SOURCE_TYPE,
            name: row.title,
            preview: [categoryLabel(row.category), row.event_date && `事件日期 ${row.event_date}`, row.source_run_id && 'Agent 记录'].filter(Boolean).join(' · ') || row.title,
            createdAt: row.created_at
        }));
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<RecordRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('ming_records')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return (data as RecordRow) || null;
    },

    formatForAI(r: RecordRow): string {
        return [
            `## 命理记录：${r.title}`,
            [r.category && `分类：${categoryLabel(r.category)}`, r.event_date && `事件日期：${r.event_date}`, r.source_run_id && '由 Agent 记录'].filter(Boolean).join('；'),
            r.related_chart_type && r.related_chart_id ? `关联资料：${r.related_chart_type}:${r.related_chart_id}` : '',
            r.content ? r.content : '',
            Array.isArray(r.tags) && r.tags.length ? `标签：${r.tags.join(', ')}` : '',
        ].filter(Boolean).join('\n\n');
    },

    summarize(r: RecordRow): string {
        return r.title;
    }
};
