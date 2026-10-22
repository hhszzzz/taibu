import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSchemaDump } from '../db/normalize-schema.mjs';

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
