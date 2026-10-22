import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Redis = require('ioredis');
const { createRedisRateLimiter, REDIS_RATE_LIMIT_OPTIONS } = require('../../src/lib/rate-limit-redis.ts');
const execute = promisify(execFile);

async function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : (await execute('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  assert.ok(endpoint.startsWith('unix://'), 'Redis contracts require a local Unix-socket Docker endpoint');
  await execute('docker', ['version', '--format', '{{.Server.Version}}']);
}

// Explicit integration entrypoint; no production URL or existing Redis data is used.
test('real Redis shares atomic admission across independent application clients', { timeout: 60_000 }, async t => {
  await assertLocalDocker();
  const name = `taibu-redis-test-${randomUUID()}`;
  const password = randomBytes(32).toString('hex');
  const previousUrl = process.env.REDIS_URL;
  const clients = [];
  let created = false;
  t.after(async () => {
    for (const client of clients) client.disconnect();
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
    if (created) await execute('docker', ['rm', '--force', name]);
  });
  await execute('docker', ['run', '--detach', '--name', name,
    '--label', `io.taibu.redis-acceptance.run=${name}`, '--publish', '127.0.0.1::6379',
    '--env', 'REDIS_PASSWORD', 'redis:8.2.1-alpine', 'sh', '-c',
    'exec redis-server --save "" --appendonly no --requirepass "$REDIS_PASSWORD"'],
  { env: { ...process.env, REDIS_PASSWORD: password }, timeout: 30_000 });
  created = true;
  const { stdout } = await execute('docker', ['port', name, '6379/tcp']);
  assert.match(stdout.trim(), /^127\.0\.0\.1:\d+$/);
  process.env.REDIS_URL = `redis://:${password}@${stdout.trim()}`;
  const factory = async url => {
    const client = new Redis(url, REDIS_RATE_LIMIT_OPTIONS);
    clients.push(client);
    return client;
  };
  const first = createRedisRateLimiter(factory);
  const second = createRedisRateLimiter(factory);
  const config = { maxRequests: 7, windowMs: 1500 };
  // Probe startup with an unrelated bucket, not the bucket under assertion.
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await first('readiness', '/probe', config); ready = true; break; }
    catch { await delay(100); }
  }
  assert.ok(ready, 'isolated Redis did not become ready');
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
    (index % 2 ? first : second)('user-a', '/analysis', config)));
  assert.equal(results.filter(result => result.allowed).length, 7);
  assert.equal(new Set(results.map(result => result.resetAt.getTime())).size, 1);
  const denied = await second('user-a', '/analysis', config);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.resetAt.getTime(), results[0].resetAt.getTime());
  assert.equal((await first('user-b', '/analysis', config)).allowed, true);
  assert.equal((await first('user-a', '/other', config)).allowed, true);
  await delay(Math.max(0, denied.resetAt.getTime() - Date.now()) + 50);
  assert.equal((await second('user-a', '/analysis', config)).remaining, 6);
  await execute('docker', ['stop', '--time', '1', name]);
  const started = Date.now();
  await assert.rejects(first('user-a', '/analysis', config));
  assert.ok(Date.now() - started < 2500, 'backend failure must remain bounded');
});
