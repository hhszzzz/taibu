#!/usr/bin/env node
// Builds the transit database used before importing into the new stack.
//
// Input is a directory produced from a read-only production snapshot:
//   public.dump            pg_dump -Fc --no-owner --schema=public \
//                            --schema=supabase_migrations
//   auth.users.csv         \copy (select * from auth.users) csv header
//   auth.identities.csv    same for auth.identities (optional)
//   storage.buckets.csv    same for storage.buckets (optional)
//   storage.objects.csv    same for storage.objects (optional)
//
// The script creates an empty database, installs scripts/db/transit/shim.sql,
// restores the dump, loads the GoTrue CSVs and replays every migration listed
// in scripts/db/transit/pending.json after verifying its sha256. The result is
// a database whose public schema matches production at cutover time, which
// scripts/db/import-supabase.mjs then reads.
//
// Usage:
//   TRANSIT_TARGET_URL=postgres://... node scripts/db/transit-build.mjs \
//     --dump /path/to/dump [--recreate] [--report tmp/transit.json]
//
// The DSN is read from the environment (or --target) so passwords never show
// up in process listings of the helper commands.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { defaultReportPath } from './report-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PSQL_BIN = process.env.PSQL_BIN || 'psql';
const PG_RESTORE_BIN = process.env.PG_RESTORE_BIN || 'pg_restore';
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const dumpDir = path.resolve(value('--dump', ''));
const targetUrl = value('--target', process.env.TRANSIT_TARGET_URL);
const pendingPath = path.resolve(value('--pending', path.join(root, 'scripts/db/transit/pending.json')));
const shimPath = path.join(root, 'scripts/db/transit/shim.sql');
const reportPath = path.resolve(value('--report', defaultReportPath(root, 'transit')));
const maintenanceDb = value('--maintenance-db', 'postgres');
const recreate = has('--recreate');
const dryRun = has('--dry-run');

if (!value('--dump', '') || !existsSync(dumpDir)) {
  console.error('[transit] --dump <directory> is required and must exist');
  process.exit(1);
}
if (!targetUrl) {
  console.error('[transit] TRANSIT_TARGET_URL or --target <dsn> is required');
  process.exit(1);
}

const report = {
  startedAt: new Date().toISOString(),
  dump: dumpDir,
  steps: [],
  pending: [],
  errors: [],
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
    PGCLIENTENCODING: 'UTF8',
  };
}

function databaseName(dsn) {
  return decodeURIComponent(new URL(dsn).pathname.slice(1));
}

function withDatabase(dsn, database) {
  const url = new URL(dsn);
  url.pathname = `/${database}`;
  return url.toString();
}

function run(command, commandArgs, { dsn, timeout = 1_800_000, capture = true, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env: dsn ? connectionEnv(dsn) : process.env,
      stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function psql(dsn, script, { timeout = 1_800_000 } = {}) {
  const result = await run(
    PSQL_BIN,
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', databaseName(dsn), '-f', '-'],
    { dsn, timeout, input: script },
  );
  if (result.code !== 0) {
    throw new Error(`psql failed: ${lastLines(result.stderr)}`);
  }
  return result.stdout;
}

async function psqlFile(dsn, file, { singleTransaction = false, timeout = 1_800_000 } = {}) {
  const argv = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  if (singleTransaction) argv.push('-1');
  argv.push('-f', file, '-d', databaseName(dsn));
  const result = await run(PSQL_BIN, argv, { dsn, timeout });
  if (result.code !== 0) {
    throw new Error(`psql ${path.basename(file)} failed: ${lastLines(result.stderr)}`);
  }
  return result.stdout;
}

function lastLines(text, count = 6) {
  return text.trim().split('\n').slice(-count).join(' | ');
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

/** CSV headers are simple here (no embedded newlines); pg's exports quote when needed. */
function csvHeader(file) {
  const text = readFileSync(file, 'utf8');
  const line = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n')).replace(/\r$/u, '');
  const fields = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.replace(/^﻿/u, '').trim());
}

const PENDING_SCHEMA = 'taibu-transit-pending/1';
const ALLOWED_RESTORE_ERRORS = [
  // The dump may carry grants/owners for Supabase-internal roles even with
  // --no-owner --no-privileges, and its extension list can name modules the
  // transit server does not ship. Neither affects application objects.
  /role "[^"]+" does not exist/u,
  /must be owner of (?:extension|schema|table|function|type) /u,
  /permission denied to (?:create|set) (?:extension|role|parameter) /u,
  /extension "[^"]+" is not available/u,
  /schema "public" already exists/u,
];

function checkPendingManifest() {
  const manifest = JSON.parse(readFileSync(pendingPath, 'utf8'));
  if (manifest.schema !== PENDING_SCHEMA) throw new Error(`unexpected pending manifest schema: ${manifest.schema}`);
  const seen = new Set();
  for (const entry of manifest.migrations) {
    if (seen.has(entry.file)) throw new Error(`duplicate pending migration: ${entry.file}`);
    seen.add(entry.file);
    const file = path.join(root, 'supabase/migrations', entry.file);
    if (!existsSync(file)) throw new Error(`pending migration missing: ${entry.file}`);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(`pending migration ${entry.file} changed (sha256 ${actual} != ${entry.sha256})`);
    }
  }
  return manifest;
}

async function assertEmpty(client) {
  const { rows } = await client.query(`
    select
      (select count(*)::int from pg_tables where schemaname = 'public') as public_tables,
      to_regclass('supabase_migrations.schema_migrations') is not null as has_migrations,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relkind = 'r') as auth_tables`);
  const state = rows[0];
  if (state.public_tables > 0 || state.has_migrations || state.auth_tables > 0) {
    throw new Error(
      `target database is not empty (public tables: ${state.public_tables}, ` +
      `migrations table: ${state.has_migrations}, auth tables: ${state.auth_tables}); ` +
      'pass --recreate to rebuild it',
    );
  }
}

async function recreateDatabase() {
  const name = databaseName(targetUrl);
  const adminUrl = withDatabase(targetUrl, maintenanceDb);
  await withClient(adminUrl, async (client) => {
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
  });
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

async function stagingSql(dsn, table, csvFile) {
  const header = csvHeader(csvFile);
  const [schema, relation] = table.split('.');
  const types = await withClient(dsn, async (client) => {
    const { rows } = await client.query(`
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`, [table]);
    return new Map(rows.map((row) => [row.name, row.type]));
  });
  const quoted = (column) => `"${column.replaceAll('"', '""')}"`;
  const staged = header.map((column) => `${quoted(column)} ${types.get(column) ?? 'text'}`);
  // Load the CSV unchanged into a staging table, then copy the intersection.
  // A production CSV can contain generated columns (confirmed_at, email) that
  // the shim intentionally omits, and \copy cannot skip a middle field.
  const shared = header.filter((column) => types.has(column));
  return `
create temp table _transit_stage (${staged.join(', ')});
\\copy _transit_stage (${header.map(quoted).join(', ')}) from '${csvFile.replaceAll("'", "''")}' with (format csv, header true)
insert into ${schema}.${relation} (${shared.map(quoted).join(', ')})
  select ${shared.map(quoted).join(', ')} from _transit_stage;
`;
}

async function loadCsv(dsn, table, csvFile) {
  await psql(dsn, await stagingSql(dsn, table, csvFile));
  return withClient(dsn, async (client) => {
    const { rows } = await client.query(`select count(*)::int as count from ${table}`);
    return rows[0].count;
  });
}

async function migrationState(dsn) {
  return withClient(dsn, async (client) => {
    const exists = await client.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`);
    if (!exists.rows[0].ok) throw new Error('restored dump has no supabase_migrations.schema_migrations');
    const { rows } = await client.query(
      `select version, name from supabase_migrations.schema_migrations order by version`,
    );
    return rows;
  });
}

function hasExplicitTransaction(file) {
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    return /^begin\b/iu.test(trimmed);
  }
  return false;
}

async function main() {
  const manifest = checkPendingManifest();

  const dumps = readdirSync(dumpDir).filter((file) => file.endsWith('.dump'));
  if (dumps.length !== 1) throw new Error(`expected exactly one *.dump in ${dumpDir}, found ${dumps.length}`);
  const dumpFile = path.join(dumpDir, dumps[0]);
  if (!existsSync(shimPath)) throw new Error('scripts/db/transit/shim.sql is missing');

  const csvTables = [
    ['auth.users', 'auth.users.csv'],
    ['auth.identities', 'auth.identities.csv'],
    ['storage.buckets', 'storage.buckets.csv'],
    ['storage.objects', 'storage.objects.csv'],
  ].filter(([, file]) => existsSync(path.join(dumpDir, file)));

  const plan = {
    target: redact(targetUrl),
    dump: path.basename(dumpFile),
    csv: csvTables.map(([, file]) => file),
    pending: manifest.migrations.length,
    appliedThrough: manifest.source.appliedThrough,
  };
  if (dryRun) {
    console.log(JSON.stringify({ ...report, plan }, null, 2));
    return;
  }

  const started = Date.now();
  const step = async (name, work) => {
    const at = Date.now();
    const detail = await work();
    const durationMs = Date.now() - at;
    report.steps.push({ name, durationMs, ...(detail ? { detail } : {}) });
    console.log(`[transit] ${name} (${durationMs} ms)`);
  };

  if (recreate) await step('recreate database', recreateDatabase);
  else await step('check target is empty', () => withClient(targetUrl, assertEmpty));

  await step('install shim', () => psqlFile(targetUrl, shimPath));

  // auth.users must be populated before public tables restore their rows:
  // production public data references auth.users, not public.users.
  for (const [table, file] of csvTables) {
    await step(`load ${file}`, async () => ({ rows: await loadCsv(targetUrl, table, path.join(dumpDir, file)) }));
  }

  await step('restore dump', async () => {
    const result = await run(
      PG_RESTORE_BIN,
      ['--no-owner', '--no-privileges', '-d', databaseName(targetUrl), dumpFile],
      { dsn: targetUrl },
    );
    const errors = result.stderr.split('\n')
      .filter((line) => line.includes('pg_restore: error:'))
      .map((line) => line.replace(/^pg_restore: error:\s*/u, '').trim());
    const unexpected = errors.filter((error) => !ALLOWED_RESTORE_ERRORS.some((pattern) => pattern.test(error)));
    report.errors.push(...errors);
    if (result.code !== 0 && errors.length === 0) {
      throw new Error(`pg_restore failed (${result.code}) without a parseable error: ${lastLines(result.stderr)}`);
    }
    if (unexpected.length) {
      throw new Error(`pg_restore reported ${unexpected.length} unexpected error(s): ${unexpected.slice(0, 5).join(' | ')}`);
    }
    return { allowedErrors: errors.length };
  });

  await step('validate migration state', async () => {
    const rows = await migrationState(targetUrl);
    const expected = manifest.source.appliedThrough;
    const last = rows.at(-1);
    if (!last || last.version !== expected.version || last.name !== expected.name) {
      throw new Error(
        `dump migration state does not end at ${expected.version} ${expected.name}; ` +
        `found ${last ? `${last.version} ${last.name}` : 'none'}`,
      );
    }
    const unknown = rows.filter((row) => row.version > expected.version);
    if (unknown.length) {
      throw new Error(`dump contains migrations newer than cutover state: ${unknown.map((row) => row.version).join(', ')}`);
    }
    return { rows: rows.length };
  });

  for (const entry of manifest.migrations) {
    const file = path.join(root, 'supabase/migrations', entry.file);
    const at = Date.now();
    await psqlFile(targetUrl, file, { singleTransaction: !hasExplicitTransaction(file) });
    const durationMs = Date.now() - at;
    report.pending.push({ file: entry.file, durationMs });
    console.log(`[transit] replay ${entry.file} (${durationMs} ms)`);
  }

  await step('analyze', () => psql(targetUrl, 'analyze;'));

  report.totalDurationMs = Date.now() - started;
  report.finishedAt = new Date().toISOString();
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[transit] complete: ${manifest.migrations.length} migrations replayed; report ${reportPath}`);
}

main().catch((error) => {
  report.finishedAt = new Date().toISOString();
  report.fatal = error.message;
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch { /* report is best effort */ }
  console.error(`[transit] failed: ${error.message}`);
  process.exitCode = 1;
});
