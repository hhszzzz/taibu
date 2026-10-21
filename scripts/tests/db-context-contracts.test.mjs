import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPostgresFixture } from './postgres-fixture.mjs';

// Real PostgreSQL contract for src/lib/db: transaction-local role/claims,
// pool isolation, timeouts, RPC shaping and the fail-closed app role.
// Run: node --require ./scripts/ts-register.cjs --test scripts/tests/db-context-contracts.test.mjs
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const image = 'pgvector/pgvector:0.8.6-pg16';
const runLabel = 'io.taibu.db-context.run';
const ids = {
  owner: '00000000-0000-4000-8000-000000000001',
  other: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
};
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function docker(args, { input = '', timeout = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) reject(new Error(`docker ${args[0]} failed: ${stderr.trim() || error.code || error.message}`));
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
  assert.ok(endpoint.startsWith('unix://'), 'Contract tests require a local Unix-socket Docker endpoint; remote Docker is forbidden');
  await docker(['version', '--format', '{{.Server.Version}}']);
}

test('scoped database contexts isolate identity and fail closed', { timeout: 300_000 }, async (t) => {
  await assertLocalDocker();
  const fixture = await buildPostgresFixture(repoRoot);
  const runId = randomUUID();
  const containerName = `taibu-db-context-${runId}`;
  const postgresPassword = randomBytes(32).toString('hex');
  const appPassword = randomBytes(32).toString('hex');
  let containerId;
  let closeDb;

  const creation = docker([
    'create', '--name', containerName, '--label', `${runLabel}=${runId}`,
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '-p', '127.0.0.1::5432',
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=taibu_contracts',
    image, 'postgres',
  ], { timeout: 180_000, env: { ...process.env, POSTGRES_PASSWORD: postgresPassword } });

  const cleanup = async () => {
    if (!containerId) return;
    try {
      const label = await docker(['inspect', '--format', `{{ index .Config.Labels "${runLabel}" }}`, containerId]);
      assert.equal(label, runId, 'Refusing to remove a container not owned by this test run');
      await docker(['rm', '--force', '--volumes', containerId]);
    } catch (error) {
      if (!/No such (object|container)/i.test(error.message)) throw error;
    }
  };

  try {
    containerId = await creation;
    await docker(['start', containerId]);

    let ready = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        await docker(['exec', containerId, 'sh', '-c', 'read -r name < /proc/1/comm; test "$name" = postgres'], { timeout: 2_000 });
        await docker(['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', 'taibu_contracts'], { timeout: 2_000 });
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    assert.ok(ready, 'Owned PostgreSQL container did not become ready within 30 seconds');

    const sql = (statement) => docker([
      'exec', '-i', containerId, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
      '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu_contracts',
    ], { input: statement });

    await sql(fixture);
    await sql(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taibu_app') THEN
    CREATE ROLE taibu_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE taibu_app LOGIN PASSWORD ${quote(appPassword)};
GRANT anon, authenticated TO taibu_app WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public, extensions TO taibu_app;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
INSERT INTO auth.users(id, email) VALUES
  (${quote(ids.owner)}, 'owner@fixture.test'),
  (${quote(ids.other)}, 'other@fixture.test'),
  (${quote(ids.admin)}, 'admin@fixture.test');
SET ROLE taibu_contract_owner;
UPDATE public.users SET is_admin = (id = ${quote(ids.admin)}::uuid);
RESET ROLE;`);

    const mapping = await docker(['port', containerId, '5432/tcp']);
    const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1));
    assert.ok(port > 0, 'Published PostgreSQL port was not resolved');

    process.env.DATABASE_URL = `postgres://taibu_app:${encodeURIComponent(appPassword)}@127.0.0.1:${port}/taibu_contracts`;
    process.env.SYSTEM_USER_ID = ids.admin;
    process.env.DB_POOL_MAX = '2';
    process.env.NODE_ENV = 'test';

    const { userDb, anonDb, systemDb } = require('../../src/lib/db/context.server.ts');
    const { getPool, closeDb: closePool } = require('../../src/lib/db/pool.server.ts');
    closeDb = closePool;
    const { sql: kyselySql } = require('kysely');

    await t.test('application role fails closed without a transaction context', async () => {
      await assert.rejects(
        getPool().query('select * from public.users'),
        (error) => error.code === '42501',
      );
    });

    await t.test('each identity only sees its own rows through the pool', async () => {
      await Promise.all(Array.from({ length: 100 }, (_, index) => {
        const userId = index % 2 === 0 ? ids.owner : ids.other;
        return userDb(userId).tx(async (trx) => {
          const rows = await trx.selectFrom('users').select(['id']).execute();
          assert.deepEqual(rows, [{ id: userId }]);
        });
      }));
    });

    await t.test('transaction context resets before the connection is reused', async () => {
      await userDb(ids.owner).tx(async (trx) => {
        assert.equal(await trx.selectFrom('users').select('id').executeTakeFirstOrThrow().then((row) => row.id), ids.owner);
      });
      await assert.rejects(
        getPool().query('select * from public.users'),
        (error) => error.code === '42501',
      );
    });

    await t.test('statement timeout aborts only that transaction', async () => {
      await assert.rejects(
        userDb(ids.owner).tx(async (trx) => {
          await kyselySql`select pg_sleep(0.3)`.execute(trx);
        }, { timeoutMs: 50 }),
        (error) => error.code === '57014',
      );
      const rows = await userDb(ids.owner).tx((trx) => trx.selectFrom('users').select('id').execute());
      assert.deepEqual(rows, [{ id: ids.owner }]);
    });

    await t.test('anon scope carries the anon role and no subject', async () => {
      const state = await anonDb().tx(async (trx) => {
        const result = await kyselySql`select current_setting('role') as role,
                                               current_setting('request.jwt.claims') as claims`.execute(trx);
        return result.rows[0];
      });
      assert.equal(state.role, 'anon');
      assert.deepEqual(JSON.parse(state.claims), { role: 'anon' });
    });

    await t.test('system scope resolves the administrator and shapes RPC results', async () => {
      assert.equal(await systemDb().rpc('is_admin_user', {}), true);
      assert.equal(await userDb(ids.owner).rpc('is_admin_user', {}), false);
      const conversationId = await userDb(ids.owner).rpc('create_conversation_with_messages', {
        p_user_id: ids.owner,
        p_title: 'db context probe',
        p_source_data: { source: 'probe' },
        p_messages: [],
      });
      assert.match(conversationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    });
  } finally {
    try {
      await closeDb?.();
    } catch {
      // The pool is already gone when the container vanished first.
    }
    await cleanup();
  }
});
