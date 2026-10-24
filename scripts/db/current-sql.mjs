import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DATABASE_SQL_FILES = ['schema', 'functions', 'triggers', 'access', 'seed', 'indexes'];

export async function readDatabaseSql(root) {
  return Object.fromEntries(await Promise.all(DATABASE_SQL_FILES.map(async name =>
    [name, await readFile(path.join(root, 'database', `${name}.sql`), 'utf8')])));
}

// This validates the explicitly maintained table definitions, rather than
// guessing ALTER statements or silently resetting an existing database.
export function declaredTables(schema) {
  return [...schema.matchAll(/^CREATE TABLE ((?:identity|public)\.[a-z_][a-z0-9_]*) \(\n([\s\S]*?)^\)/gm)]
    .map(match => ({ name: match[1], columns: [...match[2].matchAll(/^    ([a-z_][a-z0-9_]*) /gm)].map(column => column[1]) }));
}

export async function inspectDatabase(client, definition) {
  const tables = declaredTables(definition.schema);
  if (!tables.length) throw new Error('database/schema.sql has no table definitions');
  const { rows } = await client.query(`select n.nspname || '.' || c.relname as name,
    array_agg(a.attname::text order by a.attnum) as columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where n.nspname in ('public','identity') and c.relkind in ('r','p')
    group by n.nspname,c.relname`);
  if (!rows.length) return { empty: true, missing: [] };
  const actual = new Map(rows.map(row => [row.name, new Set(row.columns)]));
  const missing = tables.flatMap(table => !actual.has(table.name) ? [table.name]
    : table.columns.filter(column => !actual.get(table.name).has(column)).map(column => `${table.name}.${column}`));
  return { empty: false, missing };
}
