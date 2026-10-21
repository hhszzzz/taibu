// Type-only server provider contract; browser DTOs and catalogs stay in types.ts.
import type { ScopedDb } from '@/lib/db/context.server';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary, DataSourceType } from '@/lib/data-sources/types';

export type DataSourceQueryContext = {
    db?: ScopedDb;
    limit?: number;
    maxTokens?: number;
    maxChars?: number;
    chartPromptDetailLevel?: ChartTextDetailLevel;
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
