#!/usr/bin/env node
// Migration ledger management and execution
// Reads migration files from database/migrations/, maintains taibu_meta.schema_migrations ledger,
// and executes pending migrations.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATIONS_DIR = 'database/migrations';
const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Read all migration files from the migrations directory
 * @param {string} root - project root
 * @returns {Promise<Array<{version: string, name: string, filePath: string, content: string}>>}
 */
export async function readMigrationFiles(root) {
  const dir = path.join(root, MIGRATIONS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => MIGRATION_PATTERN.test(f)).sort();
  const migrations = [];

  for (const f of files) {
    const version = f.split('_')[0]; // e.g., "0001"
    const name = f.replace(/\.sql$/, '');
    const filePath = path.join(dir, f);
    const content = fs.readFileSync(filePath, 'utf8');
    migrations.push({ version, name, filePath, content });
  }

  return migrations;
}

/**
 * Calculate SHA256 checksum of file content
 * @param {string} content
 * @returns {string}
 */
export function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Ensure taibu_meta.schema_migrations exists. db:bootstrap normally creates it;
 * db:init also does so idempotently, because a database restored from a dump
 * taken before the ledger existed still has to be upgradable.
 * @param {pg.Client} client
 */
export async function ensureLedgerTable(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS taibu_meta;
    CREATE TABLE IF NOT EXISTS taibu_meta.schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now(),
      duration_ms INTEGER,
      baseline BOOLEAN DEFAULT FALSE
    );
    ALTER TABLE taibu_meta.schema_migrations OWNER TO taibu_owner;
  `);
}

/**
 * Read applied migrations from ledger
 * @param {pg.Client} client
 * @returns {Promise<Map<version, {version, name, checksum, applied_at, duration_ms, baseline}>>}
 */
export async function readAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, name, checksum, applied_at, duration_ms, baseline FROM taibu_meta.schema_migrations ORDER BY version'
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.version, row);
  }
  return map;
}

/**
 * Validate ledger: check for modified or deleted files
 * @param {Array} migrations - from readMigrationFiles
 * @param {Map} appliedMap - from readAppliedMigrations
 * @throws {Error} if ledger integrity is violated
 */
export function validateLedger(migrations, appliedMap) {
  const migrationsByVersion = new Map(migrations.map(m => [m.version, m]));

  for (const [version, applied] of appliedMap) {
    const current = migrationsByVersion.get(version);
    if (!current) {
      throw new Error(
        `Migration ${version} (${applied.name}) has been deleted. ` +
        'Run db:reconcile or restore the file. Ledger integrity check failed.'
      );
    }
    const currentChecksum = calculateChecksum(current.content);
    if (currentChecksum !== applied.checksum) {
      throw new Error(
        `Migration ${version} (${applied.name}) has been modified (checksum mismatch). ` +
        'Restore the file or add a new migration. Ledger integrity check failed.'
      );
    }
  }
}

/**
 * Find pending migrations
 * @param {Array} migrations
 * @param {Map} appliedMap
 * @returns {Array}
 */
export function findPendingMigrations(migrations, appliedMap) {
  return migrations.filter(m => !appliedMap.has(m.version));
}

/**
 * Record a migration as applied
 * @param {pg.Client} client
 * @param {string} version
 * @param {string} name
 * @param {string} checksum
 * @param {number} durationMs
 * @param {boolean} baseline - true if auto-baseline (structure already matched)
 */
export async function recordMigration(client, version, name, checksum, durationMs, baseline = false) {
  await client.query(
    `INSERT INTO taibu_meta.schema_migrations (version, name, checksum, applied_at, duration_ms, baseline)
     VALUES ($1, $2, $3, now(), $4, $5)`,
    [version, name, checksum, durationMs, baseline]
  );
}

/**
 * Execute a migration file. Ordinary files run in one transaction together
 * with their ledger row, so a failure leaves neither behind. Files headed by
 * `-- migrate:no-transaction` (index builds) run statement by statement and
 * record afterwards.
 * @param {pg.Client} client
 * @param {{version, name, content}} migration
 * @param {Object} options - { record?: () => Promise<void> } runs before commit
 * @returns {Promise<{success: boolean, duration_ms: number, error?: string}>}
 */
export async function executeMigration(client, migration, options = {}) {
  const start = Date.now();
  const shouldSkipTransaction = migration.content.trim().startsWith('-- migrate:no-transaction');

  try {
    if (shouldSkipTransaction) {
      const lines = migration.content.split('\n');
      let statement = '';
      for (const line of lines) {
        if (line.startsWith('-- migrate:no-transaction')) continue;
        statement += line + '\n';
        if (line.trim().endsWith(';')) {
          const query = statement.trim();
          if (query && !query.startsWith('--')) {
            await client.query(query);
          }
          statement = '';
        }
      }
      await options.record?.();
    } else {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '3s'");
        await client.query(migration.content);
        await options.record?.();
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    const duration = Date.now() - start;
    return { success: true, duration_ms: duration };
  } catch (error) {
    const duration = Date.now() - start;
    return { success: false, duration_ms: duration, error: error.message };
  }
}

/**
 * Run migrations: validate ledger, execute pending, record applied
 * @param {pg.Client} client
 * @param {string} root - project root
 * @param {Object} options - {log: (line) => void, checkOnly?: boolean}
 * @returns {Promise<{applied: number, plan: Array, errors?: Array}>}
 */
export async function runMigrations(client, root, options = {}) {
  const { log = console.log, checkOnly = false } = options;

  const migrations = await readMigrationFiles(root);
  let applied;
  if (checkOnly) {
    const { rows: [{ exists }] } = await client.query(
      "SELECT to_regclass('taibu_meta.schema_migrations') IS NOT NULL AS exists",
    );
    if (exists) {
      applied = await readAppliedMigrations(client);
    } else {
      applied = new Map();
      log('Migration ledger is missing; treating all migrations as pending without creating it');
    }
  } else {
    await ensureLedgerTable(client);
    applied = await readAppliedMigrations(client);
  }

  log(`Ledger: ${applied.size} migration(s) recorded`);

  // Validate existing ledger
  validateLedger(migrations, applied);
  log('Ledger validation passed');

  // Find pending
  const pending = findPendingMigrations(migrations, applied);
  log(`Pending: ${pending.length} migration(s) to apply`);

  if (checkOnly) {
    for (const m of pending) {
      log(`  - ${m.version} ${m.name}`);
    }
    return { applied: 0, plan: pending };
  }

  // Execute pending
  const executed = [];
  const errors = [];
  for (const m of pending) {
    log(`Applying ${m.version} ${m.name}...`);
    const checksum = calculateChecksum(m.content);
    const result = await executeMigration(client, m, {
      record: () => recordMigration(client, m.version, m.name, checksum, 0, false),
    });
    if (result.success) {
      log(`  ✓ ${m.version} ${m.name} (${result.duration_ms}ms)`);
      executed.push(m.version);
    } else {
      errors.push({ version: m.version, name: m.name, error: result.error });
      log(`  ✗ ${m.version} ${m.name}: ${result.error}`);
      break; // Stop on first error
    }
  }

  if (errors.length > 0) {
    throw new Error(`Migration failed: ${errors.map(e => `${e.version}: ${e.error}`).join('; ')}`);
  }

  return { applied: executed.length, plan: pending };
}

/**
 * Baseline: record all migrations as applied (used when structure already matches)
 * @param {pg.Client} client
 * @param {string} root - project root
 * @param {Object} options - {log: (line) => void}
 */
export async function baselineMigrations(client, root, options = {}) {
  const { log = console.log } = options;

  await ensureLedgerTable(client);
  const migrations = await readMigrationFiles(root);
  const applied = await readAppliedMigrations(client);

  if (applied.size > 0) {
    throw new Error('Cannot baseline: ledger is not empty');
  }

  log(`Baselining ${migrations.length} migration(s)...`);
  for (const m of migrations) {
    const checksum = calculateChecksum(m.content);
    await recordMigration(client, m.version, m.name, checksum, 0, true);
    log(`  • ${m.version} ${m.name}`);
  }
  log(`Baseline complete: all migrations marked as applied (baseline=true)`);
}
