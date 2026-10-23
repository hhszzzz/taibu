#!/usr/bin/env node
// Applies database/bootstrap/*.sql and sets role passwords from the environment.
// Idempotent: safe to run before every deploy. Requires a superuser DSN.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrapDir = path.join(root, 'database/bootstrap');

const dsn = process.env.ADMIN_DATABASE_URL;
if (!dsn) {
  console.error('[db:bootstrap] ADMIN_DATABASE_URL is required');
  process.exit(1);
}

const url = new URL(dsn);
const databaseName = process.env.TAIBU_DB_NAME || decodeURIComponent(url.pathname.slice(1)) || 'taibu';
const noPasswords = process.argv.includes('--no-passwords');

const ROLE_PASSWORDS = [
  ['taibu_migrator', 'TAIBU_MIGRATOR_PASSWORD'],
  ['taibu_app', 'TAIBU_APP_PASSWORD'],
  ['taibu_auth', 'TAIBU_AUTH_PASSWORD'],
  ['taibu_backup', 'TAIBU_BACKUP_PASSWORD'],
];
if (!noPasswords) {
  for (const [role, variable] of ROLE_PASSWORDS) {
    if (!process.env[variable]) throw new Error(`${variable} is required to bootstrap role ${role}`);
  }
}

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

const client = new pg.Client({ connectionString: dsn });
await client.connect();
try {
  await client.query('BEGIN');
  const files = readdirSync(bootstrapDir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(bootstrapDir, file), 'utf8');
    await client.query(sql);
    console.log(`[db:bootstrap] applied ${file}`);
  }

  const database = quoteIdent(databaseName);
  await client.query(`ALTER DATABASE ${database} SET timezone = 'UTC'`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  // taibu_owner creates schemas inside the database; everything else only connects.
  await client.query(`GRANT CREATE, CONNECT ON DATABASE ${database} TO taibu_owner`);
  await client.query(
    `GRANT CONNECT ON DATABASE ${database} TO taibu_migrator, taibu_app, taibu_auth, taibu_backup`,
  );

  if (!noPasswords) {
    for (const [role, variable] of ROLE_PASSWORDS) {
      const password = process.env[variable];
      const { rows } = await client.query('select format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text) as sql', [role, password]);
      await client.query(rows[0].sql);
      console.log(`[db:bootstrap] set password for ${role}`);
    }
  }
  await client.query('COMMIT');
  console.log(`[db:bootstrap] database ${databaseName} ready`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
