import test from 'node:test';
import assert from 'node:assert/strict';
test('readiness reports database and redis, and returns 503 when either fails', async (t) => {
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  const redis = require('../lib/redis.server') as typeof import('../lib/redis.server');
  let database = true;
  let redisReady = true;
  t.mock.method(context, 'pingDatabase', async () => database);
  t.mock.method(redis, 'pingRedis', async () => redisReady);
  const route = require('../app/api/health/ready/route') as typeof import('../app/api/health/ready/route');

  const ready = await route.GET();
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, database: true, redis: true });

  database = false;
  const databaseDown = await route.GET();
  assert.equal(databaseDown.status, 503);
  assert.equal((await databaseDown.json()).database, false);

  database = true;
  redisReady = false;
  const redisDown = await route.GET();
  assert.equal(redisDown.status, 503);
  assert.equal((await redisDown.json()).redis, false);
});
