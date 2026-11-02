import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockAuthContext } from './helpers/auth-mock';
import { DEFAULT_BYOK_POLICY, type ByokConnectionView, type ByokPolicy } from '../lib/byok/config';
import type { ModelsDevSuggestion } from '../lib/admin/models-dev';

const CONNECTION_ID = '00000000-0000-4000-8000-0000000000c1';

const saved = (overrides: Partial<ByokConnectionView> = {}): ByokConnectionView => ({
  id: CONNECTION_ID, name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: null, models: [],
  updatedAt: '2026-11-02T00:00:00Z', ...overrides,
});

function setup(t: TestContext) {
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
  const probe = require('../lib/byok/probe') as typeof import('../lib/byok/probe');
  const rate = require('../lib/rate-limit') as typeof import('../lib/rate-limit');
  const modelsDev = require('../lib/admin/models-dev.server') as typeof import('../lib/admin/models-dev.server');
  const safeFetch = require('../lib/agent/safe-fetch.server') as typeof import('../lib/agent/safe-fetch.server');
  const state = {
    feature: 'enabled' as 'enabled' | 'disabled' | 'unavailable',
    signedIn: true,
    admin: true,
    allowed: true,
    policy: { ...DEFAULT_BYOK_POLICY } as ByokPolicy,
    connections: [saved()],
  };
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: state.feature }) as never);
  t.mock.method(settings, 'getByokPolicy', async () => state.policy);
  const setPolicy = t.mock.method(settings, 'setByokPolicy', async (policy: ByokPolicy) => { state.policy = policy; });
  t.mock.method(api, 'requireUserContext', async () => (state.signedIn ? createMockAuthContext('user-1') : { error: { message: '请先登录', status: 401 } }) as never);
  t.mock.method(api, 'requireAdminUser', async () => (state.admin ? { user: { id: 'admin-1' } } : { error: { message: '无权限操作', status: 403 } }) as never);
  t.mock.method(rate, 'checkRateLimit', async () => ({ allowed: state.allowed, remaining: 1, resetAt: new Date() }));
  t.mock.method(store, 'listByokConnections', async () => state.connections);
  const created = t.mock.method(store, 'createByokConnection', async (_db: unknown, _user: string, input: { name: string }) => saved({ name: input.name }));
  const updated = t.mock.method(store, 'updateByokConnection', async (_db: unknown, _user: string, id: string) => state.connections.find(item => item.id === id) ?? null);
  const removed = t.mock.method(store, 'deleteByokConnection', async (_db: unknown, _user: string, id: string) => id === CONNECTION_ID);
  const storedKey = t.mock.method(store, 'storedConnectionKey', async () => ({ key: 'sk-stored', connection: saved({ keyHint: 'sk-…ored' }) }));
  const listed = t.mock.method(probe, 'probeByokConnection', async () => ({ ok: true as const, models: [{ id: 'deepseek-chat' }] }));
  const tested = t.mock.method(probe, 'testByokModel', async () => ({ ok: true as const, reply: 'OK', effort: 'accepted' as const }));
  const catalog = t.mock.method(modelsDev, 'allModelsDevModels', async (): Promise<ModelsDevSuggestion[]> => [
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', providerName: 'DeepSeek', contextWindow: 128000, maxTokens: 64000, reasoning: true, thinkingLevels: ['low', 'high'], vision: false },
    { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', providerName: 'OpenAI', contextWindow: 1047576, maxTokens: 32768, reasoning: false, thinkingLevels: ['low'], vision: true },
  ]);
  return { state, api, created, updated, removed, storedKey, listed, tested, catalog, setPolicy, agentSafeFetch: safeFetch.agentSafeFetch };
}

const request = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('connections need the feature, a session and the account the page belongs to', async (t) => {
  const { state } = setup(t);
  const { GET } = await import('../app/api/byok/connections/route');
  const list = await GET(request('/api/byok/connections', 'GET', undefined, { 'X-Expected-User-Id': 'user-1' }));
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()), { connections: state.connections, policy: DEFAULT_BYOK_POLICY });
  assert.equal((await GET(request('/api/byok/connections', 'GET', undefined, { 'X-Expected-User-Id': 'user-2' }))).status, 409, 'another account signed in meanwhile');
  state.signedIn = false;
  assert.equal((await GET(request('/api/byok/connections', 'GET'))).status, 401);
  state.feature = 'disabled';
  assert.equal((await GET(request('/api/byok/connections', 'GET'))).status, 403);
  state.feature = 'unavailable';
  assert.equal((await GET(request('/api/byok/connections', 'GET'))).status, 503, 'fails closed when the switch cannot be read');
});

test('a connection is saved only with valid input, and a stored key only for a public address', async (t) => {
  const { state, created, updated, removed } = setup(t);
  const { POST } = await import('../app/api/byok/connections/route');
  const { PATCH, DELETE } = await import('../app/api/byok/connections/[id]/route');
  const body = { name: '内网模型', protocol: 'openai', baseUrl: 'https://192.168.1.20/v1', key: { store: false }, models: [{ modelId: 'qwen3' }] };
  const browserOnly = await POST(request('/api/byok/connections', 'POST', body));
  assert.equal(browserOnly.status, 201, 'a browser can reach an address this server must not');
  const [, user, input, policy] = created.mock.calls[0]!.arguments as unknown as [unknown, string, { baseUrl: string; models: unknown[] }, ByokPolicy];
  assert.equal(user, 'user-1');
  assert.equal(input.baseUrl, 'https://192.168.1.20/v1');
  assert.deepEqual(policy, DEFAULT_BYOK_POLICY);
  const stored = await POST(request('/api/byok/connections', 'POST', { ...body, key: { store: true, value: 'sk-x' } }));
  assert.equal(stored.status, 400);
  assert.equal(created.mock.callCount(), 1, 'a stored key never goes to a private address');
  const invalid = await POST(request('/api/byok/connections', 'POST', { ...body, models: [{ modelId: 'a' }, { modelId: 'a' }] }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'BYOK_INVALID');
  const oversized = await POST(request('/api/byok/connections', 'POST', 'x'.repeat(256 * 1024 + 1)));
  assert.equal(oversized.status, 413);

  const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
  created.mock.mockImplementation(async () => { throw new store.ByokError('最多 10 个连接', 409, 'BYOK_LIMIT'); });
  const full = await POST(request('/api/byok/connections', 'POST', body));
  assert.deepEqual([full.status, (await full.json()).code], [409, 'BYOK_LIMIT']);

  assert.equal((await PATCH(request('/api/byok/connections/x', 'PATCH', { name: 'x' }), params('not-a-uuid'))).status, 400);
  assert.equal((await PATCH(request('/api/byok/connections/x', 'PATCH', { name: 'x' }), params('00000000-0000-4000-8000-0000000000ff'))).status, 404);
  assert.equal((await PATCH(request('/api/byok/connections/x', 'PATCH', { name: '改名' }), params(CONNECTION_ID))).status, 200);
  state.connections = [saved({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' })];
  const imageOnAnthropic = await PATCH(request('/api/byok/connections/x', 'PATCH', { models: [{ modelId: 'gpt-image-1', usage: 'image' }] }), params(CONNECTION_ID));
  assert.equal(imageOnAnthropic.status, 400, 'an edit checks models against the saved protocol');
  state.connections = [saved({ keyHint: 'sk-…abcd' })];
  const moved = await PATCH(request('/api/byok/connections/x', 'PATCH', { baseUrl: 'https://10.0.0.8/v1' }), params(CONNECTION_ID));
  assert.equal(moved.status, 400, 'a stored key does not follow the address into a private network');
  assert.equal(updated.mock.callCount(), 1);

  assert.equal((await DELETE(request('/api/byok/connections/x', 'DELETE'), params(CONNECTION_ID))).status, 200);
  assert.equal((await DELETE(request('/api/byok/connections/x', 'DELETE'), params('00000000-0000-4000-8000-0000000000ff'))).status, 404);
  assert.equal(removed.mock.callCount(), 2);
});

test('a server test uses the typed key, or the stored one only at its own host, through the public-address fetch', async (t) => {
  const { state, listed, tested, storedKey, agentSafeFetch } = setup(t);
  const { POST } = await import('../app/api/byok/probe/route');
  const probe = (body: Record<string, unknown>) => POST(request('/api/byok/probe', 'POST', { protocol: 'openai', baseUrl: 'https://api.deepseek.com', ...body }));

  const typed = await probe({ apiKey: ' sk-typed ', action: 'models' });
  assert.equal(typed.status, 200);
  assert.deepEqual((await typed.json()), { ok: true, models: [{ id: 'deepseek-chat' }] });
  const [protocol, address, key, options] = listed.mock.calls[0]!.arguments as unknown as [string, string, string, { fetch: unknown; userAgent?: string }];
  assert.deepEqual([protocol, address, key], ['openai', 'https://api.deepseek.com', 'sk-typed']);
  assert.equal(options.fetch, agentSafeFetch);
  assert.ok(options.userAgent);

  assert.equal((await probe({ connectionId: CONNECTION_ID, action: 'chat', modelId: 'deepseek-chat', effort: 'high' })).status, 200);
  assert.equal(storedKey.mock.callCount(), 1);
  const [model, chatKey, effort] = tested.mock.calls[0]!.arguments as unknown as [{ modelId: string; baseUrl: string }, string, string];
  assert.deepEqual([model.modelId, model.baseUrl, chatKey, effort], ['deepseek-chat', 'https://api.deepseek.com', 'sk-stored', 'high']);

  const elsewhere = await probe({ connectionId: CONNECTION_ID, baseUrl: 'https://relay.example', action: 'models' });
  assert.equal(elsewhere.status, 400, 'the stored key is never sent to another host');
  assert.equal((await elsewhere.json()).code, 'BYOK_KEY_REQUIRED');
  assert.equal((await probe({ apiKey: 'k', baseUrl: 'https://127.0.0.1/v1', action: 'models' })).status, 400);
  assert.equal((await probe({ apiKey: 'k', action: 'chat', modelId: 'm', effort: 'turbo' })).status, 400);
  assert.equal((await probe({ apiKey: 'k', action: 'delete' })).status, 400);
  state.allowed = false;
  assert.equal((await probe({ apiKey: 'k', action: 'models' })).status, 429);
  state.policy = { ...state.policy, allowServerKeys: false };
  assert.equal((await probe({ apiKey: 'k', action: 'models' })).status, 403, 'with stored keys switched off, tests run in the browser');
  assert.equal(listed.mock.callCount(), 1);
});

test('capabilities come from models.dev by exact model ID, and an unreadable catalog says so', async (t) => {
  const { catalog } = setup(t);
  const { POST } = await import('../app/api/byok/capabilities/route');
  const response = await POST(request('/api/byok/capabilities', 'POST', { modelIds: ['deepseek-reasoner', 'gpt-4.1', 'mystery', 7] }));
  assert.deepEqual((await response.json()), { models: {
    'deepseek-reasoner': { contextWindow: 128000, maxOutput: 64000, vision: false, thinkingLevels: ['low', 'high'] },
    'gpt-4.1': { contextWindow: 1047576, maxOutput: 32768, vision: true, thinkingLevels: [] },
  } }, 'a model that does not reason has no levels; an unknown one is left out');
  assert.deepEqual((await (await POST(request('/api/byok/capabilities', 'POST', { modelIds: [] }))).json()), { models: {} });
  catalog.mock.mockImplementation(async () => { throw new Error('offline'); });
  assert.deepEqual((await (await POST(request('/api/byok/capabilities', 'POST', { modelIds: ['gpt-4.1'] }))).json()), { models: {}, unavailable: true });
});

test('the administrator\'s policy is read and replaced whole, and only by an administrator', async (t) => {
  const { state, setPolicy } = setup(t);
  const { GET, PUT } = await import('../app/api/admin/byok-policy/route');
  assert.deepEqual((await (await GET(request('/api/admin/byok-policy', 'GET'))).json()), { policy: DEFAULT_BYOK_POLICY });
  const next = { allowServerKeys: false, maxConnections: 3, maxModelsPerConnection: 20 };
  const saved = await PUT(request('/api/admin/byok-policy', 'PUT', { policy: next }));
  assert.equal(saved.status, 200);
  assert.deepEqual(setPolicy.mock.calls[0]!.arguments[0], next);
  assert.equal((await PUT(request('/api/admin/byok-policy', 'PUT', { policy: { ...next, maxConnections: 0 } }))).status, 400);
  assert.equal((await PUT(request('/api/admin/byok-policy', 'PUT', 'x'.repeat(256 * 1024 + 1)))).status, 413);
  state.admin = false;
  assert.equal((await GET(request('/api/admin/byok-policy', 'GET'))).status, 403);
  assert.equal((await PUT(request('/api/admin/byok-policy', 'PUT', { policy: next }))).status, 403);
  assert.equal(setPolicy.mock.callCount(), 1);
});
