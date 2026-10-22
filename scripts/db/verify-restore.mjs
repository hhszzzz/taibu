#!/usr/bin/env node
// Restores a custom-format backup into a throwaway database and verifies it.
//
// Weekly drill (deploy/backup/backup.sh):
//   node scripts/db/verify-restore.mjs --backup /backups/pg/taibu-....dump \
//     --admin-dsn postgres://.../postgres
//
// If --compare points at the live database, row counts of every public and
// identity table must match as well. The temporary database is dropped unless
// --keep is passed. Exit code 1 means the backup is not trustworthy.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { defaultReportPath } from './report-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PG_RESTORE_BIN = process.env.PG_RESTORE_BIN || 'pg_restore';
const migrationsDir = path.join(root, 'database/migrations');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const backupPath = path.resolve(value('--backup', ''));
const adminDsn = value('--admin-dsn', process.env.RESTORE_ADMIN_URL);
const compareDsn = value('--compare', process.env.RESTORE_COMPARE_URL);
const database = value('--database', 'taibu_restore_check');
const reportPath = path.resolve(value('--report', defaultReportPath(root, 'restore')));
const keep = has('--keep');

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

function connectionEnv(dsn) {
  const url = new URL(dsn);
  return {
    ...process.env,
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGOPTIONS: '',
  };
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
      env: connectionEnv(dsn),
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
      if (row.table === 'schema_migrations') continue;
      const { rows: countRows } = await client.query(
        `select count(*)::bigint as count from ${quoteIdent(row.schema)}.${quoteIdent(row.table)}`,
      );
      counts[`${row.schema}.${row.table}`] = Number(countRows[0].count);
    }
    return counts;
  });
}

function expectedMigrations() {
  const pattern = /^(\d{4})_([a-z0-9_]+)\.sql$/u;
  return readdirSync(migrationsDir)
    .filter((file) => pattern.test(file))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      return {
        version: pattern.exec(file)[1],
        name: pattern.exec(file)[2],
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
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

const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1', 'taibu']);

async function main() {
  if (PROTECTED_DATABASES.has(database)) {
    throw new Error(`refusing to drop protected database "${database}"; choose a temporary name`);
  }
  const started = Date.now();
  const restoredUrl = withDatabase(adminDsn, database);
  const adminUrl = adminDsn;

  await withClient(adminUrl, async (client) => {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoteIdent(database)}`);
  });
  report.steps.push({ name: 'create database', durationMs: Date.now() - started });

  const restoreAt = Date.now();
  const restored = await run(PG_RESTORE_BIN, ['--no-owner', '--no-privileges', '--exit-on-error', '-d', database, backupPath], adminDsn);
  if (restored.code !== 0) {
    throw new Error(`pg_restore failed: ${restored.stderr.trim().split('\n').slice(-4).join(' | ')}`);
  }
  report.steps.push({ name: 'pg_restore', durationMs: Date.now() - restoreAt });

  const migrations = expectedMigrations();
  const applied = await withClient(restoredUrl, async (client) => {
    const { rows } = await client.query('select version, name, checksum from taibu_meta.schema_migrations order by version');
    return rows;
  });
  check('migration count', applied.length === migrations.length, { applied: applied.length, expected: migrations.length });
  const byVersion = new Map(applied.map((row) => [row.version, row]));
  const missing = migrations.filter((migration) => !byVersion.has(migration.version));
  const checksumMismatch = migrations.filter((migration) => {
    const row = byVersion.get(migration.version);
    return row && (row.checksum !== migration.checksum || row.name !== migration.name);
  });
  check('all migrations recorded', missing.length === 0 && checksumMismatch.length === 0, {
    missing: missing.map((migration) => migration.version),
    checksumMismatch: checksumMismatch.map((migration) => migration.version),
  });

  const counts = await tableCounts(restoredUrl);
  check('identity users present', (counts['identity.users'] ?? 0) > 0, counts['identity.users']);
  check('profile rows match identity users',
    counts['public.users'] === counts['identity.users'],
    { identity: counts['identity.users'], profile: counts['public.users'] });
  check('core tables restored', Object.keys(counts).length >= 40, { tables: Object.keys(counts).length });

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

  if (!keep) {
    await withClient(adminUrl, async (client) => {
      await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    });
    report.databaseDropped = true;
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
