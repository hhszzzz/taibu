import { MING_RECORD_SOURCE_TYPE, type DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type RecordRow = {
    id: string;
    user_id: string;
    title: string;
    content: string | null;
    category: string | null;
    tags: string[] | null;
    created_at: string;
    updated_at: string;
};

export const recordProvider: DataSourceProvider<RecordRow> = {
    type: MING_RECORD_SOURCE_TYPE,
    displayName: '命理记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx((trx) => trx
        .selectFrom('ming_records')
        .select(['id', 'title', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute());
        return (data || []).map((row) => ({
            id: row.id,
            type: MING_RECORD_SOURCE_TYPE,
            name: row.title,
            preview: row.title,
            createdAt: row.created_at ?? '',
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
            r.content ? r.content : '',
            Array.isArray(r.tags) && r.tags.length ? `标签：${r.tags.join(', ')}` : '',
            r.category ? `分类：${r.category}` : ''
        ].filter(Boolean).join('\n\n');
    },

    summarize(r: RecordRow): string {
        return r.title;
    }
};
