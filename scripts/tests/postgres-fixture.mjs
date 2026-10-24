import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDatabaseSql } from '../db/current-sql.mjs';

// Contracts use the actual PostgreSQL definitions and roles. Test users replace
// the system seed so each suite controls its identities and administrator flags.
export async function buildPostgresFixture(root) {
  const sql = await readDatabaseSql(root);
  return [
    await readFile(path.join(root, 'database/bootstrap/00-roles.sql'), 'utf8'),
    'BEGIN; SET LOCAL ROLE taibu_owner; SET LOCAL search_path = public, extensions, pg_catalog; SET LOCAL check_function_bodies = false;',
    sql.schema, sql.functions, sql.triggers, sql.access,
    // Contract tests create synthetic identities with explicit IDs, not passwords.
    "ALTER TABLE identity.users ALTER COLUMN email SET DEFAULT gen_random_uuid()::text || '@fixture.test';",
    'COMMIT; SET ROLE taibu_owner; SET search_path = public, extensions, pg_catalog;',
    sql.indexes,
    'RESET ROLE;',
  ].join('\n\n');
}
