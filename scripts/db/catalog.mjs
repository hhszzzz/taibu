// Live definitions read from pg_catalog in the canonical text pg_dump prints,
// so they compare directly with the maintained SQL (see current-sql.mjs).
// Callers run `SET search_path = ''` first: deparsed names are then always
// schema-qualified, exactly as in the files.
import { normalizeStatement } from './sql-text.mjs';

/** Tables, views, policies, triggers and indexes live here. */
export const RELATION_SCHEMAS = ['public', 'identity'];
/** Functions also live in auth (auth.uid()). */
export const ROUTINE_SCHEMAS = ['public', 'auth', 'identity'];

const NOT_EXTENSION_MEMBER = (catalog, alias) => `not exists (select 1 from pg_depend e
  where e.classid = '${catalog}'::regclass and e.objid = ${alias}.oid and e.deptype = 'e')`;

export async function describeTables(client) {
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as name,
      coalesce((select json_agg(json_build_object(
          'name', a.attname,
          'definition', format_type(a.atttypid, a.atttypmod)
            || case when a.attgenerated = 's' then ' GENERATED ALWAYS AS (' || pg_get_expr(d.adbin, d.adrelid) || ') STORED'
                    when d.adbin is not null then ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid) else '' end
            || case when a.attnotnull then ' NOT NULL' else '' end
            || case when a.attcollation <> t.typcollation then (select format(' COLLATE %I.%I', cn.nspname, co.collname)
                 from pg_collation co join pg_namespace cn on cn.oid = co.collnamespace where co.oid = a.attcollation) else '' end,
          'compression', case a.attcompression when 'l' then 'lz4' when 'p' then 'pglz' end,
          'identity', (select format('ALTER TABLE %I.%I ALTER COLUMN %I ADD GENERATED %s AS IDENTITY ( SEQUENCE NAME %I.%I%s START WITH %s INCREMENT BY %s %s %s CACHE %s%s )',
              n.nspname, c.relname, a.attname, case a.attidentity when 'a' then 'ALWAYS' else 'BY DEFAULT' end,
              sn.nspname, sc.relname,
              case when s.seqtypid <> 'bigint'::regtype then ' AS ' || format_type(s.seqtypid, null) else '' end,
              s.seqstart, s.seqincrement,
              case when s.seqmin = case when s.seqincrement > 0 then 1
                  when s.seqtypid = 'smallint'::regtype then -32768 when s.seqtypid = 'integer'::regtype then -2147483648
                  else -9223372036854775808 end then 'NO MINVALUE' else 'MINVALUE ' || s.seqmin end,
              case when s.seqmax = case when s.seqincrement < 0 then -1
                  when s.seqtypid = 'smallint'::regtype then 32767 when s.seqtypid = 'integer'::regtype then 2147483647
                  else 9223372036854775807 end then 'NO MAXVALUE' else 'MAXVALUE ' || s.seqmax end,
              s.seqcache, case when s.seqcycle then ' CYCLE' else '' end)
            from pg_depend dep
            join pg_class sc on sc.oid = dep.objid and sc.relkind = 'S'
            join pg_namespace sn on sn.oid = sc.relnamespace
            join pg_sequence s on s.seqrelid = sc.oid
            where a.attidentity <> '' and dep.classid = 'pg_class'::regclass and dep.refobjid = c.oid
              and dep.refobjsubid = a.attnum and dep.deptype = 'i'))
          order by a.attnum)
        from pg_attribute a join pg_type t on t.oid = a.atttypid
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]') as columns,
      coalesce((select json_agg(json_build_object('name', k.conname, 'definition', pg_get_constraintdef(k.oid)) order by k.conname)
        from pg_constraint k where k.conrelid = c.oid and k.contype in ('c', 'p', 'u', 'f', 'x')), '[]') as constraints,
      coalesce(c.reloptions, '{}') as options
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p') and ${NOT_EXTENSION_MEMBER('pg_class', 'c')}
    order by 1`, [RELATION_SCHEMAS]);
  return rows.map((row) => ({ ...row, options: [...row.options].sort() }));
}

/** Every difference between declared and live tables, as readable lines. */
export function compareTables(declared, live) {
  const drift = [];
  const actual = new Map(live.map((table) => [table.name, table]));
  for (const table of declared) {
    const found = actual.get(table.name);
    actual.delete(table.name);
    if (!found) {
      drift.push(`${table.name}: table is missing`);
      continue;
    }
    const columns = new Map(found.columns.map((column) => [column.name, column]));
    for (const column of table.columns) {
      const current = columns.get(column.name);
      columns.delete(column.name);
      const label = `${table.name}.${column.name}`;
      if (!current) {
        drift.push(`${label}: column is missing`);
        continue;
      }
      for (const field of ['definition', 'compression', 'identity']) {
        const want = column[field] && normalizeStatement(column[field]);
        const have = current[field] && normalizeStatement(current[field]);
        if ((want ?? null) !== (have ?? null)) drift.push(`${label}: ${field} is ${have ?? 'unset'}, declared ${want ?? 'unset'}`);
      }
    }
    for (const name of columns.keys()) drift.push(`${table.name}.${name}: column is not declared`);
    const constraints = new Map(found.constraints.map((constraint) => [constraint.name, constraint.definition]));
    for (const constraint of table.constraints) {
      const current = constraints.get(constraint.name);
      constraints.delete(constraint.name);
      if (current === undefined) drift.push(`${table.name}: constraint ${constraint.name} is missing`);
      else if (normalizeStatement(current) !== constraint.definition) {
        drift.push(`${table.name}: constraint ${constraint.name} is ${current}, declared ${constraint.definition}`);
      }
    }
    for (const name of constraints.keys()) drift.push(`${table.name}: constraint ${name} is not declared`);
    if (table.options.join(',') !== found.options.join(',')) {
      drift.push(`${table.name}: storage options are (${found.options.join(', ')}), declared (${table.options.join(', ')})`);
    }
  }
  for (const name of actual.keys()) drift.push(`${name}: table is not declared`);
  return drift;
}

export async function describePolicies(client) {
  // pg_dump's CREATE POLICY layout; roles sorted so the order is stable.
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as table, p.polname as name,
      format('CREATE POLICY %I ON %I.%I', p.polname, n.nspname, c.relname)
        || case when p.polpermissive then '' else ' AS RESTRICTIVE' end
        || case p.polcmd when 'r' then ' FOR SELECT' when 'a' then ' FOR INSERT' when 'w' then ' FOR UPDATE'
             when 'd' then ' FOR DELETE' else '' end
        || case when p.polroles = '{0}'::oid[] then '' else ' TO ' || (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname)
             from pg_roles r where r.oid = any(p.polroles)) end
        || coalesce(' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')', '')
        || coalesce(' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '') as definition
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[])
    order by 1, 2`, [RELATION_SCHEMAS]);
  return rows.map((row) => ({ table: row.table, name: row.name, canonical: normalizeStatement(row.definition) }));
}

export async function describeTriggers(client) {
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as table, t.tgname as name,
      pg_get_triggerdef(t.oid) as definition, t.tgenabled <> 'O' as disabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and not t.tgisinternal and ${NOT_EXTENSION_MEMBER('pg_trigger', 't')}
    order by 1, 2`, [RELATION_SCHEMAS]);
  // A disabled trigger never equals its declaration, so db:init recreates it.
  return rows.map((row) => ({
    table: row.table, name: row.name,
    canonical: `${normalizeStatement(row.definition)}${row.disabled ? ' (disabled)' : ''}`,
  }));
}

/** Tables that currently enforce row level security. */
export async function describeRowSecurity(client) {
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as table
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p') and c.relrowsecurity`, [RELATION_SCHEMAS]);
  return new Set(rows.map((row) => row.table));
}

export async function describeViews(client) {
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, c.relname) as name,
      format('CREATE OR REPLACE VIEW %I.%I', n.nspname, c.relname)
        || coalesce(' WITH (' || (select string_agg(format('%s=%L', split_part(o, '=', 1), substr(o, strpos(o, '=') + 1)), ', ')
             from unnest(c.reloptions) o) || ')', '')
        || ' AS ' || rtrim(pg_get_viewdef(c.oid), ';') as definition
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind = 'v' and ${NOT_EXTENSION_MEMBER('pg_class', 'c')}
    order by 1`, [RELATION_SCHEMAS]);
  return rows.map((row) => ({ name: row.name, canonical: normalizeStatement(row.definition) }));
}

/** Functions and procedures the maintained SQL owns (extension members excluded). */
export async function describeRoutines(client) {
  const { rows } = await client.query(`
    select p.oid::int8::text as oid, p.oid::regprocedure::text as signature,
      format('%I.%I', n.nspname, p.proname) as name, p.prokind = 'p' as procedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any($1::text[]) and p.prokind in ('f', 'p') and ${NOT_EXTENSION_MEMBER('pg_proc', 'p')}
    order by 3, 2`, [ROUTINE_SCHEMAS]);
  return rows;
}

/** Indexes the SQL declares explicitly; indexes that implement constraints belong to schema.sql. */
export async function describeIndexes(client) {
  const { rows } = await client.query(`
    select format('%I.%I', n.nspname, ic.relname) as name, format('%I.%I', n.nspname, c.relname) as table,
      pg_get_indexdef(i.indexrelid) as definition, i.indisvalid and i.indisready as valid
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
      and ${NOT_EXTENSION_MEMBER('pg_class', 'ic')}
    order by 1`, [RELATION_SCHEMAS]);
  return rows.map((row) => ({ name: row.name, table: row.table, valid: row.valid, canonical: normalizeStatement(row.definition) }));
}
