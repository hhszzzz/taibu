// Brings an existing database to the maintained SQL definitions without a
// migration ledger. Each object is compared with its canonical live form and
// only differences are applied: unchanged policies and triggers are never
// re-created, so a routine deploy takes no table locks. DDL runs in short
// per-table transactions whose lock waits are bounded and retried, while the
// running release keeps serving. Objects the files no longer declare are
// dropped; tables and columns are never changed implicitly.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RELATION_SCHEMAS, ROUTINE_SCHEMAS, compareTables, describeIndexes, describePolicies, describeRoutines,
  describeRowSecurity, describeTables, describeTriggers, describeViews,
} from './catalog.mjs';
import { IDENTIFIER, normalizeStatement, quoteIdentifier } from './sql-text.mjs';

/** Schemas whose USAGE/CREATE privileges access.sql declares. */
const PRIVILEGE_SCHEMAS = ['public', 'auth', 'identity', 'extensions'];
const RETRYABLE = new Set(['55P03', '40P01']); // lock_not_available, deadlock_detected
const ATTEMPTS = 8;

function quoteQualified(name) {
  const dot = name.indexOf('.');
  return `${quoteIdentifier(name.slice(0, dot))}.${quoteIdentifier(name.slice(dot + 1))}`;
}

async function retrying(work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt === ATTEMPTS) throw error;
      await delay(Math.min(5_000, 250 * 2 ** attempt) * (0.5 + Math.random() / 2));
    }
  }
}

/**
 * A lock wait longer than a few seconds would queue application queries
 * behind it, so it is abandoned and retried instead. `work` may return
 * `{ commit: false }` to roll back a pass that changed nothing.
 */
function transaction(client, work) {
  return retrying(async () => {
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query('SET LOCAL search_path = public, extensions, pg_catalog');
      const outcome = await work();
      await client.query(outcome?.commit === false ? 'ROLLBACK' : 'COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

function byTable(items) {
  const tables = new Map();
  for (const item of items) {
    if (!tables.has(item.table)) tables.set(item.table, new Map());
    tables.get(item.table).set(item.name, item);
  }
  return tables;
}

/** Per table: what to drop (stale or changed) and what to create (new or changed). */
function differences(declared, live) {
  const want = byTable(declared);
  const have = byTable(live);
  const plan = [];
  for (const table of new Set([...want.keys(), ...have.keys()])) {
    const wanted = want.get(table) ?? new Map();
    const existing = have.get(table) ?? new Map();
    const drop = [...existing.values()].filter((item) => wanted.get(item.name)?.canonical !== item.canonical);
    const create = [...wanted.values()].filter((item) => existing.get(item.name)?.canonical !== item.canonical);
    if (drop.length || create.length) plan.push({ table, drop, create });
  }
  return plan;
}

const NOT_NULL = / NOT NULL$/u;

function nullability(definition) {
  return NOT_NULL.test(definition)
    ? { core: definition.slice(0, -' NOT NULL'.length), notNull: true }
    : { core: definition, notNull: false };
}

function optionMap(options) {
  return new Map(options.map((option) => {
    const equals = option.indexOf('=');
    return equals < 0 ? [option, ''] : [option.slice(0, equals), option.slice(equals + 1)];
  }));
}

/** NOT VALID applies to CHECK and FOREIGN KEY only; the rest are added at once. */
function validatable(definition) {
  return /^(?:CHECK|FOREIGN KEY) /u.test(definition);
}

/**
 * Differences db:init repairs on its own: missing tables, columns, constraints
 * and nullable/default-compatible column changes. Anything that could lose
 * data or reinterpret values (type changes, undeclared tables/columns,
 * identity removal) is reported for an explicit migration instead.
 */
export function planTableSync(declared, live) {
  const plan = { create: [], addColumns: [], alter: [], addConstraints: [], dropConstraints: [], options: [], errors: [] };
  const have = new Map(live.map((table) => [table.name, table]));
  for (const table of declared) {
    const found = have.get(table.name);
    have.delete(table.name);
    if (!found) {
      plan.create.push(table);
      // Columns come with CREATE TABLE; identity, compression and constraints follow.
      for (const column of table.columns) {
        if (column.identity) plan.alter.push(column.identity);
        if (column.compression) {
          plan.alter.push(`ALTER TABLE ${quoteQualified(table.name)} ALTER COLUMN ${quoteIdentifier(column.name)} SET COMPRESSION ${column.compression}`);
        }
      }
      for (const constraint of table.constraints) {
        plan.addConstraints.push({
          table: table.name,
          name: constraint.name,
          definition: constraint.definition,
          notValid: validatable(constraint.definition),
        });
      }
      continue;
    }
    const liveColumns = new Map(found.columns.map((column) => [column.name, column]));
    for (const column of table.columns) {
      const current = liveColumns.get(column.name);
      liveColumns.delete(column.name);
      if (!current) {
        plan.addColumns.push({ table: table.name, column });
        continue;
      }
      const want = nullability(column.definition);
      const actual = nullability(current.definition);
      if (normalizeStatement(want.core) !== normalizeStatement(actual.core)) {
        plan.errors.push(`${table.name}.${column.name}: definition is ${current.definition}, declared ${column.definition}`);
        continue;
      }
      if (want.notNull !== actual.notNull) {
        plan.alter.push(`ALTER TABLE ${quoteQualified(table.name)} ALTER COLUMN ${quoteIdentifier(column.name)} `
          + (want.notNull ? 'SET NOT NULL' : 'DROP NOT NULL'));
      }
      if ((column.compression ?? null) !== (current.compression ?? null)) {
        if (column.compression) {
          plan.alter.push(`ALTER TABLE ${quoteQualified(table.name)} ALTER COLUMN ${quoteIdentifier(column.name)} SET COMPRESSION ${column.compression}`);
        } else {
          plan.errors.push(`${table.name}.${column.name}: compression is ${current.compression}, not declared`);
        }
      }
      if ((column.identity ?? null) !== (current.identity ?? null)) {
        // Restoring an identity column is a plain ADD GENERATED; dropping one rewrites values.
        if (column.identity && !current.identity) plan.alter.push(column.identity);
        else plan.errors.push(`${table.name}.${column.name}: identity is declared differently`);
      }
    }
    for (const name of liveColumns.keys()) {
      plan.errors.push(`${table.name}.${name}: column is not declared`);
    }

    const constraints = new Map(found.constraints.map((constraint) => [constraint.name, constraint.definition]));
    for (const constraint of table.constraints) {
      const current = constraints.get(constraint.name);
      constraints.delete(constraint.name);
      if (current !== undefined && normalizeStatement(current) === constraint.definition) continue;
      if (current !== undefined) plan.dropConstraints.push(`ALTER TABLE ${quoteQualified(table.name)} DROP CONSTRAINT ${quoteIdentifier(constraint.name)}`);
      plan.addConstraints.push({
        table: table.name,
        name: constraint.name,
        definition: constraint.definition,
        notValid: validatable(constraint.definition),
      });
    }
    for (const name of constraints.keys()) {
      plan.dropConstraints.push(`ALTER TABLE ${quoteQualified(table.name)} DROP CONSTRAINT ${quoteIdentifier(name)}`);
    }

    const declaredOptions = optionMap(table.options);
    const liveOptions = optionMap(found.options);
    const set = [...declaredOptions].filter(([key, value]) => liveOptions.get(key) !== value);
    const reset = [...liveOptions.keys()].filter((key) => !declaredOptions.has(key));
    if (!set.length && !reset.length) continue;
    const target = `ALTER TABLE ${quoteQualified(table.name)}`;
    if (set.length) plan.options.push(`${target} SET (${set.map(([key, value]) => (value ? `${key}=${value}` : key)).join(', ')})`);
    if (reset.length) plan.options.push(`${target} RESET (${reset.join(', ')})`);
  }
  for (const name of have.keys()) plan.errors.push(`${name}: table is not declared`);
  // A foreign key needs the referenced key, which may be added in this same pass.
  plan.addConstraints.sort((a, b) => foreignKey(a) - foreignKey(b));
  return plan;
}

function foreignKey(constraint) {
  return Number(constraint.definition.startsWith('FOREIGN KEY '));
}

function createTableStatement(table) {
  const columns = table.columns.map((column) => `    ${quoteIdentifier(column.name)} ${column.definition}`);
  const options = table.options.length ? `\nWITH (${table.options.join(', ')})` : '';
  return `CREATE TABLE ${quoteQualified(table.name)} (\n${columns.join(',\n')}\n)${options};`;
}

async function hasRows(client, table) {
  const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quoteQualified(table)}) AS present`);
  return rows[0].present;
}

/**
 * Applies the repairable part of schema.sql to an existing database: creates
 * missing tables (constraints after every table exists), adds missing columns
 * and constraints, and follows declared nullability. Returns `empty` when the
 * database has no tables yet, in which case the caller creates schema.sql whole.
 */
export async function syncTables(client, definitions, { log = console.log, checkOnly = false } = {}) {
  const live = await describeTables(client);
  if (!live.length) return { empty: true, changes: 0 };

  const plan = planTableSync(definitions.tables, live);
  if (plan.errors.length) {
    throw new Error(`Existing tables differ from database/schema.sql; write a migration (after a backup) before db:init:\n- ${plan.errors.join('\n- ')}`);
  }

  if (checkOnly) {
    const planned = plan.create.length + plan.addColumns.length + plan.alter.length
      + plan.options.length + plan.addConstraints.length + plan.dropConstraints.length;
    for (const table of plan.create) log(`would create table ${table.name}`);
    for (const { table, column } of plan.addColumns) log(`would add column ${table}.${column.name}`);
    for (const statement of [...plan.alter, ...plan.options, ...plan.dropConstraints]) log(`would apply ${statement.slice(0, 100)}`);
    for (const constraint of plan.addConstraints) log(`would add constraint ${constraint.table}.${constraint.name}`);
    return { empty: false, changes: 0, planned };
  }

  for (const table of plan.create) {
    await transaction(client, () => client.query(createTableStatement(table)));
    log(`created table ${table.name}`);
  }

  const columns = [];
  for (const { table, column } of plan.addColumns) {
    const { notNull } = nullability(column.definition);
    if (notNull && !/ DEFAULT /u.test(column.definition) && await hasRows(client, table)) {
      throw new Error(`${table}.${column.name}: adding a NOT NULL column without a default needs a migration (table already has rows)`);
    }
    columns.push(`ALTER TABLE ${quoteQualified(table)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.definition}`);
  }
  if (columns.length || plan.alter.length || plan.options.length) {
    await transaction(client, async () => {
      for (const statement of [...columns, ...plan.alter, ...plan.options]) {
        await client.query(statement);
        log(`applied ${statement.slice(0, 100)}`);
      }
    });
  }

  const constraints = [...plan.dropConstraints];
  const validations = [];
  for (const constraint of plan.addConstraints) {
    const target = `ALTER TABLE ${quoteQualified(constraint.table)} ADD CONSTRAINT ${quoteIdentifier(constraint.name)} ${constraint.definition}`;
    constraints.push(constraint.notValid ? `${target} NOT VALID` : target);
    if (constraint.notValid) {
      validations.push(`ALTER TABLE ${quoteQualified(constraint.table)} VALIDATE CONSTRAINT ${quoteIdentifier(constraint.name)}`);
    }
  }
  if (constraints.length) {
    await transaction(client, async () => {
      for (const statement of constraints) {
        await client.query(statement);
        log(`applied ${statement.slice(0, 100)}`);
      }
    });
  }
  if (validations.length) {
    await transaction(client, async () => {
      for (const statement of validations) await client.query(statement);
    });
  }

  const changes = plan.create.length + plan.addColumns.length + plan.alter.length
    + plan.options.length + plan.addConstraints.length + plan.dropConstraints.length;
  return { empty: false, changes };
}

export async function createTables(client, definitions) {
  await transaction(client, () => client.query(definitions.sql.schema));
}

async function routineDefinitions(client) {
  const { rows } = await client.query(`
    select p.oid::int8::text as oid, pg_get_functiondef(p.oid) as definition,
      p.xmin = pg_current_xact_id()::xid as touched
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any($1::text[]) and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')`,
  [ROUTINE_SCHEMAS]);
  return rows;
}

/**
 * CREATE OR REPLACE takes no table locks, so every declared function is
 * replaced inside one transaction; the rows it rewrote (xmin = this
 * transaction) are the declared set and everything else is stale. A pass that
 * changed no definition is rolled back to avoid needless catalog churn.
 */
async function replaceRoutines(client, definitions) {
  return transaction(client, async () => {
    await client.query('SET LOCAL check_function_bodies = false');
    const before = new Map((await routineDefinitions(client)).map((row) => [row.oid, row.definition]));
    for (const statement of definitions.functions) await client.query(statement.text);
    const after = await routineDefinitions(client);
    const touched = after.filter((row) => row.touched);
    if (touched.length !== definitions.functions.length) {
      throw new Error(`database/functions.sql has ${definitions.functions.length} function statements but defines ${touched.length} functions in ${ROUTINE_SCHEMAS.join('/')}: a function is declared twice or outside those schemas`);
    }
    const created = touched.filter((row) => !before.has(row.oid)).length;
    const changed = touched.filter((row) => before.has(row.oid) && before.get(row.oid) !== row.definition).length;
    const stale = after.filter((row) => !row.touched).map((row) => row.oid);
    return { commit: Boolean(created || changed), created, changed, stale };
  });
}

async function replaceViews(client, definitions) {
  const live = new Map((await describeViews(client)).map((view) => [view.name, view.canonical]));
  let replaced = 0;
  for (const view of definitions.views) {
    if (live.get(view.name) === view.canonical) continue;
    await transaction(client, () => client.query(view.text));
    replaced += 1;
  }
  const declared = new Set(definitions.views.map((view) => view.name));
  return { replaced, stale: [...live.keys()].filter((name) => !declared.has(name)) };
}

async function privilegeSnapshot(client) {
  const { rows } = await client.query(`
    with entries as (
      select format('%s %I.%I %s', c.relkind, n.nspname, c.relname,
        array(select x::text from unnest(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) x order by 1)) as entry
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      union all
      select format('column %I.%I.%I %s', n.nspname, c.relname, a.attname, array(select x::text from unnest(a.attacl) x order by 1))
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and a.attacl is not null
      union all
      select format('routine %s %s', p.oid::regprocedure,
        array(select x::text from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x order by 1))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($2::text[]) and p.prokind in ('f', 'p')
      union all
      select format('schema %I %s', n.nspname, array(select x::text from unnest(coalesce(n.nspacl, acldefault('n', n.nspowner))) x order by 1))
      from pg_namespace n where n.nspname = any($3::text[])
    )
    select coalesce(string_agg(entry, E'\\n' order by entry), '') as snapshot from entries`,
  [RELATION_SCHEMAS, ROUTINE_SCHEMAS, PRIVILEGE_SCHEMAS]);
  return rows[0].snapshot;
}

// Everything granted to anyone but the owner, as REVOKE statements.
async function revocations(client) {
  const { rows } = await client.query(`
    with relations as (
      select c.oid, c.relkind, c.relowner, c.relacl, n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and not exists (select 1 from pg_depend e where e.classid = 'pg_class'::regclass and e.objid = c.oid and e.deptype = 'e')
    ), grants as (
      select format('ON %s %I.%I', case r.relkind when 'S' then 'SEQUENCE' else 'TABLE' end, r.nspname, r.relname) as target,
        r.relowner as owner, g.grantee
      from relations r cross join lateral (
        -- Column privileges count too; revoking the table privilege removes them.
        select (aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner)))).grantee
        union all
        select (aclexplode(a.attacl)).grantee from pg_attribute a where a.attrelid = r.oid and a.attacl is not null
      ) g(grantee)
      union all
      select format('ON %s %s', case p.prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end, p.oid::regprocedure),
        p.proowner, (aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))).grantee
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($2::text[]) and p.prokind in ('f', 'p')
        and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
      union all
      select format('ON SCHEMA %I', n.nspname), n.nspowner, (aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner)))).grantee
      from pg_namespace n where n.nspname = any($3::text[])
    )
    select distinct format('REVOKE ALL %s FROM %s CASCADE', g.target,
      case when g.grantee = 0 then 'PUBLIC' else quote_ident(r.rolname) end) as statement
    from grants g left join pg_roles r on r.oid = g.grantee
    where g.grantee <> g.owner
    order by 1`, [RELATION_SCHEMAS, ROUTINE_SCHEMAS, PRIVILEGE_SCHEMAS]);
  return rows.map((row) => row.statement);
}

/**
 * Privileges change in two lock-free passes around the policy and trigger
 * work: declared grants are added first, so new definitions are usable as
 * soon as they appear; undeclared privileges are revoked last, after nothing
 * the running release still uses depends on them.
 */
async function grantPrivileges(client, definitions, { exact }) {
  return transaction(client, async () => {
    const before = await privilegeSnapshot(client);
    if (exact) for (const statement of await revocations(client)) await client.query(statement);
    for (const grant of definitions.grants) await client.query(grant.text);
    const changed = before !== await privilegeSnapshot(client);
    return { commit: changed, changed };
  });
}

async function reconcileTriggers(client, definitions) {
  const plan = differences(definitions.triggers, await describeTriggers(client));
  for (const { table, drop, create } of plan) {
    await transaction(client, async () => {
      for (const trigger of drop) await client.query(`DROP TRIGGER ${quoteIdentifier(trigger.name)} ON ${quoteQualified(table)}`);
      for (const trigger of create) await client.query(trigger.text);
    });
  }
  return plan.length;
}

async function reconcilePolicies(client, definitions, log) {
  const enabled = await describeRowSecurity(client);
  const plan = differences(definitions.policies, await describePolicies(client));
  const declared = new Set(definitions.rowSecurity);
  for (const table of enabled) {
    // Turning row level security off is never implicit; it needs explicit SQL.
    if (!declared.has(table)) log(`row level security stays enabled on ${table}, which access.sql does not declare`);
  }
  const pending = new Map(plan.map((entry) => [entry.table, entry]));
  for (const table of declared) {
    if (!enabled.has(table) && !pending.has(table)) pending.set(table, { table, drop: [], create: [] });
  }
  for (const { table, drop, create } of pending.values()) {
    await transaction(client, async () => {
      if (declared.has(table) && !enabled.has(table)) {
        await client.query(`ALTER TABLE ${quoteQualified(table)} ENABLE ROW LEVEL SECURITY`);
      }
      for (const policy of drop) await client.query(`DROP POLICY ${quoteIdentifier(policy.name)} ON ${quoteQualified(table)}`);
      for (const policy of create) await client.query(policy.text);
    });
  }
  return pending.size;
}

async function dropStale(client, { views, routines }) {
  if (!views.length && !routines.length) return;
  await transaction(client, async () => {
    for (const view of views) await client.query(`DROP VIEW ${quoteQualified(view)}`);
    const { rows } = await client.query(`
      select format('DROP %s %s', case prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end, oid::regprocedure) as statement
      from pg_proc where oid = any($1::oid[])`, [routines]);
    for (const row of rows) await client.query(row.statement);
  });
}

async function seed(client, definitions) {
  await transaction(client, () => client.query(definitions.sql.seed));
}

function swapName(name) {
  return `taibu_swap_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
}

function buildIndex(index, name) {
  const statement = index.canonical.replace(new RegExp(`^CREATE (UNIQUE )?INDEX ${IDENTIFIER} ON `, 'u'),
    (_, unique = '') => `CREATE ${unique}INDEX CONCURRENTLY ${quoteIdentifier(name)} ON `);
  return statement;
}

/**
 * Index builds run CONCURRENTLY outside transactions. A changed definition is
 * built beside the old index and swapped in, so no query (or ON CONFLICT
 * target) ever runs without one; a failed build leaves an invalid index that
 * the next pass removes and rebuilds.
 */
async function reconcileIndexes(client, definitions) {
  const live = new Map((await describeIndexes(client)).map((index) => [index.name, index]));
  const result = { created: 0, rebuilt: 0, dropped: 0 };
  const drop = (name) => client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${quoteQualified(name)}`);
  for (const index of definitions.indexes) {
    const current = live.get(index.name);
    live.delete(index.name);
    if (current?.valid && current.canonical === index.canonical) continue;
    const schema = index.name.slice(0, index.name.indexOf('.'));
    const indexName = index.name.slice(schema.length + 1);
    if (current?.valid) {
      const temporary = swapName(index.name);
      await retrying(async () => {
        await drop(`${schema}.${temporary}`);
        await client.query(buildIndex(index, temporary));
      });
      await retrying(() => drop(index.name));
      await retrying(() => client.query(`ALTER INDEX ${quoteQualified(`${schema}.${temporary}`)} RENAME TO ${quoteIdentifier(indexName)}`));
      result.rebuilt += 1;
    } else {
      await retrying(async () => {
        await drop(index.name);
        await client.query(buildIndex(index, indexName));
      });
      result.created += 1;
    }
  }
  for (const stale of live.keys()) {
    await retrying(() => drop(stale));
    result.dropped += 1;
  }
  return result;
}

function summary(result) {
  const parts = [];
  const { routines, views, triggers, policies, privileges, indexes } = result;
  if (routines.created || routines.changed || routines.dropped) {
    parts.push(`functions ${routines.created} created, ${routines.changed} changed, ${routines.dropped} dropped`);
  }
  if (views.replaced || views.dropped) parts.push(`views ${views.replaced} replaced, ${views.dropped} dropped`);
  if (triggers) parts.push(`triggers on ${triggers} table(s)`);
  if (policies) parts.push(`policies on ${policies} table(s)`);
  if (privileges) parts.push('privileges updated');
  if (indexes.created || indexes.rebuilt || indexes.dropped) {
    parts.push(`indexes ${indexes.created} created, ${indexes.rebuilt} rebuilt, ${indexes.dropped} dropped`);
  }
  return parts.length ? parts.join('; ') : 'no definition changes';
}

/** Applies every step in dependency order; returns a one-line summary. */
export async function reconcileDatabase(client, definitions, { log = console.log, checkOnly = false } = {}) {
  const state = await syncTables(client, definitions, { log, checkOnly });
  if (checkOnly) {
    if (state.empty) log(`would create ${definitions.tables.length} table(s) from database/schema.sql`);
    return { empty: state.empty, summary: `check-only: ${state.empty ? `${definitions.tables.length} tables` : `${state.planned} table change(s)`} planned` };
  }
  if (state.empty) {
    await createTables(client, definitions);
    const drift = compareTables(definitions.tables, await describeTables(client));
    if (drift.length) throw new Error(`database/schema.sql is not in canonical form:\n- ${drift.join('\n- ')}`);
  } else {
    // syncTables repairs everything it safely can; whatever is left needs explicit SQL.
    const drift = compareTables(definitions.tables, await describeTables(client));
    if (drift.length) throw new Error(`db:init could not converge the schema; write a migration:\n- ${drift.join('\n- ')}`);
    if (state.changes) log(`repaired ${state.changes} table difference(s)`);
  }
  const routines = await replaceRoutines(client, definitions);
  const views = await replaceViews(client, definitions);
  const granted = await grantPrivileges(client, definitions, { exact: false });
  const triggers = await reconcileTriggers(client, definitions);
  const policies = await reconcilePolicies(client, definitions, log);
  // Indexes go before the stale-object drop: an expression index may still
  // reference a function that is about to be dropped.
  const indexes = await reconcileIndexes(client, definitions);
  if (routines.stale.length) {
    const names = (await describeRoutines(client)).filter((routine) => routines.stale.includes(routine.oid));
    log(`dropping functions no longer declared: ${names.map((routine) => routine.signature).join(', ')}`);
  }
  if (views.stale.length) log(`dropping views no longer declared: ${views.stale.join(', ')}`);
  await dropStale(client, { views: views.stale, routines: routines.stale });
  const revoked = await grantPrivileges(client, definitions, { exact: true });
  await seed(client, definitions);
  return {
    empty: state.empty,
    summary: summary({
      routines: { created: routines.created, changed: routines.changed, dropped: routines.stale.length },
      views: { replaced: views.replaced, dropped: views.stale.length },
      triggers, policies, privileges: granted.changed || revoked.changed, indexes,
    }),
  };
}
