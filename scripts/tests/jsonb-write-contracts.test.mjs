import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPostgresFixture } from './postgres-fixture.mjs';

// Real PostgreSQL contracts for the three JSONB write paths that regressed:
// node-postgres encodes a JS array as a PostgreSQL array literal, so every
// array bound to a jsonb column must first go through json().
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const image = 'pgvector/pgvector:0.8.7-pg17-bookworm';
const runLabel = 'io.taibu.jsonb-write-contracts.run';
const userId = '00000000-0000-4000-8000-000000000901';

function docker(args, { input = '', timeout = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`docker ${args[0]} failed: ${stderr.trim() || error.code || error.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(endpoint.startsWith('unix://'), 'Contract tests require a local Unix-socket Docker endpoint; remote Docker is forbidden');
  try {
    await docker(['version', '--format', '{{.Server.Version}}']);
  } catch (error) {
    throw new Error(`Local Docker is required and must already be running; this test cannot be skipped. ${error.message}`);
  }
}

test('jsonb write paths accept arrays from the real route payloads', { timeout: 300_000 }, async t => {
  await assertLocalDocker();

  const runId = randomUUID();
  const containerName = `taibu-jsonb-contracts-${runId}`;
  const password = randomBytes(32).toString('hex');
  let client = null;
  let closeDb = null;
  t.after(async () => {
    try {
      await closeDb?.();
    } catch {
      // The pool may already be closed after an early failure.
    }
    try {
      await client?.end();
    } catch {
      // The database may already be gone.
    }
    try {
      await docker(['rm', '--force', '--volumes', containerName]);
    } catch {
      // A failed create leaves nothing to remove.
    }
  });

  await docker([
    'create', '--name', containerName, '--label', `${runLabel}=${runId}`,
    '-p', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=taibu_contracts',
    image, 'postgres', '-c', 'listen_addresses=*',
  ], { timeout: 180_000, env: { ...process.env, POSTGRES_PASSWORD: password } });
  await docker(['start', containerName]);

  let ready = false;
  const readinessDeadline = Date.now() + 30_000;
  while (Date.now() < readinessDeadline) {
    try {
      await docker(['exec', containerName, 'sh', '-c', 'read -r name < /proc/1/comm; test "$name" = postgres'], { timeout: 2_000 });
      await docker(['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'taibu_contracts'], { timeout: 2_000 });
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(ready, 'Owned PostgreSQL container did not become ready within 30 seconds');

  const mapping = await docker(['port', containerName, '5432/tcp']);
  const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1));
  assert.ok(Number.isInteger(port) && port > 0, `Docker did not publish a PostgreSQL port: ${mapping}`);
  const connectionString = `postgres://postgres:${password}@127.0.0.1:${port}/taibu_contracts`;

  // The fixture contains CREATE INDEX CONCURRENTLY, which psql can run
  // statement-by-statement but a single pg query would wrap in a transaction.
  const sql = statement => docker([
    'exec', '-i', containerName, 'psql', '-X', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu_contracts',
  ], { input: statement, timeout: 120_000 });
  await sql(await buildPostgresFixture(repoRoot));

  const { Client } = require('pg');
  client = new Client({ connectionString });
  await client.connect();
  await client.query('INSERT INTO identity.users (id) VALUES ($1)', [userId]);

  process.env.DATABASE_URL = connectionString;
  process.env.DB_POOL_MAX = '4';
  const { userDb } = require('../../src/lib/db/context.server.ts');
  closeDb = require('../../src/lib/db/pool.server.ts').closeDb;
  const apiUtils = require('../../src/lib/api-utils.ts');
  const { NextRequest } = require('next/server');
  const { PATCH: patchSettings } = require('../../src/app/api/user/settings/route.ts');
  const { POST: postTarot } = require('../../src/app/api/tarot/route.ts');
  const { POST: postLiuyao } = require('../../src/app/api/liuyao/route.ts');

  t.mock.method(apiUtils, 'requireUserContext', async () => ({
    user: { id: userId },
    db: userDb(userId),
  }));

  const request = (pathname, method, body) => new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const settingsResponse = await patchSettings(request('/api/user/settings', 'PATCH', {
    promptKbIds: ['kb-1', 'kb-2'],
  }));
  assert.equal(settingsResponse.status, 200, await settingsResponse.text());
  const settings = await client.query('SELECT prompt_kb_ids FROM public.user_settings WHERE user_id = $1', [userId]);
  assert.deepEqual(settings.rows[0]?.prompt_kb_ids, ['kb-1', 'kb-2']);

  const cards = [{
    card: { nameChinese: '测试牌', keywords: ['关键词'], uprightMeaning: '正位', reversedMeaning: '逆位' },
    orientation: 'upright',
  }];
  const tarotResponse = await postTarot(request('/api/tarot', 'POST', {
    action: 'save', spreadId: 'single', question: '今天如何', cards,
  }));
  assert.equal(tarotResponse.status, 200, await tarotResponse.text());
  const tarot = await client.query(
    'SELECT cards FROM public.tarot_readings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  assert.deepEqual(tarot.rows[0]?.cards, cards);

  const yaos = Array.from({ length: 6 }, (_, index) => ({ type: 1, change: 'stable', position: index + 1 }));
  const liuyaoResponse = await postLiuyao(request('/api/liuyao', 'POST', {
    action: 'save', question: '测试问题', yongShenTargets: ['官鬼'], yaos, changedLines: [3],
  }));
  assert.equal(liuyaoResponse.status, 200, await liuyaoResponse.text());
  const liuyao = await client.query(
    'SELECT changed_lines, yongshen_targets FROM public.liuyao_divinations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  assert.deepEqual(liuyao.rows[0]?.changed_lines, [3]);
  assert.deepEqual(liuyao.rows[0]?.yongshen_targets, ['官鬼']);
});
