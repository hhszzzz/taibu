#!/usr/bin/env node
// One-shot import from a Supabase-compatible source (production dump restored
// into transit) into the migrated Better Auth database.
//
// Secrets never belong on the command line:
//   IMPORT_SOURCE_URL=... IMPORT_TARGET_URL=... node scripts/db/import-supabase.mjs
// Optional: IMPORT_FILES_ROOT, LEGACY_HMAC_KEY_ENV, LINUXDO_CLIENT_SECRET.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const sourceUrl = value('--source', process.env.IMPORT_SOURCE_URL);
const targetUrl = value('--target', process.env.IMPORT_TARGET_URL);
const filesRoot = value('--files-root', process.env.IMPORT_FILES_ROOT);
const reportPath = value('--report', path.join(process.cwd(), 'tmp', `import-${Date.now()}.json`));
const dryRun = has('--dry-run');
const allowExtraSource = has('--allow-extra-source');
const allowMissingSource = has('--allow-missing-source');
const cutover = has('--cutover');
const resetTarget = has('--reset-target');

if (!sourceUrl || !targetUrl) {
  console.error('[import] IMPORT_SOURCE_URL and IMPORT_TARGET_URL are required (or --source/--target)');
  process.exit(1);
}
if (sourceUrl === targetUrl) throw new Error('source and target must be different databases');

const SYSTEM_USER = '00000000-0000-4000-8000-000000000001';
const SKIP_TABLES = new Set(['rate_limits', 'login_attempts']);
const report = {
  startedAt: new Date().toISOString(),
  dryRun,
  source: redact(sourceUrl),
  target: redact(targetUrl),
  identity: {},
  tables: [],
  password: { credentials: 0, deterministicRemoved: 0, linuxdoOnly: 0 },
  files: { downloaded: 0, failed: [] },
  warnings: [],
};

function redact(dsn) {
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.username}@${url.host}${url.pathname}`;
  } catch {
    return 'invalid-dsn';
  }
}

function quote(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(dsn, script, { timeout = 600_000 } = {}) {
  const url = new URL(dsn);
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', dsn, '-f', '-'], {
      env: {
        ...process.env,
        PGHOST: decodeURIComponent(url.hostname),
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGOPTIONS: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`psql failed (${code}): ${stderr.trim().split('\n').slice(-4).join(' ')}`));
    });
    if (process.env.IMPORT_DEBUG_SCRIPT) void writeFile(process.env.IMPORT_DEBUG_SCRIPT, script, { mode: 0o600 });
    child.stdin.end(script);
  });
}

async function tableNames(client, schema = 'public') {
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname = $1 order by tablename`,
    [schema],
  );
  return rows.map((row) => row.tablename);
}

async function columns(client, table, schema = 'public') {
  const { rows } = await client.query(
    `select column_name, udt_name, is_nullable, column_default, is_identity, is_generated
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [schema, table],
  );
  return rows;
}

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0] ? Object.values(rows[0])[0] : null;
}

function topoSort(tables, edges) {
  const state = new Map(tables.map((table) => [table, 0]));
  const output = [];
  const visit = (table) => {
    if (state.get(table) === 1) return; // cycle: replica mode disables FK checks
    if (state.get(table) === 2) return;
    state.set(table, 1);
    for (const parent of edges.get(table) ?? []) if (state.has(parent)) visit(parent);
    state.set(table, 2);
    output.push(table);
  };
  for (const table of tables) visit(table);
  return output;
}

async function fkEdges(client, tables) {
  const { rows } = await client.query(`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public';`);
  const known = new Set(tables);
  const edges = new Map();
  for (const row of rows) {
    const child = row.child.replace(/^public\./u, '');
    const parent = row.parent.replace(/^public\./u, '');
    if (!known.has(child) || !known.has(parent)) continue;
    const set = edges.get(child) ?? new Set();
    set.add(parent);
    edges.set(child, set);
  }
  return edges;
}

function avatarExpression(column) {
  // Supabase public object URLs become local keys. The download step mirrors
  // the same key, so the database never keeps a dead external URL.
  return `case when ${column} like '%/storage/v1/object/public/avatars/%' then '/api/files/avatars/' || split_part(${column}, '/storage/v1/object/public/avatars/', 2) else ${column} end`;
}

function selectExpression(table, column) {
  const quoted = `"${column.column_name}"`;
  if (table === 'users' && column.column_name === 'avatar_url') return avatarExpression(quoted);
  return quoted;
}

async function main() {
  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  try {
    const sourceTables = (await tableNames(source)).filter((table) => !SKIP_TABLES.has(table));
    // public.users rows without an auth.users row cannot satisfy the new FK.
    const orphans = await source.query(`
      select count(*)::int as count from public.users pu
      left join auth.users au on au.id = pu.id
      where au.id is null and pu.id <> $1`, [SYSTEM_USER]);
    if (Number(orphans.rows[0]?.count ?? 0) > 0) {
      throw new Error(`source public.users has ${orphans.rows[0].count} rows without auth.users; review before importing`);
    }
    const targetTables = (await tableNames(target)).filter((table) => !SKIP_TABLES.has(table));
    const targetSet = new Set(targetTables);
    const sourceSet = new Set(sourceTables);
    const extraSource = sourceTables.filter((table) => !targetSet.has(table));
    if (extraSource.length && !allowExtraSource) {
      throw new Error(`source tables missing from target: ${extraSource.join(', ')} (use --allow-extra-source after review)`);
    }
    const missingSource = targetTables.filter((table) => !sourceSet.has(table));
    if (missingSource.length && !allowMissingSource) {
      report.warnings.push(`tables kept empty because the source has none: ${missingSource.join(', ')}`);
    }

    if (resetTarget) {
      if (process.env.TAIBU_ENV === 'production' && !cutover) {
        throw new Error('--reset-target is refused in production without --cutover');
      }
      await target.query('begin');
      try {
        await target.query('set local session_replication_role = replica');
        const tables = (await tableNames(target)).filter((table) => !SKIP_TABLES.has(table));
        await target.query(`truncate ${tables.map((table) => `public."${table}"`).join(', ')} cascade`);
        await target.query(`insert into public.users (id, nickname, is_admin) values ($1, '系统', true)`, [SYSTEM_USER]);
        await target.query('delete from identity.sessions');
        await target.query('delete from identity.verifications');
        await target.query('delete from identity.accounts');
        await target.query('delete from identity.users where id <> $1', [SYSTEM_USER]);
        await target.query('commit');
      } catch (error) {
        await target.query('rollback').catch(() => {});
        throw error;
      }
      report.warnings.push('target reset before import');
    }

    // Preflight: the target must be freshly migrated.
    const existing = Number(await scalar(target, `select count(*) from public.users where id <> $1`, [SYSTEM_USER]))
      + Number(await scalar(target, `select count(*) from identity.users where id <> $1`, [SYSTEM_USER]));
    if (existing > 0 && !cutover) throw new Error(`target already contains ${existing} non-system users; refusing to import`);

    const authColumns = await columns(source, 'users', 'auth').catch(() => []);
    const authColumnNames = new Set(authColumns.map((column) => column.column_name));
    const identityUsers = await source.query(`
      select au.id, lower(au.email) as email,
             (au.email_confirmed_at is not null) as email_verified,
             ${authColumnNames.has('created_at') ? 'au.created_at' : 'now()'} as created_at,
             ${authColumnNames.has('updated_at') ? 'au.updated_at' : 'now()'} as updated_at,
             ${authColumnNames.has('encrypted_password') ? 'au.encrypted_password' : 'null::text'} as encrypted_password,
             ${authColumnNames.has('raw_user_meta_data') ? 'au.raw_user_meta_data' : "'{}'::jsonb"} as metadata,
             pu.nickname, pu.avatar_url
      from auth.users au
      left join public.users pu on pu.id = au.id
      where au.email is not null
      order by au.id`);
    if (!identityUsers.rowCount) throw new Error('source auth.users is empty');

    const seenEmails = new Set();
    for (const row of identityUsers.rows) {
      if (!row.email) throw new Error(`user ${row.id} has no email`);
      if (seenEmails.has(row.email)) throw new Error(`duplicate email after lower(): ${row.email}`);
      seenEmails.add(row.email);
    }

    // Linux.do accounts: provider table first, then legacy metadata.
    const providerRows = sourceSet.has('user_oauth_providers')
      ? (await source.query(`select user_id, provider_user_id from public.user_oauth_providers where provider = 'linuxdo'`)).rows
      : [];
    const linuxdoByUser = new Map(providerRows.map((row) => [row.user_id, row.provider_user_id]));
    for (const row of identityUsers.rows) {
      const sub = row.metadata?.linuxdo_sub;
      if (!linuxdoByUser.has(row.id) && typeof sub === 'string' && sub) linuxdoByUser.set(row.id, sub);
    }

    // Historical derivation: HMAC(key = SUPABASE_SECRET_KEY || LINUXDO_CLIENT_SECRET,
    // message = "linuxdo:<sub>"). The Supabase key wins when present.
    const seedName = value('--legacy-hmac-seed-env', 'SUPABASE_SECRET_KEY');
    const clientSecret = process.env.LINUXDO_CLIENT_SECRET;
    const seed = process.env[seedName] || clientSecret;
    const canDetectDeterministic = Boolean(seed);
    if (!canDetectDeterministic && linuxdoByUser.size > 0) {
      // Without the old seed, a deterministic Linux.do password cannot be told
      // apart from a user-chosen one. Importing it would preserve a
      // secret-derived credential, so fail unless the operator opts in.
      const message = 'legacy HMAC seed is unavailable; Linux.do passwords cannot be classified (pass --allow-missing-seed to override)';
      if (!has('--allow-missing-seed')) throw new Error(message);
      report.warnings.push(message);
    }

    const identitySql = [];
    for (const row of identityUsers.rows) {
      const name = (row.nickname || row.metadata?.nickname || '').trim();
      const image = row.avatar_url || null;
      identitySql.push(`insert into identity.users (id, email, email_verified, name, image, created_at, updated_at)
        values (${quote(row.id)}, ${quote(row.email)}, ${row.email_verified}, ${quote(name)}, ${quote(image)}, ${quote(row.created_at)}, ${quote(row.updated_at)});`);

      const hash = row.encrypted_password;
      if (hash && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u.test(hash)) {
        let deterministic = false;
        const sub = linuxdoByUser.get(row.id);
        if (canDetectDeterministic && sub) {
          const derived = createHmac('sha256', seed).update(`linuxdo:${sub}`).digest('hex');
          deterministic = await bcrypt.compare(derived, hash);
        }
        if (deterministic) {
          report.password.deterministicRemoved += 1;
        } else {
          identitySql.push(`insert into identity.accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
            values (gen_random_uuid(), ${quote(row.id)}, ${quote(row.id)}, 'credential', ${quote(hash)}, now(), now());`);
          report.password.credentials += 1;
        }
      } else if (!linuxdoByUser.has(row.id)) {
        report.password.linuxdoOnly += 1;
      }
    }
    for (const [userId, sub] of linuxdoByUser) {
      identitySql.push(`insert into identity.accounts (id, user_id, account_id, provider_id, created_at, updated_at)
        values (gen_random_uuid(), ${quote(userId)}, ${quote(sub)}, 'linuxdo', now(), now());`);
    }
    report.identity = {
      users: identityUsers.rowCount,
      linuxdo: linuxdoByUser.size,
      verified: identityUsers.rows.filter((row) => row.email_verified).length,
    };

    // Column plans for every shared table.
    const edges = await fkEdges(target, targetTables);
    const ordered = topoSort(targetTables.filter((table) => sourceSet.has(table)), edges);
    const plans = [];
    for (const table of ordered) {
      const targetColumns = await columns(target, table);
      const sourceColumns = new Set((await columns(source, table)).map((column) => column.column_name));
      const common = targetColumns.filter((column) => column.is_generated !== 'ALWAYS' && sourceColumns.has(column.column_name));
      const missingRequired = targetColumns.filter((column) => column.is_generated !== 'ALWAYS'
        && !common.includes(column)
        && column.is_nullable === 'NO'
        && !column.column_default
        && column.is_identity !== 'YES');
      if (missingRequired.length) {
        throw new Error(`${table}: target requires columns missing from source: ${missingRequired.map((column) => column.column_name).join(', ')}`);
      }
      if (!common.length) { report.warnings.push(`${table}: no shared columns; skipped`); continue; }
      const sourceTypes = new Map((await columns(source, table)).map((column) => [column.column_name, column.udt_name]));
      for (const column of common) {
        if (sourceTypes.get(column.column_name) !== column.udt_name) {
          throw new Error(`${table}.${column.column_name}: type ${sourceTypes.get(column.column_name)} -> ${column.udt_name} needs an explicit transform`);
        }
      }
      plans.push({ table, columns: common.map((column) => column.column_name), targetColumns: common });
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'taibu-import-'));
    const exportScript = ['begin isolation level repeatable read read only;'];
    for (const plan of plans) {
      const file = path.join(directory, `${plan.table}.csv`);
      plan.file = file;
      const expressions = plan.targetColumns.map((column) => selectExpression(plan.table, column));
      const filter = plan.table === 'users' ? ` where "id" <> '${SYSTEM_USER}'` : '';
      exportScript.push(`\\copy (select ${expressions.join(', ')} from public."${plan.table}"${filter}) to '${file.replaceAll("'", "''")}' with (format csv)`);
    }
    exportScript.push('commit;');

    if (dryRun) {
      console.log(JSON.stringify({ ...report, plans: plans.map(({ table, columns }) => ({ table, columns: columns.length })) }, null, 2));
      await rm(directory, { recursive: true, force: true });
      return;
    }

    await psql(sourceUrl, exportScript.join('\n'));
    report.warnings.push(`source snapshot exported in ${exportScript.filter((line) => line.startsWith('\\copy')).length} tables`);

    const importScript = ['begin;', 'set local session_replication_role = replica;', ...identitySql];
    for (const plan of plans) {
      importScript.push(`\\copy public."${plan.table}" (${plan.columns.map((column) => `"${column}"`).join(', ')}) from '${plan.file.replaceAll("'", "''")}' with (format csv)`);
    }
    importScript.push('commit;');
    await psql(targetUrl, importScript.join('\n'));

    // Counts and multiset checksums, then orphan checks.
    for (const plan of plans) {
      const excludeSystem = plan.table === 'users' ? ` where id <> '${SYSTEM_USER}'` : '';
      const sourceCount = Number(await scalar(source, `select count(*) from public."${plan.table}"${excludeSystem}`));
      const targetCount = Number(await scalar(target, `select count(*) from public."${plan.table}"${excludeSystem}`));
      const entry = { table: plan.table, source: sourceCount, target: targetCount, checksum: 'skipped' };
      if (sourceCount !== targetCount) throw new Error(`${plan.table}: count ${sourceCount} -> ${targetCount}`);
      if (plan.table !== 'users') {
        const hashSql = (client) => client.query(`
          select md5(coalesce(string_agg(h, '' order by h), '')) as digest from (
            select md5(row_to_json(x)::text) as h from (
              select ${plan.columns.map((column) => `"${column}"`).join(', ')} from public."${plan.table}"
            ) x
          ) y`);
        const sourceDigest = (await hashSql(source)).rows[0].digest;
        const targetDigest = (await hashSql(target)).rows[0].digest;
        entry.checksum = sourceDigest === targetDigest ? 'ok' : 'mismatch';
        if (sourceDigest !== targetDigest) throw new Error(`${plan.table}: checksum mismatch`);
      }
      report.tables.push(entry);
    }

    const foreignKeys = (await target.query(`
      select c.conrelid::regclass::text as child,
             c.confrelid::regclass::text as parent,
             c.conname,
             (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) as child_column,
             (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) as parent_column,
             array_length(c.conkey, 1) as arity
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where c.contype = 'f' and n.nspname = 'public'`)).rows;
    for (const fk of foreignKeys) {
      if (fk.arity !== 1) { report.warnings.push(`composite foreign key ${fk.conname} was not orphan-checked`); continue; }
      const orphans = Number(await scalar(target, `
        select count(*) from ${fk.child} c
        where c."${fk.child_column}" is not null
          and not exists (select 1 from ${fk.parent} p where p."${fk.parent_column}" = c."${fk.child_column}")`));
      if (orphans > 0) throw new Error(`${fk.conname}: ${orphans} orphan rows`);
    }
    report.foreignKeysChecked = foreignKeys.filter((fk) => fk.arity === 1).length;

    // Sequence restoration for owned sequences.
    const sequences = await target.query(`
      select s.relname as sequence, t.relname as table, a.attname as column
      from pg_class s
      join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
      join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      join pg_namespace n on n.oid = s.relnamespace
      where s.relkind = 'S' and n.nspname = 'public' and t.relkind = 'r'`);
    for (const row of sequences.rows) {
      const max = await scalar(target, `select coalesce(max("${row.column}"), 0) from public."${row.table}"`);
      await target.query(`select setval($1::regclass, $2, $3)`, [`public.${row.sequence}`, Number(max), Number(max) > 0]);
    }

    if (filesRoot) await migrateAvatars(source, filesRoot);

    await target.query('analyze');
    report.finishedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`[import] complete: ${report.tables.length} tables, ${report.identity.users} users; report ${reportPath}`);
    await rm(directory, { recursive: true, force: true });
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

async function migrateAvatars(source, root) {
  const rows = (await source.query(`
    select avatar_url from public.users
    where avatar_url like '%/storage/v1/object/public/avatars/%'`)).rows;
  const { mkdir, writeFile: write } = await import('node:fs/promises');
  await mkdir(path.join(root, 'avatars'), { recursive: true, mode: 0o750 });
  for (const row of rows) {
    const key = row.avatar_url.split('/storage/v1/object/public/avatars/')[1];
    if (!key || key.includes('..')) { report.files.failed.push('invalid key'); continue; }
    const target = path.join(root, 'avatars', key);
    const absolute = path.resolve(target);
    if (!absolute.startsWith(`${path.resolve(root, 'avatars')}${path.sep}`)) {
      report.files.failed.push('path escape'); continue;
    }
    try {
      const response = await fetch(row.avatar_url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(String(response.status));
      await write(absolute, Buffer.from(await response.arrayBuffer()), { mode: 0o640 });
      report.files.downloaded += 1;
    } catch (error) {
      report.files.failed.push(`${key}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
}

main().catch(async (error) => {
  report.error = error instanceof Error ? error.message : String(error);
  report.finishedAt = new Date().toISOString();
  try {
    const { mkdir, writeFile: write } = await import('node:fs/promises');
    await mkdir(path.dirname(reportPath), { recursive: true });
    await write(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  } catch { /* best effort */ }
  console.error(`[import] failed: ${report.error}`);
  process.exitCode = 1;
});
