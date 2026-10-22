import test from 'node:test';
import assert from 'node:assert/strict';

type MessageHandler = (channel: string, name: string) => void;

// The module keeps one process-wide subscriber, created once for the whole
// test file, so the handler sink must also be file-wide.
const messageHandlers: MessageHandler[] = [];

function fakeRedis(t: import('node:test').TestContext) {
  const store = new Map<string, string>();
  const published: string[] = [];
  const client = {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string) { store.set(key, value); return 'OK'; },
    async del(key: string) { return store.delete(key) ? 1 : 0; },
    async publish(_channel: string, name: string) { published.push(name); return 1; },
  };
  const subscriber = {
    on(event: string, handler: MessageHandler) {
      if (event === 'message') messageHandlers.push(handler);
    },
    async subscribe() { return 1; },
  };
  const redisModule = require('../lib/redis.server') as typeof import('../lib/redis.server');
  t.mock.method(redisModule, 'getRedisClient', () => client as never);
  t.mock.method(redisModule, 'createSubscriber', () => subscriber as never);
  return { store, published, client };
}

function cacheModule() {
  return require('../lib/cache/shared.server') as typeof import('../lib/cache/shared.server');
}

test('shared cache reads redis L2 before calling the loader', async (t) => {
  const { store } = fakeRedis(t);
  const name = `l2-${Date.now()}`;
  store.set(`taibu:cache:v1:${name}`, JSON.stringify({ value: { answer: 42 } }));
  const cache = cacheModule().createSharedCache<{ answer: number }>({ name, ttlMs: 60_000 });
  let loads = 0;

  assert.deepEqual(await cache.load(async () => { loads++; return { answer: 0 }; }), { answer: 42 });
  assert.equal(loads, 0);
});

test('shared cache warms L1 and drops both levels on invalidation', async (t) => {
  const { store, published } = fakeRedis(t);
  const name = `invalidate-${Date.now()}`;
  const cache = cacheModule().createSharedCache<number>({ name, ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => ++loads;

  assert.equal(await cache.load(loader), 1);
  assert.equal(await cache.load(loader), 1);
  assert.equal(loads, 1);

  await cache.invalidate();
  assert.ok(published.includes(name));
  assert.equal(store.has(`taibu:cache:v1:${name}`), false);
  assert.equal(await cache.load(loader), 2);

  // Another process invalidated: the subscriber clears this process' L1.
  store.delete(`taibu:cache:v1:${name}`);
  for (const handler of messageHandlers) handler('taibu:cache:invalidate', name);
  assert.equal(await cache.load(loader), 3);
});

test('shared cache degrades to the loader when redis is unavailable', async (t) => {
  const redisModule = require('../lib/redis.server') as typeof import('../lib/redis.server');
  t.mock.method(redisModule, 'getRedisClient', () => { throw new Error('no redis'); });
  t.mock.method(redisModule, 'createSubscriber', () => { throw new Error('no redis'); });
  const cache = cacheModule().createSharedCache<string>({ name: `offline-${Date.now()}`, ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => `value-${++loads}`;

  assert.equal(await cache.load(loader), 'value-1');
  assert.equal(await cache.load(loader), 'value-1', 'L1 still absorbs the second read');
  await cache.invalidate();
  assert.equal(await cache.load(loader), 'value-2');
});
