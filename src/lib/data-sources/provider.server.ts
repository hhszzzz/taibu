// Type-only server provider contract; browser DTOs and catalogs stay in types.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChartTextDetailLevel } from '@/lib/divination/detail-level';
import type { DataSourceSummary, DataSourceType } from '@/lib/data-sources/types';

export type DataSourceQueryContext = {
    client?: SupabaseClient;
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
