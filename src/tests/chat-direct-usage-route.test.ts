import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockAuthContext } from './helpers/auth-mock';

function setup(t: TestContext) {
  const apiUtils = require('../lib/api-utils') as { requireUserContext: unknown };
  const rateLimit = require('../lib/rate-limit') as { checkRateLimit: unknown };
  const account = require('../lib/billing/account.server') as { recordDirectUsage: unknown };

  const state = {
    authenticated: true as boolean,
    allowed: true as boolean,
    recorded: [] as unknown[],
    buckets: [] as string[],
  };
  const originals = {
    requireUserContext: apiUtils.requireUserContext,
    checkRateLimit: rateLimit.checkRateLimit,
    recordDirectUsage: account.recordDirectUsage,
  };
  apiUtils.requireUserContext = async () => (state.authenticated
    ? createMockAuthContext('user-1')
    : { error: { message: '请先登录', status: 401 } });
  rateLimit.checkRateLimit = async (_userId: unknown, endpoint: string) => {
    state.buckets.push(endpoint);
    return { allowed: state.allowed, remaining: 9, resetAt: new Date() };
  };
  account.recordDirectUsage = async (input: unknown) => { state.recorded.push(input); };
  t.after(() => {
    apiUtils.requireUserContext = originals.requireUserContext;
    rateLimit.checkRateLimit = originals.checkRateLimit;
    account.recordDirectUsage = originals.recordDirectUsage;
  });
  return { state, route: require('../app/api/chat/direct/usage/route') as typeof import('../app/api/chat/direct/usage/route') };
}

const post = (body: string | unknown) => new NextRequest('http://localhost/api/chat/direct/usage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('direct usage reporting needs a session, a free rate-limit slot and a model', async (t) => {
  const { state, route } = setup(t);
  state.authenticated = false;
  const anonymous = await route.POST(post({ model: 'own-model', input: 10 }));
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { success: false, error: '请先登录' });

  state.authenticated = true;
  state.allowed = false;
  const limited = await route.POST(post({ model: 'own-model', input: 10 }));
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { success: false, error: '请求过于频繁，请稍后再试' });
  assert.deepEqual(state.recorded, []);

  state.allowed = true;
  for (const [body, error] of [
    ['not json', '请求体不是合法 JSON'],
    [{ input: 10 }, '缺少模型 ID'],
    [{ model: '   ', input: 10 }, '缺少模型 ID'],
  ] as const) {
    const response = await route.POST(post(body));
    assert.equal(response.status, 400, String(body));
    assert.deepEqual(await response.json(), { success: false, error });
  }
  assert.deepEqual(state.recorded, []);
  assert.equal(state.buckets.length, 4, 'the anonymous request is refused before its bucket is read');
  assert.ok(state.buckets.every(bucket => bucket === '/api/chat/direct/usage'));
});

test('reported tokens are whole, capped and recorded against the model and conversation', async (t) => {
  const { state, route } = setup(t);
  const response = await route.POST(post({
    model: '  own-model  ', input: 1_200, output: 300, cacheRead: 80, cacheWrite: 0, reasoning: 40,
    conversationId: '  conversation-1  ',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(state.recorded, [{
    userId: 'user-1', model: 'own-model',
    usage: { input: 1_200, output: 300, cacheRead: 80, cacheWrite: 0, reasoning: 40 },
    referenceType: 'conversation', referenceId: 'conversation-1',
  }]);

  await route.POST(post({
    model: 'm'.repeat(500), input: 5_000_000_000, output: 1.5, cacheRead: -3, cacheWrite: '9', reasoning: 0,
  }));
  const sloppy = state.recorded[1] as { model: string; usage: Record<string, number>; referenceId?: string };
  assert.equal(sloppy.model.length, 200);
  assert.deepEqual(sloppy.usage, { input: 100_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
    'only positive whole numbers survive, and a huge count is capped');
  assert.equal('referenceId' in sloppy, false, 'a call without a conversation carries no reference');
});
