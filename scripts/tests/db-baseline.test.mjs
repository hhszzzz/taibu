// Replays the real bootstrap + migrations into a disposable PostgreSQL 17
// container and asserts the baseline invariants that the application relies on.
// Run: node --test scripts/tests/db-baseline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const image = 'pgvector/pgvector:0.8.7-pg17-bookworm';
const runLabel = 'io.taibu.db-baseline.run';
const database = 'taibu_baseline';

function docker(args, { input = '', timeout = 60_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`docker ${args[0]} failed: ${(stderr || error.message).trim()}`));
        else resolve(stdout.trim());
      });
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') reject(error); });
    child.stdin.end(input);
  });
}

async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(endpoint.startsWith('unix://'), 'these tests require a local Unix-socket Docker endpoint');
  await docker(['version', '--format', '{{.Server.Version}}']);
}

test('bootstrap and migrations produce the live schema invariants', { timeout: 300_000 }, async (t) => {
  await assertLocalDocker();
  const runId = randomUUID();
  const containerName = `taibu-baseline-${runId}`;
  const postgresPassword = randomBytes(32).toString('hex');
  const appPassword = randomBytes(32).toString('hex');
  let containerId;

  const cleanup = async () => {
    if (!containerId) return;
    const label = await docker(['inspect', '--format', `{{ index .Config.Labels "${runLabel}" }}`, containerId]).catch(() => '');
    if (label !== runId) return;
    await docker(['rm', '--force', '--volumes', containerId]).catch(() => {});
  };

  try {
    containerId = await docker([
      'create', '--name', containerName, '--label', `${runLabel}=${runId}`,
      '--tmpfs', '/var/lib/postgresql/data:rw',
      '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${database}`,
      image, 'postgres',
    ], { env: { ...process.env, POSTGRES_PASSWORD: postgresPassword } });
    await docker(['start', containerId]);

    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await docker(['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', database], { timeout: 3_000 });
        ready = true;
        break;
      } catch { await delay(500); }
    }
    assert.ok(ready, 'PostgreSQL container did not become ready');
    // initdb starts a temporary server; pg_isready can succeed before the final
    // server accepts connections, so prove it with a real query.
    let accepting = false;
    while (Date.now() < deadline) {
      try {
        await docker(['exec', containerId, 'psql', '-X', '-q', '-U', 'postgres', '-d', database, '-c', 'select 1'], { timeout: 3_000 });
        accepting = true;
        break;
      } catch { await delay(500); }
    }
    assert.ok(accepting, 'PostgreSQL did not accept queries after initdb');

    const sql = (statement) => docker([
      'exec', '-i', containerId, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
      '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database,
    ], { input: statement });

    const bootstrap = await readFile(path.join(repoRoot, 'database/bootstrap/00-roles.sql'), 'utf8');
    await sql(`${bootstrap}
ALTER DATABASE ${database} SET timezone = 'UTC';
REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
GRANT CREATE, CONNECT ON DATABASE ${database} TO taibu_owner;
GRANT CONNECT ON DATABASE ${database} TO taibu_migrator, taibu_app, taibu_auth, taibu_backup;
ALTER ROLE taibu_app PASSWORD '${appPassword}';`);

    const migrations = [];
    for (const file of ['0001_identity.sql', '0002_app_baseline.sql', '0003_identity_profile_and_system_user.sql']) {
      migrations.push(`-- ${file}\n${await readFile(path.join(repoRoot, 'database/migrations', file), 'utf8')}`);
    }
    await sql(`SET ROLE taibu_owner;\nSET check_function_bodies = false;\n${migrations.join('\n')}`);

    await t.test('legacy auth and rate-limit objects are gone', async () => {
      assert.equal(await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('login_attempts', 'rate_limits');`), '0');
      assert.equal(await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relname = 'users' and c.relkind = 'r';`), '0');
      assert.equal(await sql(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('handle_auth_user_profile_sync','check_login_attempts','record_login_attempt','consume_rate_limit_slot_as_admin');`), '0');
    });

    await t.test('foreign keys point at public.users and identity.users only', async () => {
      const rows = (await sql(`
        select confrelid::regclass::text || '|' || conname || '|' || confdeltype::text
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public'
          and confrelid in ('identity.users'::regclass);`)).split('\n').filter(Boolean);
      assert.deepEqual(rows, ['identity.users|users_id_fkey|c']);
      const userFks = await sql(`
        select count(*) from pg_constraint c
        join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public' and confrelid = 'public.users'::regclass;`);
      assert.ok(Number(userFks) >= 32, `expected at least 32 public.users foreign keys, got ${userFks}`);
    });

    await t.test('identity trigger seeds public.users and the system user is admin', async () => {
      await sql(`insert into identity.users (id, email, email_verified, name)
        values ('00000000-0000-4000-8000-0000000000aa', 'trigger@fixture.test', true, '触发器用户');`);
      assert.equal(await sql(`select nickname from public.users where id = '00000000-0000-4000-8000-0000000000aa';`), '触发器用户');
      assert.equal(await sql(`select is_admin from public.users where id = '00000000-0000-4000-8000-000000000001';`), 't');
    });

    await t.test('RLS is enabled on every public table', async () => {
      const unprotected = await sql(`
        select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`);
      assert.equal(unprotected, '0');
    });

    await t.test('the application role fails closed without a scoped transaction', async () => {
      const psqlAsApp = (statement) => docker([
        'exec', '-e', `PGPASSWORD=${appPassword}`, '-i', containerId,
        'psql', '-X', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
        '-h', '127.0.0.1', '-U', 'taibu_app', '-d', database,
      ], { input: statement });

      await assert.rejects(psqlAsApp('select count(*) from public.users;'), /permission denied|denied/u);

      const visible = await psqlAsApp(`
        begin;
        select set_config('role', 'authenticated', true),
               set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
        select count(*) from public.users where id = '00000000-0000-4000-8000-0000000000aa';
        commit;`);
      assert.ok(visible.split('\n').includes('1'), visible);
    });
  } finally {
    await cleanup();
  }
});
