// Type-only server provider contract; browser DTOs and catalogs stay in types.ts.
import type { ScopedDb } from '@/lib/db/context.server';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary, DataSourceType } from '@/lib/data-sources/types';

export type DataSourceQueryContext = {
    db?: ScopedDb;
    limit?: number;
    /** Rows to skip in saved lists, ordered by created_at and id descending. */
    offset?: number;
    maxTokens?: number;
    maxChars?: number;
    /** The model the text is for: its tokenizer family prices the budget. */
    model?: string;
    chartPromptDetailLevel?: ChartTextDetailLevel;
    /** List conditions (list-filters.ts): a keyword in the source's own text, and a saved-date range in China time. */
    keyword?: string;
    since?: string;
    until?: string;
    /** Key events of a bazi chart's case notes to include; the chat prompt keeps the latest ten. */
    caseEventLimit?: number;
};

export interface DataSourceProvider<T = unknown> {
    type: DataSourceType;
    displayName: string;
    list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]>;
    get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<T | null>;
    formatForAI(data: T, ctx?: DataSourceQueryContext): string | Promise<string>;
    summarize(data: T): string;
}

/** Providers must run inside the caller's database scope; a missing scope fails closed. */
export function requireQueryDb(ctx?: DataSourceQueryContext): ScopedDb {
    if (!ctx?.db) throw new Error('数据库上下文缺失');
    return ctx.db;
}
