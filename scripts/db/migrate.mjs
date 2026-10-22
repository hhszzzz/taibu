#!/usr/bin/env node
// Forward-only migration runner. Uses taibu_meta.schema_migrations with sha256
// checksums; refuses to run when an applied file changed. A file whose first
// line contains "-- migrate:no-transaction" runs through psql statement by
// statement (needed for CREATE INDEX CONCURRENTLY).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(root, 'database/migrations');
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const dsn = process.env.MIGRATOR_DATABASE_URL;
if (!dsn) {
  console.error('[db:migrate] MIGRATOR_DATABASE_URL is required');
  process.exit(1);
}

function listFiles() {
  const files = readdirSync(migrationsDir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort();
  for (const file of readdirSync(migrationsDir)) {
    if (file.endsWith('.sql') && !FILE_PATTERN.test(file)) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
  }
  return files.map((file) => {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const match = FILE_PATTERN.exec(file);
    return {
      file,
      version: match[1],
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
      noTransaction: /^--\s*migrate:no-transaction/m.test(sql),
    };
  });
}

function psqlEnvironment() {
  const url = new URL(dsn);
  return {
    ...process.env,
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function runWithoutTransaction(migration) {
  // SET ROLE first: taibu_migrator itself owns nothing.
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: `SET ROLE taibu_owner;\nSET search_path = public, extensions, pg_catalog;\n${migration.sql}`,
    env: psqlEnvironment(),
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`psql is required for ${migration.file}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`psql failed for ${migration.file}:\n${result.stderr}`);
}

const mode = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? 'up';
const dryRun = process.argv.includes('--dry-run');
const migrations = listFiles();

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
  await client.query('SET ROLE taibu_owner');
  await client.query('CREATE SCHEMA IF NOT EXISTS taibu_meta');
  await client.query(`CREATE TABLE IF NOT EXISTS taibu_meta.schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    duration_ms integer NOT NULL
  )`);

  const { rows: appliedRows } = await client.query(
    'select version, name, checksum, applied_at, duration_ms from taibu_meta.schema_migrations order by version',
  );
  const applied = new Map(appliedRows.map((row) => [row.version, row]));

  for (const migration of migrations) {
    const record = applied.get(migration.version);
    if (record && record.checksum !== migration.checksum) {
      throw new Error(
        `Checksum mismatch for ${migration.file}: applied ${record.checksum}, current ${migration.checksum}`,
      );
    }
  }
  for (const [version, record] of applied) {
    if (!migrations.some((migration) => migration.version === version)) {
      throw new Error(`Applied migration ${version}_${record.name} is missing from database/migrations`);
    }
  }

  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (mode === 'status') {
    console.table(appliedRows.map((row) => ({
      version: row.version,
      name: row.name,
      appliedAt: row.applied_at.toISOString(),
      durationMs: row.duration_ms,
    })));
    console.log(`[db:migrate] ${pending.length} pending`);
    for (const migration of pending) console.log(`  pending ${migration.file}`);
  } else if (mode === 'up') {
    if (pending.length === 0) console.log('[db:migrate] already up to date');
    if (dryRun) {
      for (const migration of pending) console.log(`  would apply ${migration.file}`);
    } else {
      await client.query(`select pg_advisory_lock(hashtext('taibu:migrate'))`);
      try {
        for (const migration of pending) {
          const started = Date.now();
          if (migration.noTransaction) {
            runWithoutTransaction(migration);
            await client.query(
              'insert into taibu_meta.schema_migrations (version, name, checksum, duration_ms) values ($1, $2, $3, $4)',
              [migration.version, migration.name, migration.checksum, Date.now() - started],
            );
          } else {
            await client.query('BEGIN');
            try {
              await client.query('SET LOCAL ROLE taibu_owner');
              await client.query('SET LOCAL search_path = public, extensions, pg_catalog');
              await client.query(migration.sql);
              await client.query(
                'insert into taibu_meta.schema_migrations (version, name, checksum, duration_ms) values ($1, $2, $3, $4)',
                [migration.version, migration.name, migration.checksum, Date.now() - started],
              );
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            }
          }
          console.log(`[db:migrate] applied ${migration.file} in ${Date.now() - started}ms`);
        }
      } finally {
        await client.query(`select pg_advisory_unlock(hashtext('taibu:migrate'))`);
      }
    }
  } else {
    throw new Error(`Unknown mode ${mode}; expected up or status`);
  }
} finally {
  await client.end();
}
