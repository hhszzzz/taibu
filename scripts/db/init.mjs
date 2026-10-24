#!/usr/bin/env node
// Apply the current PostgreSQL definitions. No numbered migrations or ledger.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { execute } from '../selfhost.mjs';
import { libpqEnvironment } from './connection-env.mjs';
import { repairConcurrentIndexes } from './concurrent-indexes.mjs';
import { inspectDatabase, readDatabaseSql } from './current-sql.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Keep the existing private DDL connection configuration usable during adoption.
const dsn = process.env.SCHEMA_DATABASE_URL || process.env.MIGRATOR_DATABASE_URL;
if (!dsn) throw new Error('SCHEMA_DATABASE_URL is required for db:init');
const definition = await readDatabaseSql(root);
const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
  await client.query('SET ROLE taibu_owner');
  while (!(await client.query("select pg_try_advisory_lock(hashtext('taibu:database')) as locked")).rows[0].locked) {
    await delay(250);
  }
  const state = await inspectDatabase(client, definition);
  if (state.missing.length) {
    throw new Error(`Existing database is missing ${state.missing.join(', ')}. Apply the explicit table/column SQL before running db:init; existing data will not be reset.`);
  }
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path = public, extensions, pg_catalog');
    await client.query('SET LOCAL check_function_bodies = false');
    if (state.empty) await client.query(definition.schema);
    for (const name of ['functions', 'triggers', 'access', 'seed']) await client.query(definition[name]);
    // Retire only the old deployment bookkeeping, never application tables.
    await client.query('DROP TABLE IF EXISTS taibu_meta.schema_migrations');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  await repairConcurrentIndexes(client, definition.indexes);
  await execute('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: libpqEnvironment(dsn),
    timeout: 1_800_000,
    input: `SET ROLE taibu_owner; SET search_path = public, extensions, pg_catalog;\n${definition.indexes}`,
  });
  console.log(`[db:init] ${state.empty ? 'initialized' : 'refreshed'} current SQL definitions; application data retained`);
} finally {
  await client.end();
}
