import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/auth-mock';
import { DEFAULT_BYOK_POLICY } from '../lib/byok/config';
import type { ResolvedByokModel } from '../lib/byok/store.server';

const REF = 'byok:00000000-0000-4000-8000-0000000000b1';
const ownModel = (overrides: Partial<ResolvedByokModel> = {}): ResolvedByokModel => ({
  id: '00000000-0000-4000-8000-0000000000b1', ref: REF, modelId: 'deepseek-chat', displayName: 'DeepSeek', usage: 'chat', supportsVision: false,
  thinkingLevels: ['low', 'high'], defaultEffort: 'high', contextWindow: null, maxOutput: null,
  connection: { id: '00000000-0000-4000-8000-0000000000c1', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: 'sk-…ored', updatedAt: '2026-11-02T00:00:00Z' },
  serverKey: true, openKey: () => 'sk-stored', ...overrides,
});

const completion = (content: string) => new Response([
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 } })}\n\n`,
  'data: [DONE]\n\n',
].join(''), { headers: { 'content-type': 'text/event-stream' } });

function setup(t: TestContext, model: ResolvedByokModel | null = ownModel()) {
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const aiGuard = require('../lib/api/ai-feature-guard') as typeof import('../lib/api/ai-feature-guard');
  const chatRequest = require('../lib/server/chat/request') as typeof import('../lib/server/chat/request');
  const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
  const safeFetch = require('../lib/agent/safe-fetch.server') as typeof import('../lib/agent/safe-fetch.server');
  const account = require('../lib/billing/account.server') as typeof import('../lib/billing/account.server');
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const rate = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
  const state = { feature: 'enabled' as 'enabled' | 'disabled', answer: () => completion('OK') };
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: state.feature }) as never);
  t.mock.method(settings, 'getByokPolicy', async () => DEFAULT_BYOK_POLICY);
  t.mock.method(aiGuard, 'getGlobalAIFeatureGuardResponse', async () => null);
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext('user-1'));
  t.mock.method(rate, 'checkRateLimit', async () => ({ allowed: true, remaining: 9, resetAt: new Date() }));
  t.mock.method(chatRequest, 'prepareBrowserDirectChatRequest', async (_request: unknown, body: import('../lib/server/chat/request').ChatRequestBody) => ({
    body, userId: 'user-1', metered: false, requestedModelId: String(body.model), reasoningEnabled: body.reasoning === true,
    sanitizedMessages: [{ role: 'system', content: 'client system' }, { role: 'user', content: '今天运势？' }, { role: 'assistant', content: '先看日柱。' }, { role: 'user', content: '继续' }],
    systemPrompt: '太卜系统提示', metadata: { sources: [], kbSearchEnabled: false, kbHitCount: 0 }, promptKnowledgeBases: [] }) as never);
  const managed = t.mock.method(chatRequest, 'prepareChatRequest', async () => { throw new Error('own models never take the platform path'); });
  t.mock.method(store, 'resolveByokModel', async () => model);
  const sent: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  t.mock.method(safeFetch, 'agentSafeFetch', async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    return state.answer();
  });
  const usage = t.mock.method(account, 'recordDirectUsage', async () => {});
  return { state, sent, usage, managed };
}

const chat = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: '今天运势？' }], model: REF, ...body }),
});
const events = async (response: Response) => (await response.text()).split('\n')
  .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);

test('a chat turn on a stored-key own model is sent from this server and streamed in the chat format, at $0', async (t) => {
  const { sent, usage, managed } = setup(t);
  const { POST } = await import('../app/api/chat/route');
  const response = await POST(chat({ stream: true, reasoning: true, reasoningEffort: 'medium', conversationId: 'conv-1' }));
  assert.equal(response.status, 200);
  const stream = await events(response);
  assert.deepEqual(stream.map(event => event.type), ['start', 'text-start', 'text-delta', 'text-end', 'finish']);
  assert.equal(stream[2].delta, 'OK');
  assert.equal(managed.mock.callCount(), 0);

  const [request] = sent;
  assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(request.auth, 'Bearer sk-stored');
  assert.equal(request.body.model, 'deepseek-chat');
  assert.equal(request.body.reasoning_effort, 'high', 'medium moves to the nearest level the model has');
  const messages = request.body.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(messages.map(item => item.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[0].content, '太卜系统提示', 'the site\'s prompt, not one the client sent');
  assert.deepEqual(usage.mock.calls[0]!.arguments[0], {
    userId: 'user-1', model: 'deepseek-chat', usage: { input: 30, output: 4, cacheRead: 0, cacheWrite: 0 }, source: 'chat',
    referenceType: 'conversation', referenceId: 'conv-1',
  });
});

test('the provider\'s refusal reaches the chat as its status, its text and a hint', async (t) => {
  const { state } = setup(t);
  state.answer = () => new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 });
  const { POST } = await import('../app/api/chat/route');
  const stream = await events(await POST(chat({ stream: true })));
  const failure = stream.find(event => event.type === 'error');
  assert.match(String(failure?.errorText), /^HTTP 402 · .*Insufficient Balance[\s\S]*余额不足/u);
  const whole = await POST(chat({ stream: false }));
  assert.equal(whole.status, 502);
  assert.match((await whole.json()).error, /HTTP 402/u);
});

test('own models the site cannot call are refused before any request', async (t) => {
  for (const [model, message] of [
    [null, /不存在/u],
    [ownModel({ serverKey: false, openKey: () => null }), /浏览器/u],
    [ownModel({ usage: 'image' }), /只用于生图/u],
  ] as const) {
    await t.test(String(message), async (t) => {
      const { sent } = setup(t, model);
      const { POST } = await import('../app/api/chat/route');
      const response = await POST(chat({ stream: true }));
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, 'BYOK_UNAVAILABLE');
      assert.match(body.error, message);
      assert.equal(sent.length, 0);
    });
  }
  await t.test('feature off', async (t) => {
    const { state, sent } = setup(t);
    state.feature = 'disabled';
    const { POST } = await import('../app/api/chat/route');
    assert.equal((await POST(chat({ stream: true }))).status, 403);
    assert.equal(sent.length, 0);
  });
});

test('polishing on a stored-key own model answers from this server without the daily allowance', async (t) => {
  const { sent, usage } = setup(t);
  const { POST } = await import('../app/api/chat/enhance/route');
  const response = await POST(new NextRequest('http://localhost/api/chat/enhance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '帮我看看今天', model: REF }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: 'OK' });
  assert.equal(sent[0].body.reasoning_effort, undefined, 'polishing leaves thinking to the model');
  assert.equal((usage.mock.calls[0]!.arguments[0] as { source: string }).source, 'enhance');
});
