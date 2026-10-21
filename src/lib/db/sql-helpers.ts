import { sql, type Expression, type Kysely, type Transaction } from 'kysely';
import type { DB } from './generated/schema';

/** pg encodes a JS array as a PostgreSQL array literal; jsonb must be JSON text. */
export function json(value: unknown): Expression<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Escape user input before ILIKE: backslash, percent and underscore. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** JSON text projection with a bound key, e.g. `source_data->>'chart_id'`. */
export function jsonFieldText(column: string, key: string) {
  return sql<string | null>`${sql.ref(column)}->>${sql.lit(key)}`;
}

type LooseTable = Record<string, Record<string, unknown>>;

/**
 * Kysely cannot type a table chosen from a registry at runtime. Callers must pass a
 * table name from a compile-time registry (for example HISTORY_CONFIG), never request input.
 */
export function selectFromDynamic(trx: Transaction<DB>, table: string) {
  return (trx as unknown as Kysely<LooseTable>).selectFrom(table);
}
