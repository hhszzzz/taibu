#!/usr/bin/env node
// Applies the current PostgreSQL definitions in database/.
// Flow with the migration ledger:
// 1. Empty database: schema.sql creates everything, then every migration is baselined.
// 2. Existing database: run pending migrations (removals, type changes, backfills),
//    then auto-complete missing tables/columns/constraints from schema.sql,
//    then reconcile functions, views, policies, triggers, privileges and indexes.
// --check prints the plan without writing anything.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { readDatabaseDefinitions } from './current-sql.mjs';
import { reconcileDatabase } from './reconcile.mjs';
import { runMigrations, baselineMigrations, readMigrationFiles } from './migrations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dsn = process.env.SCHEMA_DATABASE_URL;
const checkOnly = process.argv.includes('--check');

if (!dsn) throw new Error('SCHEMA_DATABASE_URL is required for db:init');

const definitions = await readDatabaseDefinitions(root);
const client = new pg.Client({ connectionString: dsn, application_name: 'taibu-db-init' });
await client.connect();

try {
  await client.query('SET ROLE taibu_owner');
  await client.query("SET search_path = ''");

  while (!(await client.query("select pg_try_advisory_lock(hashtext('taibu:database')) as locked")).rows[0].locked) {
    await delay(250);
  }

  const log = (line) => console.log(`[db:init] ${line}`);

  // A brand-new database has nothing to migrate: schema.sql creates everything
  // and every migration is recorded as a baseline afterwards.
  const { rows: [{ count }] } = await client.query(
    "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  );
  const freshDatabase = count === 0;

  // Step 1: Run migrations
  log('Step 1: Running migrations...');
  let pending = 0;
  if (freshDatabase) {
    const migrations = await readMigrationFiles(root);
    log(`Fresh database: ${migrations.length} migration(s) will be baselined after creating the schema`);
  } else {
    const migrResult = await runMigrations(client, root, { log, checkOnly });
    if (checkOnly) {
      pending = migrResult.plan.length;
      log(`Would apply ${migrResult.plan.length} migration(s)`);
      for (const m of migrResult.plan) {
        log(`  - ${m.version} ${m.name}`);
      }
    } else if (migrResult.applied > 0) {
      log(`Applied ${migrResult.applied} migration(s)`);
    } else {
      log('No pending migrations');
    }
  }

  // Step 2: Reconcile main database objects
  log('Step 2: Reconciling database objects...');
  if (checkOnly && pending) {
    // Completion compares against the migrated tables, which only exist once the migrations run.
    log('(check-only mode) planned after the pending migrations; rehearse db:init on a restored copy to see it');
  } else if (checkOnly) {
    const { summary } = await reconcileDatabase(client, definitions, { log, checkOnly: true });
    log(`(check-only mode) ${summary}`);
  } else {
    const { empty, summary } = await reconcileDatabase(client, definitions, { log });
    if (empty) {
      // After creating tables in reconcile, baseline the migrations
      log('Database initialized; establishing migration baseline...');
      const migrations = await readMigrationFiles(root);
      if (migrations.length > 0) {
        await baselineMigrations(client, root, { log });
      }
    }
    log(`${empty ? 'initialized' : 'refreshed'} current SQL definitions (${summary}); application data kept, seed invariants reapplied`);
  }

  log('Done');
} finally {
  await client.end();
}

