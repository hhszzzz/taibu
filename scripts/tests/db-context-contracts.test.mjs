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
const image = 'pgvector/pgvector:0.8.7-pg17-bookworm';
const runLabel = 'io.taibu.db-context.run';
const ids = {
  owner: '00000000-0000-4000-8000-000000000002',
  other: '00000000-0000-4000-8000-000000000003',
  admin: '00000000-0000-4000-8000-000000000001',
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
INSERT INTO identity.users(id, email) VALUES
  (${quote(ids.owner)}, 'owner@fixture.test'),
  (${quote(ids.other)}, 'other@fixture.test'),
  (${quote(ids.admin)}, 'admin@fixture.test');
SET ROLE taibu_owner;
UPDATE public.users SET is_admin = (id = ${quote(ids.admin)}::uuid);
RESET ROLE;`);

    const mapping = await docker(['port', containerId, '5432/tcp']);
    const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1));
    assert.ok(port > 0, 'Published PostgreSQL port was not resolved');

    process.env.DATABASE_URL = `postgres://taibu_app:${encodeURIComponent(appPassword)}@127.0.0.1:${port}/taibu_contracts`;
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

    await t.test('records route executes any-tag matching with owner isolation in a repeatable snapshot', async () => {
      await sql(`insert into public.ming_records (user_id, title, content, tags) values
        (${quote(ids.owner)}, '甲记录', '内容', ARRAY['甲']),
        (${quote(ids.owner)}, '乙记录', '内容', ARRAY['乙']),
        (${quote(ids.other)}, '其他账号记录', '内容', ARRAY['甲']);`);
      const api = require('../../src/lib/api-utils.ts');
      const { NextRequest } = require('next/server');
      const scoped = userDb(ids.owner);
      const auth = t.mock.method(api, 'requireUserContext', async () => ({ user: { id: ids.owner }, db: scoped }));
      try {
        const { GET } = require('../../src/app/api/records/route.ts');
        const response = await GET(new NextRequest('http://localhost/api/records?tag=甲&tag=乙'));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.total, 2);
        assert.deepEqual(result.records.map(row => row.title).sort(), ['乙记录', '甲记录']);
        const isolation = await scoped.tx(async trx => (await kyselySql`show transaction_isolation`.execute(trx)).rows[0].transaction_isolation,
          { isolationLevel: 'repeatable read' });
        assert.equal(isolation, 'repeatable read');
      } finally { auth.mock.restore(); }
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

    await t.test('run metrics store their phase timeline through the application path', async () => {
      const conversation = randomUUID();
      const run = randomUUID();
      const checkpoint = { version: 2, durable: { engine: 'pi-durable/1.4.0' }, messages: [], parts: [] };
      await sql(`insert into public.conversations (id, user_id, title) values
          (${quote(conversation)}, ${quote(ids.owner)}, 'metrics probe');
        insert into public.agent_runs (id, user_id, conversation_id, request_id, request_hash, input, checkpoint, public_message, billing, status) values
          (${quote(run)}, ${quote(ids.owner)}, ${quote(conversation)}, 'metrics-probe', 'metrics-hash', '{}'::jsonb,
           ${quote(JSON.stringify(checkpoint))}::jsonb, '{}'::jsonb, 'exempt', 'completed');`);
      const { AgentStore } = require('../../src/lib/agent/store.server.ts');
      // pg encodes a JS array as a PostgreSQL array literal: an untagged phases array would fail the jsonb insert.
      const phases = [
        { name: 'pi.durable.phase', task: 'pi.generation', phase: 'request', status: 'ok', startMs: 0, durationMs: 1200 },
        { name: 'pi.durable.submit', submissionType: 'input', result: 'done', status: 'ok', startMs: 0, durationMs: 5 },
      ];
      const endedAt = Date.now();
      await new AgentStore(systemDb()).recordRunMetrics({
        runId: run, modelId: 'fixture-model', status: 'completed', queuedMs: 10, totalMs: 2000, firstTokenMs: 800,
        generationCount: 1, generationMs: 1200, toolCount: 2, toolMs: 300, compactionCount: 0, compactionMs: 0,
        retries: 1, faults: 0, hangs: 0, inputTokens: 100, outputTokens: 40, cacheReadTokens: 60, cacheWriteTokens: 0,
        totalTokens: 200, phases, startedAt: new Date(endedAt - 2000).toISOString(), endedAt: new Date(endedAt).toISOString(),
      });
      const stored = await systemDb().tx((trx) => trx.selectFrom('agent_run_metrics')
        .select(['status', 'tool_count', 'total_ms', 'phases'])
        .where('run_id', '=', run).executeTakeFirstOrThrow());
      assert.equal(stored.status, 'completed');
      assert.equal(stored.tool_count, 2);
      assert.equal(stored.total_ms, 2000);
      assert.deepEqual(stored.phases, phases);
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
