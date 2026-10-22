import { sql, type SelectQueryBuilder } from 'kysely';
import type { DB } from '@/lib/db/generated/schema';
import { escapeLike } from '@/lib/db/sql-helpers';

/** The conditions a data source's list narrows by; the Agent's listConditions builds them. */
export interface DataSourceListConditions {
    keyword?: string;
    since?: string;
    until?: string;
}

/** The instant a China Standard Time day starts, `days` after `date` (YYYY-MM-DD). */
function chinaDayStart(date: string, days = 0): string {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + days);
    return `${day.toISOString().slice(0, 10)}T00:00:00+08:00`;
}

/**
 * A data source's list narrowed to the Agent's conditions: the keyword in any of the source's text columns (as the
 * records page searches) and the saved date from `since` through `until`. Null when a keyword is given but the source
 * has no text of its own, so it lists nothing rather than everything.
 */
export function applyListFilters<TB extends keyof DB, O>(
    query: SelectQueryBuilder<DB, TB, O>,
    ctx: DataSourceListConditions | undefined,
    textColumns: readonly string[],
): SelectQueryBuilder<DB, TB, O> | null {
    let filtered = query;
    if (ctx?.keyword) {
        if (!textColumns.length) return null;
        const pattern = `%${escapeLike(ctx.keyword)}%`;
        const matches = sql.join(textColumns.map(column => sql`${sql.ref(column)} ilike ${pattern}`), sql` or `);
        filtered = filtered.where(sql<boolean>`(${matches})`);
    }
    if (ctx?.since) filtered = filtered.where(sql<boolean>`created_at >= ${chinaDayStart(ctx.since)}`);
    if (ctx?.until) filtered = filtered.where(sql<boolean>`created_at < ${chinaDayStart(ctx.until, 1)}`);
    return filtered;
}
