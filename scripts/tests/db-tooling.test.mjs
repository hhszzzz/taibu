import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { defaultReportPath } from '../db/report-path.mjs';
import { fileURLToPath } from 'node:url';

import { normalizeSchemaDump } from '../db/normalize-schema.mjs';
import { execute } from '../selfhost.mjs';
import { libpqEnvironment } from '../db/connection-env.mjs';
import { DATABASE_SQL_FILES, parseDatabaseSql } from '../db/current-sql.mjs';
import { normalizeStatement, splitStatements } from '../db/sql-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const currentSql = () => Object.fromEntries(DATABASE_SQL_FILES.map(name => [name, read(`database/${name}.sql`)]));

test('current SQL includes native identities and explicit access boundaries', () => {
  const definitions = parseDatabaseSql(currentSql());
  const columns = name => definitions.tables.find(table => table.name === name).columns.map(column => column.name);
  assert.equal(definitions.tables.length, 61);
  assert.ok(columns('identity.users').includes('email'));
  assert.ok(columns('public.notifications').includes('is_read'));
  assert.deepEqual(columns('public.agent_workers'), ['id', 'heartbeat_at', 'engine']);
  assert.ok(!columns('public.agent_runs').includes('call_id'));
  assert.deepEqual(definitions.tables.find(table => table.name === 'public.agent_runs').columns
    .find(column => column.name === 'status'), { name: 'status', definition: "text DEFAULT 'queued'::text NOT NULL", compression: null, identity: null });
  assert.ok(definitions.grants.some(grant => grant.canonical === 'GRANT UPDATE(is_read) ON TABLE public.notifications TO authenticated'));
  assert.equal(new Set(definitions.rowSecurity).size, definitions.tables.filter(table => table.name.startsWith('public.')).length,
    'every public table declares row level security');
  for (const name of DATABASE_SQL_FILES) assert.doesNotMatch(read(`database/${name}.sql`), /service_role|taibu_migrator|schema_migrations/u, name);
});

test('statements split outside comments, quoted text and dollar-quoted bodies', () => {
  const sql = [
    "-- header; not a statement",
    "CREATE FUNCTION a() RETURNS text AS $body$ SELECT 'x;y' ; $body$ LANGUAGE sql;",
    "/* outer /* nested; */ still comment; */ SELECT E'it\\'s;', \"weird;name\", $1;",
    "SELECT 'it''s'; ",
  ].join('\n');
  assert.deepEqual(splitStatements(sql).map(normalizeStatement), [
    "CREATE FUNCTION a() RETURNS text AS $body$ SELECT 'x;y' ; $body$ LANGUAGE sql",
    "SELECT E'it\\'s;', \"weird;name\", $1",
    "SELECT 'it''s'",
  ]);
  assert.throws(() => splitStatements('SELECT 1'), /without a semicolon/);
  assert.throws(() => splitStatements("SELECT 'open;"), /unterminated/);
  assert.equal(normalizeStatement("SELECT  'a    b'\n  FROM\tt -- tail\n;"), "SELECT 'a    b' FROM t");
});

test('db:init refuses SQL it cannot reconcile instead of ignoring it', () => {
  const sql = currentSql();
  const parse = (file, text) => () => parseDatabaseSql({ ...sql, [file]: `${sql[file]}\n${text}\n` });
  assert.throws(parse('access', 'REVOKE ALL ON TABLE public.users FROM anon;'), /database\/access\.sql: unsupported statement/);
  assert.throws(parse('access', 'DROP POLICY IF EXISTS x ON public.users;'), /unsupported statement/);
  assert.throws(parse('functions', "SET default_tablespace = '';"), /database\/functions\.sql: unsupported statement/);
  assert.throws(parse('triggers', 'DROP TRIGGER IF EXISTS x ON public.users;'), /unsupported statement/);
  assert.throws(parse('schema', 'CREATE INDEX x ON public.users (id);'), /database\/schema\.sql: unsupported statement/);
  assert.throws(parse('indexes', 'CREATE INDEX x ON public.users (id);'), /unsupported statement/);
  assert.throws(parse('access', sql.access.match(/^CREATE POLICY .*;$/mu)[0]), /duplicate policy declaration/);
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

test('offsite backups run after a missed minute, retry failures, and run once per day', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'taibu-backup-schedule-'));
  const script = (name, text) => { const file = path.join(directory, name); writeFileSync(file, text, { mode: 0o700 }); return file; };
  try {
    const backup = script('backup.sh', '#!/bin/sh\necho "$1" >> "$TEST_DIR/calls"\nif [ "$1" = offsite ] && [ ! -f "$TEST_DIR/failed" ]; then touch "$TEST_DIR/failed"; exit 1; fi\n');
    script('date', '#!/bin/sh\nn=$(cat "$TEST_DIR/tick" 2>/dev/null || echo 0)\ncase "$1" in +%F) if [ "$n" -ge 4 ]; then echo 2026-10-24; else echo 2026-10-23; fi;; +%H) case "$n" in 0) echo 02;; 1) echo 03;; 2) echo 04;; 3) echo 05;; *) echo 03;; esac;; +%s) echo $((n * 1000));; esac\n');
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
