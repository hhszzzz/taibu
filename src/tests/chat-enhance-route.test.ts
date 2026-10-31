import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

const MODEL = {
  id: 'fixture-chat', name: '对话模型', vendor: 'other', modelId: 'fixture-chat',
  apiUrl: 'https://gateway.example/v1', supportsReasoning: false,
  pricing: { input: 1, output: 2, cacheRead: null, cacheWrite: null, image: null },
};

function setup(t: TestContext) {
  const apiUtils = require('../lib/api-utils') as any;
  const guard = require('../lib/api/ai-feature-guard') as any;
  const aiConfig = require('../lib/server/ai-config') as any;
  const balanceGuard = require('../lib/api/balance-guard') as any;
  const billing = require('../lib/billing/account.server') as any;
  const ai = require('../lib/ai/ai') as any;

  const rpcCalls: string[] = [];
  const db = createMockScopedDb({
    rpc: async (name: string) => { rpcCalls.push(name); return true; },
  });
  const state = {
    allowed: true,
    modelConfig: MODEL as typeof MODEL | null,
    balanceResponse: null as Response | null,
    ai: async () => '  润色后的文字  ',
    billers: [] as unknown[],
  };

  const originals = {
    requireUserContext: apiUtils.requireUserContext,
    guard: guard.getGlobalAIFeatureGuardResponse,
    getModelConfigAsync: aiConfig.getModelConfigAsync,
    getDefaultModelConfigAsync: aiConfig.getDefaultModelConfigAsync,
    balance: balanceGuard.getBalanceGuardResponse,
    usageBiller: billing.usageBiller,
    callAI: ai.callAI,
  };

  apiUtils.requireUserContext = async () => createMockAuthContext('user-1', db);
  guard.getGlobalAIFeatureGuardResponse = async () => null;
  aiConfig.getModelConfigAsync = async () => state.modelConfig;
  aiConfig.getDefaultModelConfigAsync = async () => state.modelConfig;
  balanceGuard.getBalanceGuardResponse = async () => state.balanceResponse;
  billing.usageBiller = (userId: string, source: string) => {
    state.billers.push({ userId, source });
    return async () => undefined;
  };
  ai.callAI = async (...args: unknown[]) => {
    const options = args[4] as { beforeModelAttempt?: () => Promise<void> };
    state.billers.push(options);
    await options.beforeModelAttempt?.();
    return state.ai();
  };

  t.after(() => {
    apiUtils.requireUserContext = originals.requireUserContext;
    guard.getGlobalAIFeatureGuardResponse = originals.guard;
    aiConfig.getModelConfigAsync = originals.getModelConfigAsync;
    aiConfig.getDefaultModelConfigAsync = originals.getDefaultModelConfigAsync;
    balanceGuard.getBalanceGuardResponse = originals.balance;
    billing.usageBiller = originals.usageBiller;
    ai.callAI = originals.callAI;
  });

  return { state, db, rpcCalls };
}

const post = (body: unknown) => new NextRequest('http://localhost/api/chat/enhance', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('enhancement validates the prompt and the model before spending anything', async (t) => {
  const { state } = setup(t);
  const { POST } = await import('../app/api/chat/enhance/route');

  assert.equal((await POST(post({ text: '' }))).status, 400);
  assert.equal((await POST(post({ text: 'x'.repeat(8_001) }))).status, 400);

  state.modelConfig = null;
  assert.equal((await POST(post({ text: '帮我润色' }))).status, 403);

  state.modelConfig = { ...MODEL, pricing: undefined } as never;
  assert.equal((await POST(post({ text: '帮我润色' }))).status, 403, 'an unpriced model is not offered');
});

test('enhancement stops on the balance guard before claiming the daily quota', async (t) => {
  const { state, rpcCalls } = setup(t);
  state.balanceResponse = new Response(JSON.stringify({ code: 'INSUFFICIENT_BALANCE' }), {
    status: 402, headers: { 'Content-Type': 'application/json' },
  });
  const { POST } = await import('../app/api/chat/enhance/route');
  const response = await POST(post({ text: '帮我润色' }));
  assert.equal(response.status, 402);
  assert.deepEqual(rpcCalls, []);
});

test('enhancement claims the quota, bills its usage and trims the result', async (t) => {
  const { state, rpcCalls } = setup(t);
  const { POST } = await import('../app/api/chat/enhance/route');
  const response = await POST(post({ text: '帮我润色' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: '润色后的文字' });
  assert.deepEqual(rpcCalls, ['claim_prompt_enhancement']);
  assert.deepEqual(state.billers[0], { userId: 'user-1', source: 'enhance' });
  const options = state.billers[1] as { onUsage: unknown; maxTokens: number };
  assert.equal(typeof options.onUsage, 'function');
  assert.equal(options.maxTokens, 2000);
});

test('enhancement reports a spent daily quota and an empty model answer', async (t) => {
  const { state, db } = setup(t);
  const { POST } = await import('../app/api/chat/enhance/route');
  let granted = false;
  (db as unknown as { rpc: (name: string) => Promise<boolean> }).rpc = async () => granted;
  const exhausted = await POST(post({ text: '帮我润色' }));
  assert.equal(exhausted.status, 429);
  assert.match((await exhausted.json()).error, /5 次/u);
  assert.equal(granted, false);

  granted = true;
  state.ai = async () => '   ';
  const empty = await POST(post({ text: '帮我润色' }));
  assert.equal(empty.status, 502);
});

test('enhancement surfaces a quota backend failure as a retryable failure', async (t) => {
  const { db } = setup(t);
  (db as unknown as { rpc: (name: string) => Promise<boolean> }).rpc = async () => { throw new Error('rpc down'); };
  const { POST } = await import('../app/api/chat/enhance/route');
  const response = await POST(post({ text: '帮我润色' }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, '润色失败，请重试');
});
