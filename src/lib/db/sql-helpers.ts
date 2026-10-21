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
  return jsonPathText(column, [key]);
}

/** JSON value projection along a bound key path, e.g. `result->'details'->'chartReference'`. */
export function jsonPath(column: string, path: readonly string[]) {
  let expression: Expression<unknown> = sql.ref(column);
  for (const key of path.slice(0, -1)) expression = sql`${expression}->${sql.lit(key)}`;
  return sql<unknown>`${expression}->${sql.lit(path.at(-1)!)}`;
}

/** JSON text projection along a bound key path, e.g. `result->'details'->>'chartReference'`. */
export function jsonPathText(column: string, path: readonly string[]) {
  let expression: Expression<unknown> = sql.ref(column);
  for (const key of path.slice(0, -1)) expression = sql`${expression}->${sql.lit(key)}`;
  return sql<string | null>`${expression}->>${sql.lit(path.at(-1)!)}`;
}

type LooseTable = Record<string, Record<string, unknown>>;

/**
 * Kysely cannot type a table chosen from a registry at runtime. Callers must pass a
 * table name from a compile-time registry (for example HISTORY_CONFIG), never request input.
 */
export function selectFromDynamic(trx: Transaction<DB>, table: string) {
  return (trx as unknown as Kysely<LooseTable>).selectFrom(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function insertIntoDynamic(trx: Transaction<DB>, table: string) {
  return (trx as unknown as Kysely<LooseTable>).insertInto(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function updateTableDynamic(trx: Transaction<DB>, table: string) {
  return (trx as unknown as Kysely<LooseTable>).updateTable(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function deleteFromDynamic(trx: Transaction<DB>, table: string) {
  return (trx as unknown as Kysely<LooseTable>).deleteFrom(table);
}
