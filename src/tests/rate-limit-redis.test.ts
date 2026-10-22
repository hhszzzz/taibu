import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type Redis from 'ioredis';
import { createRedisRateLimiter, redisRateLimitKey, REDIS_RATE_LIMIT_OPTIONS, REDIS_RATE_LIMIT_SCRIPT } from '../lib/rate-limit-redis';

const config = { maxRequests: 2, windowMs: 60_000 };
const adapter = () => {
    const calls: unknown[][] = [];
    let disconnected = 0;
    let connected = 0;
    let response: unknown = [1, 1, 1_800_000_060_000];
    let failure: Error | undefined;
    const client = {
        connect: async () => { connected++; },
        disconnect: () => { disconnected++; },
        on: () => client,
        eval: async (...args: unknown[]) => { calls.push(args); if (failure) throw failure; return response; },
    };
    const consume = createRedisRateLimiter(async () => client as unknown as Redis);
    return { consume, calls, client, connected: () => connected, disconnected: () => disconnected,
        respond: (value: unknown) => { response = value; }, fail: (value: Error) => { failure = value; } };
};

function redisEnv(t: TestContext) {
    const prior = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    t.after(() => { if (prior === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = prior; });
}

test('Redis uses one atomic script and reuses the concurrent handshake', async t => {
    redisEnv(t);
    const fixture = adapter();
    const results = await Promise.all([fixture.consume('user', '/chat', config), fixture.consume('user', '/chat', config)]);
    assert.equal(fixture.connected(), 1);
    assert.equal(results[0].resetAt.getTime(), 1_800_000_060_000);
    assert.deepEqual(fixture.calls[0], [REDIS_RATE_LIMIT_SCRIPT, 1, redisRateLimitKey('user', '/chat'), 2, 60_000]);
    fixture.respond([0, 0, 1_800_000_060_000]);
    assert.equal((await fixture.consume('user', '/chat', config)).allowed, false);
});

test('Redis keys distinguish delimiter-containing identity/endpoint pairs', () => {
    assert.notEqual(redisRateLimitKey('a:b', 'c'), redisRateLimitKey('b', 'c:a'));
    assert.notEqual(redisRateLimitKey('user1', '/chat'), redisRateLimitKey('user2', '/chat'));
    assert.notEqual(redisRateLimitKey('user', '/a'), redisRateLimitKey('user', '/b'));
    assert.notEqual(redisRateLimitKey('\ud800', '/a'), redisRateLimitKey('�', '/a'));
});

test('Redis errors are not retried; malformed replies disconnect', async t => {
    redisEnv(t);
    const fixture = adapter();
    fixture.fail(new Error('transport secret'));
    await assert.rejects(fixture.consume('user', '/chat', config));
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.disconnected(), 1);
    const malformed = adapter();
    malformed.respond([1, -1, Number.NaN]);
    await assert.rejects(malformed.consume('user', '/chat', config), /Invalid Redis/);
    assert.equal(malformed.disconnected(), 1);
    assert.equal(REDIS_RATE_LIMIT_OPTIONS.enableOfflineQueue, false);
    assert.equal(REDIS_RATE_LIMIT_OPTIONS.autoResendUnfulfilledCommands, false);
    assert.equal(REDIS_RATE_LIMIT_OPTIONS.retryStrategy(), null);
    assert.equal(REDIS_RATE_LIMIT_OPTIONS.reconnectOnError(), false);
});

test('Redis URL validation rejects missing configuration and option overrides', async t => {
    redisEnv(t);
    const fixture = adapter();
    for (const url of ['', 'https://localhost', 'redis://localhost/0?enableOfflineQueue=true', 'redis://localhost/not-a-db']) {
        process.env.REDIS_URL = url;
        await assert.rejects(fixture.consume('user', '/chat', config));
    }
    assert.equal(fixture.connected(), 0);
    assert.equal(fixture.calls.length, 0);
});

test('Redis command deadline disconnects without replay', async t => {
    redisEnv(t);
    const fixture = adapter();
    fixture.client.eval = async (...args: unknown[]) => { fixture.calls.push(args); return new Promise(() => {}); };
    await assert.rejects(fixture.consume('user', '/chat', config), /timeout/);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.disconnected(), 1);
});

test('Redis connect deadline is bounded and never dispatches admission', async t => {
    redisEnv(t);
    const fixture = adapter();
    fixture.client.connect = () => new Promise(() => {});
    await assert.rejects(fixture.consume('user', '/chat', config), /timeout/);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.disconnected(), 1);
});

test('Redis-only rate limiting fails open without touching the database', async (t) => {
    const redis = require('../lib/rate-limit-redis') as typeof import('../lib/rate-limit-redis');
    const { checkRateLimit } = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
    t.mock.method(redis, 'consumeRedisRateLimit', async () => { throw new Error('redis://secret:password@host'); });
    const diagnostics: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => { diagnostics.push(args); });
    for (let i = 0; i < 4; i++) assert.equal((await checkRateLimit('user', '/chat', config)).allowed, true);
    assert.ok(!JSON.stringify(diagnostics).includes('secret'));
    await assert.rejects(checkRateLimit('user', '/chat', { maxRequests: 0, windowMs: 1 }), /Invalid/);
    await assert.rejects(checkRateLimit('', '/chat', config), /Invalid/);
});
