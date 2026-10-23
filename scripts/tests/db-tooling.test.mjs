import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chmodSync, ftruncateSync, mkdtempSync, openSync, closeSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { defaultReportPath } from '../db/report-path.mjs';
import { fileURLToPath } from 'node:url';

import { normalizeSchemaDump } from '../db/normalize-schema.mjs';
import { repairConcurrentIndexes } from '../db/concurrent-indexes.mjs';
import { execute } from '../selfhost.mjs';
import { libpqEnvironment } from '../db/connection-env.mjs';
import { csvHeader } from '../db/csv-header.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('transit pending manifest pins every migration after the production cut state', () => {
  const manifest = JSON.parse(read('scripts/db/transit/pending.json'));
  assert.equal(manifest.schema, 'taibu-transit-pending/1');
  assert.ok(manifest.source.appliedThrough.version);
  assert.ok(manifest.source.appliedThrough.name);

  const files = manifest.migrations.map((entry) => entry.file);
  assert.deepEqual(files, [...files].sort(), 'migrations must stay in version order');
  assert.equal(new Set(files).size, files.length, 'duplicate migrations are not allowed');

  const recorded = files.find((file) => file.includes(manifest.source.appliedThrough.name));
  assert.equal(recorded, undefined, 'appliedThrough must not also be pending');

  for (const entry of manifest.migrations) {
    const sql = readFileSync(path.join(root, 'supabase/migrations', entry.file), 'utf8');
    assert.equal(createHash('sha256').update(sql).digest('hex'), entry.sha256, `${entry.file} changed`);
  }
});

test('transit shim provides the Supabase surface the dump and pending migrations use', () => {
  const shim = read('scripts/db/transit/shim.sql');
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS auth.users',
    'CREATE TABLE IF NOT EXISTS auth.identities',
    'CREATE TABLE IF NOT EXISTS storage.buckets',
    'CREATE TABLE IF NOT EXISTS storage.objects',
    'FUNCTION auth.uid()',
    'FUNCTION auth.role()',
    'FUNCTION auth.jwt()',
    "rolname = 'authenticated'",
    "rolname = 'service_role'",
  ]) {
    assert.ok(shim.includes(fragment), `shim is missing ${fragment}`);
  }
});

test('schema snapshot covers identity, auth and migration bookkeeping', () => {
  const schema = read('database/schema.sql');
  assert.match(schema, /^-- Database schema snapshot\./u);
  for (const fragment of [
    'CREATE TABLE identity.users',
    'CREATE TABLE identity.sessions',
    'CREATE TABLE identity.accounts',
    'CREATE TABLE identity.verifications',
    'CREATE FUNCTION auth.uid()',
    'CREATE TABLE taibu_meta.schema_migrations',
  ]) {
    assert.ok(schema.includes(fragment), `snapshot is missing ${fragment}`);
  }
  assert.ok(!schema.includes('owner to'), 'snapshot must not depend on object owners');
});

test('schema normalisation ignores dump order and session boilerplate', () => {
  const a = [
    'SET client_encoding = \'UTF8\';',
    '-- Name: alpha; Type: TABLE; Schema: public; Owner: -',
    'CREATE TABLE public.alpha (id integer);',
    '-- Name: beta; Type: TABLE; Schema: public; Owner: -',
    'CREATE TABLE public.beta (id integer);',
  ].join('\n');
  const b = [
    'SELECT pg_catalog.set_config(\'search_path\', \'\', false);',
    '-- Name: beta; Type: TABLE; Schema: public; Owner: -',
    'CREATE TABLE public.beta (id integer);',
    '-- Name: alpha; Type: TABLE; Schema: public; Owner: -',
    'CREATE TABLE public.alpha (id integer);',
  ].join('\n');
  assert.equal(normalizeSchemaDump(a), normalizeSchemaDump(b));
  assert.equal(normalizeSchemaDump(a), normalizeSchemaDump(a));
  assert.ok(normalizeSchemaDump(a).indexOf('alpha') < normalizeSchemaDump(a).indexOf('beta'));
});

test('concurrent index migrations are replay-safe after an invalid index residue', () => {
  const runner = read('scripts/db/migrate.mjs');
  const repair = read('scripts/db/concurrent-indexes.mjs');
  const migration = read('database/migrations/0014_repair_concurrent_indexes.sql');
  assert.match(runner, /pg_try_advisory_lock[\s\S]*appliedRows/u);
  assert.match(runner, /repairConcurrentIndexes\(client, migration\.sql\)/u);
  assert.match(repair, /indisvalid|indisready/u);
  assert.match(migration, /create index concurrently if not exists agent_claim_queued/u);
});

test('index recovery only drops invalid indexes declared by a concurrent migration', async () => {
  const calls = [];
  await repairConcurrentIndexes({ query: async (sql, args) => {
    calls.push({ sql, args });
    return { rows: args ? [{ qualified_name: 'public.agent_claim_queued' }] : [] };
  } }, 'create index concurrently if not exists agent_claim_queued on public.agent_runs (created_at);');
  assert.deepEqual(calls[0].args, [['agent_claim_queued']]);
  assert.match(calls[0].sql, /not i.indisvalid or not i.indisready/u);
  assert.equal(calls[1].sql, 'DROP INDEX CONCURRENTLY IF EXISTS public.agent_claim_queued');
  assert.equal(calls.length, 2);
});

test('selfhost subprocesses receive all binary restore bytes through stdin', async () => {
  const bytes = Buffer.from([0, 255, 13, 10, ...Buffer.from('PGDMP')]);
  const received = await execute(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: bytes, binary: true });
  assert.deepEqual(received, bytes);
  await assert.rejects(execute(process.execPath, ['-e', 'process.exit(1)'], { input: bytes }), /本地操作失败/);
});

test('database CLI environments preserve TLS and connection URI options without argv credentials', () => {
  const env = libpqEnvironment('postgres://alice:encoded%40secret@localhost:5544/example?sslmode=verify-full&sslrootcert=%2Ftmp%2Froot.crt&channel_binding=require&connect_timeout=3');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGSSLROOTCERT, '/tmp/root.crt');
  assert.equal(env.PGCHANNELBINDING, 'require');
  assert.equal(env.PGCONNECT_TIMEOUT, '3');
  assert.equal(env.PGPASSWORD, 'encoded@secret');
  assert.equal(env.PGDATABASE, 'example');
  assert.equal(libpqEnvironment('postgres://alice:fixture@[::1]:5544/example').PGHOST, '::1');
  assert.throws(() => libpqEnvironment('postgres://localhost/db?unsupported=1'), /Unsupported libpq URI option/);
});

test('CSV headers are bounded even when the exported table is several GiB', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-csv-header-'));
  try {
    const file = path.join(directory, 'large.csv');
    writeFileSync(file, '\uFEFFid,"comma,name","quote""name"\r\n');
    const fd = openSync(file, 'r+');
    try { ftruncateSync(fd, 3 * 1024 * 1024 * 1024); } finally { closeSync(fd); }
    assert.deepEqual(csvHeader(file), ['id', 'comma,name', 'quote"name']);
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
    assert.throws(() => csvHeader(file), /header exceeds/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offsite backups run after a missed minute, retry failures, and run once per day', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-backup-schedule-'));
  const script = (name, text) => { const file = path.join(directory, name); writeFileSync(file, text, { mode: 0o700 }); return file; };
  try {
    const backup = script('backup.sh', '#!/bin/sh\necho "$1" >> "$TEST_DIR/calls"\nif [ "$1" = offsite ] && [ ! -f "$TEST_DIR/failed" ]; then touch "$TEST_DIR/failed"; exit 1; fi\n');
    script('date', '#!/bin/sh\nn=$(cat "$TEST_DIR/tick" 2>/dev/null || echo 0)\ncase "$1" in +%F) if [ "$n" -ge 4 ]; then echo 2026-10-24; else echo 2026-10-23; fi;; +%H) case "$n" in 0) echo 02;; 1) echo 03;; 2) echo 04;; 3) echo 05;; *) echo 03;; esac;; esac\n');
    script('sleep', '#!/bin/sh\nn=$(cat "$TEST_DIR/tick" 2>/dev/null || echo 0)\nn=$((n+1)); echo "$n" > "$TEST_DIR/tick"\n[ "$n" -lt 5 ] || exit 9\n');
    const entry = script('entry.sh', read('deploy/backup/entrypoint.sh').replaceAll('/usr/local/bin/backup.sh', backup));
    await assert.rejects(execute('sh', [entry], { env: { ...process.env, TEST_DIR: directory, PATH: `${directory}:${process.env.PATH}` } }));
    const calls = readFileSync(path.join(directory, 'calls'), 'utf8').trim().split('\n');
    assert.equal(calls.filter(mode => mode === 'hourly').length, 5);
    assert.equal(calls.filter(mode => mode === 'offsite').length, 3);
    assert.deepEqual(calls, ['hourly', 'hourly', 'offsite', 'prune', 'hourly', 'offsite', 'prune', 'hourly', 'hourly', 'offsite', 'prune']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a failed dump is removed before any final archive name is published', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-backup-atomic-'));
  try {
    const dump = path.join(directory, 'pg_dump');
    writeFileSync(dump, '#!/bin/sh\nwhile [ "$1" != -f ]; do shift; done\nshift; echo partial > "$1"\nexit 1\n', { mode: 0o700 });
    const script = path.join(directory, 'backup.sh');
    writeFileSync(script, read('deploy/backup/backup.sh').replaceAll('/backups', directory));
    await assert.rejects(execute('sh', [script, 'hourly'], { env: { ...process.env, TAIBU_BACKUP_PASSWORD: 'fixture', PATH: `${directory}:${process.env.PATH}` } }));
    assert.deepEqual(readdirSync(directory).sort(), ['backup.sh', 'pg_dump']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('report paths fall back to the OS temp dir when the preferred one is read-only', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-report-'));
  try {
    assert.ok(defaultReportPath(directory, 'ok', 'json', {}).startsWith(directory));
    chmodSync(directory, 0o500);
    const fallback = defaultReportPath(directory, 'ro', 'json', { TAIBU_REPORT_DIR: directory });
    assert.ok(!fallback.startsWith(directory), 'a read-only directory must not be used');
    assert.ok(fallback.startsWith(tmpdir()));
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});
