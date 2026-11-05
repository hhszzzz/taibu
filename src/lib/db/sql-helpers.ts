import { sql, type Expression, type Kysely, type Transaction } from 'kysely';
import type { DB } from './generated/schema';

/** pg encodes a JS array as a PostgreSQL array literal; jsonb must be JSON text. */
export function json(value: unknown): Expression<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Bind an array as one PostgreSQL parameter instead of Kysely's tuple expansion. */
export function arrayValue<T>(value: T[]): Expression<T[]> {
  return sql.val(value);
}

/** Escape user input before ILIKE: backslash, percent and underscore. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** A bound ILIKE comparison for one text column, for keywords that are not part of a column catalog. */
export function textMatches(column: string, pattern: string) {
  return sql<boolean>`${sql.ref(column)} ilike ${pattern}`;
}

/** Sort key for `orderBy` that lists undated rows last, like the records page. */
export function descNullsLast(column: string) {
  return sql`${sql.ref(column)} desc nulls last`;
}

/** JSON text projection for one key, e.g. `source_data->>'chart_id'`. */
export function jsonFieldText(column: string, key: string) {
  return jsonPathText(column, [key]);
}

function jsonPathPrefix(column: string, path: readonly string[]): Expression<unknown> {
  let expression: Expression<unknown> = sql.ref(column);
  for (const key of path.slice(0, -1)) expression = sql`${expression}->${sql.lit(key)}`;
  return expression;
}

/**
 * JSON value projection along a key path, e.g. `result->'details'->'chartReference'`.
 * Keys are escaped SQL literals rather than parameters so the expression still
 * matches expression indexes such as `(result->'details')`.
 */
export function jsonPath(column: string, path: readonly string[]) {
  return sql<unknown>`${jsonPathPrefix(column, path)}->${sql.lit(path.at(-1)!)}`;
}

/** JSON text projection along a key path (escaped literals, as in jsonPath), e.g. `result->'details'->>'chartReference'`. */
export function jsonPathText(column: string, path: readonly string[]) {
  return sql<string | null>`${jsonPathPrefix(column, path)}->>${sql.lit(path.at(-1)!)}`;
}

type LooseTable = Record<string, Record<string, unknown>>;

function looseDb(trx: Transaction<DB>): Kysely<LooseTable> {
  return trx as unknown as Kysely<LooseTable>;
}

/**
 * Kysely cannot type a table chosen from a registry at runtime. Callers must pass a
 * table name from a compile-time registry (for example HISTORY_CONFIG), never request input.
 */
export function selectFromDynamic(trx: Transaction<DB>, table: string) {
  return looseDb(trx).selectFrom(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function insertIntoDynamic(trx: Transaction<DB>, table: string) {
  return looseDb(trx).insertInto(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function updateTableDynamic(trx: Transaction<DB>, table: string) {
  return looseDb(trx).updateTable(table);
}

/** Registry-controlled table names only; see selectFromDynamic. */
export function deleteFromDynamic(trx: Transaction<DB>, table: string) {
  return looseDb(trx).deleteFrom(table);
}

/**
 * Serializes the transactions that take the same key until they end, e.g. a per-user quota count followed by the
 * insert it allows. `namespace` keeps unrelated features' keys apart.
 */
export async function lockTransactionKey(trx: Transaction<DB>, key: string, namespace: number): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, ${namespace}::bigint))`.execute(trx);
}
