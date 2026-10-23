// Recover only the indexes declared by this migration, never unrelated indexes.
export async function repairConcurrentIndexes(client, sql) {
  const names = [...sql.matchAll(/\bcreate\s+(?:unique\s+)?index\s+concurrently\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_$]*)\s+on\b/gi)]
    .map(match => match[1].toLowerCase());
  if (!names.length) return;
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as qualified_name
    from pg_index i join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
      and (not i.indisvalid or not i.indisready)`, [names]);
  for (const row of rows) {
    // format(%I) quotes identifiers on the server; this is not user input.
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${row.qualified_name}`);
  }
}
