#!/usr/bin/env node
// Restores a custom-format backup into a throwaway database and verifies it.
//
// Weekly drill (deploy/backup/backup.sh):
//   node scripts/db/verify-restore.mjs --backup /backups/taibu-....dump \
//     --admin-dsn postgres://.../postgres
//
// The restored catalog is compared with this release's database/*.sql, so a
// backup that lost policies, triggers, views, indexes or row level security
// fails instead of passing on row counts alone. A backup taken by an older
// release can legitimately differ: pass --no-schema to skip that check.
// If --compare points at the live database, row counts of every public and
// identity table must match as well. The temporary database is dropped unless
// --keep is passed. Owner/ACL restoration is excluded from this drill.
// A failed check exits with code 1.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { defaultReportPath } from './report-path.mjs';
import { libpqEnvironment } from './connection-env.mjs';
import { readDatabaseDefinitions } from './current-sql.mjs';
import {
  compareTables, describeIndexes, describePolicies, describeRoutines, describeRowSecurity, describeTables,
  describeTriggers, describeViews,
} from './catalog.mjs';
import { QUALIFIED, qualifiedName } from './sql-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PG_RESTORE_BIN = process.env.PG_RESTORE_BIN || 'pg_restore';
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const backupPath = path.resolve(value('--backup', ''));
const adminDsn = value('--admin-dsn', process.env.RESTORE_ADMIN_URL);
const compareDsn = value('--compare', process.env.RESTORE_COMPARE_URL);
const database = value('--database', `taibu_restore_${randomUUID().replaceAll('-', '')}`);
const reportPath = path.resolve(value('--report', defaultReportPath(root, 'restore')));
const keep = has('--keep');
const checkSchema = !has('--no-schema');

if (!value('--backup', '') || !existsSync(backupPath)) {
  console.error('[restore-check] --backup <file.dump> is required and must exist');
  process.exit(1);
}
if (!adminDsn) {
  console.error('[restore-check] --admin-dsn or RESTORE_ADMIN_URL is required');
  process.exit(1);
}

const report = {
  startedAt: new Date().toISOString(),
  backup: path.basename(backupPath),
  database,
  steps: [],
  checks: [],
  failures: [],
};

function check(name, passed, detail) {
  report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  if (!passed) report.failures.push(name);
  console.log(`[restore-check] ${passed ? 'ok' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
}


function withDatabase(dsn, name) {
  const url = new URL(dsn);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

async function withClient(dsn, work) {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function run(command, commandArgs, dsn) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env: libpqEnvironment(dsn),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function tableCounts(dsn) {
  return withClient(dsn, async (client) => {
    const { rows } = await client.query(`
      select n.nspname as schema, c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'identity')
      order by 1, 2`);
    const counts = {};
    for (const row of rows) {
      const { rows: countRows } = await client.query(
        `select count(*)::bigint as count from ${quoteIdent(row.schema)}.${quoteIdent(row.table)}`,
      );
      counts[`${row.schema}.${row.table}`] = Number(countRows[0].count);
    }
    return counts;
  });
}

/** Objects the release declares, compared with what the restore actually produced. */
async function schemaDrift(dsn, definitions) {
  return withClient(dsn, async (client) => {
    // Canonical forms are produced with an empty search_path, as db:init does.
    await client.query("SET search_path = ''");
    const problems = compareTables(definitions.tables, await describeTables(client));
    const sets = [
      ['policy', item => `${item.table} ${item.name}`, definitions.policies, await describePolicies(client)],
      ['trigger', item => `${item.table} ${item.name}`, definitions.triggers, await describeTriggers(client)],
      ['view', item => item.name, definitions.views, await describeViews(client)],
      ['index', item => item.name, definitions.indexes, await describeIndexes(client)],
    ];
    for (const [kind, key, declared, live] of sets) {
      const remaining = new Map(live.map((item) => [key(item), item]));
      for (const item of declared) {
        const existing = remaining.get(key(item));
        if (!existing) problems.push(`${kind} ${key(item)} is missing`);
        else if (existing.canonical !== item.canonical) problems.push(`${kind} ${key(item)} differs from database/${kind}s.sql`);
        remaining.delete(key(item));
      }
      for (const name of remaining.keys()) problems.push(`${kind} ${name} is not declared`);
    }
    const routines = new Map((await describeRoutines(client)).map((routine) => [routine.name, routine]));
    const declaredFunctions = new Set(definitions.functions.map((statement) =>
      qualifiedName(new RegExp(`^CREATE OR REPLACE FUNCTION (${QUALIFIED})\\s*\\(`, 'u').exec(statement.canonical)[1])));
    for (const name of declaredFunctions) if (!routines.has(name)) problems.push(`function ${name} is missing`);
    for (const routine of routines.keys()) if (!declaredFunctions.has(routine)) problems.push(`function ${routine} is not declared`);
    const rowSecurity = await describeRowSecurity(client);
    for (const table of definitions.rowSecurity) if (!rowSecurity.has(table)) problems.push(`${table}: row level security is off`);
    for (const table of rowSecurity) if (!definitions.rowSecurity.includes(table)) problems.push(`${table}: row level security is on but not declared`);
    return problems;
  });
}

async function orphanCheck(dsn) {
  return withClient(dsn, async (client) => {
    const { rows: definitions } = await client.query(`
      select c.conname as name,
             c.conrelid::regclass::text as child,
             c.confrelid::regclass::text as parent,
             json_agg(json_build_object(
               'child', a.attname,
               'parent', af.attname
             ) order by k.ord) as pairs
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join unnest(c.conkey) with ordinality k(attnum, ord) on true
      join unnest(c.confkey) with ordinality fk(attnum, ord) on fk.ord = k.ord
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = fk.attnum
      where c.contype = 'f' and n.nspname in ('public', 'identity')
      group by c.oid, c.conname, c.conrelid, c.confrelid
      order by 1`);
    const failures = [];
    for (const definition of definitions) {
      const notNull = definition.pairs
        .map((pair) => `child.${quoteIdent(pair.child)} is not null`)
        .join(' and ');
      const match = definition.pairs
        .map((pair) => `parent.${quoteIdent(pair.parent)} = child.${quoteIdent(pair.child)}`)
        .join(' and ');
      const { rows: result } = await client.query(`
        select count(*)::bigint as count from ${definition.child} child
        where ${notNull}
          and not exists (select 1 from ${definition.parent} parent where ${match})`);
      if (Number(result[0].count) > 0) {
        failures.push({ constraint: definition.name, child: definition.child, rows: Number(result[0].count) });
      }
    }
    return { checks: definitions.length, failures };
  });
}

async function main() {
  if (!/^taibu_restore_[a-z0-9_]+$/u.test(database)) {
    throw new Error('restore verification requires a temporary database named taibu_restore_<suffix>');
  }
  const started = Date.now();
  const restoredUrl = withDatabase(adminDsn, database);
  const adminUrl = adminDsn;

  await withClient(adminUrl, async (client) => {
    // CREATE must fail if the name already exists. Never delete an unowned DB.
    await client.query(`CREATE DATABASE ${quoteIdent(database)}`);
  });
  report.steps.push({ name: 'create database', durationMs: Date.now() - started });

  try {
    const restoreAt = Date.now();
    const restored = await run(PG_RESTORE_BIN, ['--no-owner', '--no-privileges', '--exit-on-error', '-d', database, backupPath], adminDsn);
    if (restored.code !== 0) {
      throw new Error(`pg_restore failed: ${restored.stderr.trim().split('\n').slice(-4).join(' | ')}`);
    }
    report.steps.push({ name: 'pg_restore', durationMs: Date.now() - restoreAt });

    const structure = await withClient(restoredUrl, async client => {
      const { rows } = await client.query("select to_regclass('identity.users') is not null and to_regclass('public.users') is not null as ready");
      return rows[0].ready;
    });
    check('native identity and profile definitions restored', structure);

    const counts = await tableCounts(restoredUrl);
    check('identity users present', (counts['identity.users'] ?? 0) > 0, counts['identity.users']);
    check('profile rows match identity users',
      counts['public.users'] === counts['identity.users'],
      { identity: counts['identity.users'], profile: counts['public.users'] });
    check('core tables restored', Object.keys(counts).length >= 40, { tables: Object.keys(counts).length });

    if (checkSchema) {
      const schemaAt = Date.now();
      const drift = await schemaDrift(restoredUrl, await readDatabaseDefinitions(root));
      check('restored definitions match database/*.sql', drift.length === 0, drift.slice(0, 10));
      report.steps.push({ name: 'schema comparison', durationMs: Date.now() - schemaAt });
    }

    const orphans = await orphanCheck(restoredUrl);
    check('no orphaned foreign keys', orphans.failures.length === 0, {
      checked: orphans.checks, failures: orphans.failures.slice(0, 5),
    });

    if (compareDsn) {
      const live = await tableCounts(compareDsn);
      const mismatches = [];
      for (const table of new Set([...Object.keys(counts), ...Object.keys(live)])) {
        if (counts[table] !== live[table]) mismatches.push({ table, restored: counts[table], live: live[table] });
      }
      check('row counts match live database', mismatches.length === 0, { mismatches: mismatches.slice(0, 10) });
    }

    report.counts = counts;
    report.totalDurationMs = Date.now() - started;
    report.finishedAt = new Date().toISOString();
  } finally {
    if (!keep) {
      await withClient(adminUrl, async (client) => {
        await client.query(`DROP DATABASE ${quoteIdent(database)} WITH (FORCE)`);
      });
      report.databaseDropped = true;
    }
  }

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) {
    console.error(`[restore-check] failed: ${report.failures.join(', ')}; report ${reportPath}`);
    process.exitCode = 1;
  } else {
    console.log(`[restore-check] backup verified; report ${reportPath}`);
  }
}

main().catch((error) => {
  report.finishedAt = new Date().toISOString();
  report.fatal = error.message;
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch { /* report is best effort */ }
  console.error(`[restore-check] failed: ${error.message}`);
  process.exitCode = 1;
});
