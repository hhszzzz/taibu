#!/usr/bin/env node
// Applies the current PostgreSQL definitions in database/. No numbered
// migrations or ledger: reconcile.mjs compares every definition with the live
// catalog and applies only the differences.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { readDatabaseDefinitions } from './current-sql.mjs';
import { reconcileDatabase } from './reconcile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dsn = process.env.SCHEMA_DATABASE_URL;
if (!dsn) throw new Error('SCHEMA_DATABASE_URL is required for db:init');
const definitions = await readDatabaseDefinitions(root);
const client = new pg.Client({ connectionString: dsn, application_name: 'taibu-db-init' });
await client.connect();
try {
  await client.query('SET ROLE taibu_owner');
  // pg_dump's convention: deparsed names come back schema-qualified, as in the files.
  await client.query("SET search_path = ''");
  while (!(await client.query("select pg_try_advisory_lock(hashtext('taibu:database')) as locked")).rows[0].locked) {
    await delay(250);
  }
  const log = (line) => console.log(`[db:init] ${line}`);
  const { empty, summary } = await reconcileDatabase(client, definitions, { log });
  log(`${empty ? 'initialized' : 'refreshed'} current SQL definitions (${summary}); application data kept, seed invariants reapplied`);
} finally {
  await client.end();
}
