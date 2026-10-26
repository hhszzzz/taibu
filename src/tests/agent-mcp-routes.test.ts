import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { mcpServerRow } from './helpers/mcp-fixture';
import { DEFAULT_AGENT_EXTENSIONS_POLICY, type AgentExtensionsPolicy } from '../lib/agent/mcp/config';
import { applyMcpSecretChanges } from '../lib/agent/mcp/secrets.server';
import type { McpServerRow } from '../lib/agent/mcp/store.server';

const SERVER_ID = '00000000-0000-4000-8000-00000000aa01';

function modules() {
  return {
    apiUtils: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    context: require('../lib/db/context.server') as typeof import('../lib/db/context.server'),
    store: require('../lib/agent/mcp/store.server') as typeof import('../lib/agent/mcp/store.server'),
    endpoint: require('../lib/agent/mcp/endpoint.server') as typeof import('../lib/agent/mcp/endpoint.server'),
    settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
    credits: require('../lib/user/credits') as typeof import('../lib/user/credits'),
    rateLimit: require('../lib/rate-limit') as typeof import('../lib/rate-limit'),
  };
}

function useKey(t: TestContext) {
  const previous = process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  });
}

function asAdmin(t: TestContext) {
  const { apiUtils, context, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }) as never);
  t.mock.method(context, 'systemDb', () => createMockScopedDb({ scope: { kind: 'system' } }));
  return { invalidated: t.mock.method(store, 'invalidatePlatformMcpServers', async () => undefined) };
}

function asMember(t: TestContext, options: { membership?: 'free' | 'plus' | 'pro'; policy?: AgentExtensionsPolicy; used?: number } = {}) {
  const { apiUtils, settings, credits, store } = modules();
  t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('user-1'));
  t.mock.method(settings, 'getAgentExtensionsPolicy', async () => options.policy ?? DEFAULT_AGENT_EXTENSIONS_POLICY);
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ membership: options.membership ?? 'plus', credits: 10, expiresAt: null }));
  t.mock.method(store, 'countMcpServers', async () => options.used ?? 0);
}

const request = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('administrator MCP routes refuse other users before reading anything', async (t) => {
  const { apiUtils, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ error: { message: '需要管理员权限', status: 403 } }));
  const listed = t.mock.method(store, 'listMcpServerRows', async () => []);
  const { GET, POST } = await import('../app/api/admin/agent-mcp/route');
  assert.equal((await GET(request('/api/admin/agent-mcp'))).status, 403);
  assert.equal((await POST(request('/api/admin/agent-mcp', { method: 'POST', body: { name: 'exa' } }))).status, 403);
  const policy = await import('../app/api/admin/agent-extensions-policy/route');
  assert.equal((await policy.PUT(request('/api/admin/agent-extensions-policy', { method: 'PUT', body: {} }))).status, 403);
  assert.equal(listed.mock.callCount(), 0);
});

test('an administrator adds a platform server whose secrets never come back', async (t) => {
  useKey(t);
  const { invalidated } = asAdmin(t);
  const { store } = modules();
  let saved: McpServerRow | undefined;
  const insert = t.mock.method(store, 'insertMcpServer', async (_db: unknown, owner: string | null, fields: Record<string, unknown>) => {
    const scope = { serverId: SERVER_ID, ownerId: owner };
    saved = mcpServerRow({
      id: SERVER_ID, name: fields.name as string, display_name: fields.displayName as string, url: fields.url as string,
      secret_headers: applyMcpSecretChanges(scope, 'header', {}, fields.secretHeaders as Record<string, string>),
      exposure: 'hidden', search_tool: 'web_search_exa',
    });
    return saved;
  });
  const { POST } = await import('../app/api/admin/agent-mcp/route');
  const response = await POST(request('/api/admin/agent-mcp', { method: 'POST', body: {
    name: 'exa', displayName: 'Exa', url: 'https://mcp.exa.ai/mcp', exposure: 'hidden', searchTool: 'web_search_exa',
    secretHeaders: { 'x-api-key': 'exa-live-secret-value' },
  } }));
  const text = await response.text();
  assert.equal(response.status, 201);
  assert.doesNotMatch(text, /exa-live-secret-value/);
  assert.deepEqual(JSON.parse(text).server.secretHeaders, ['x-api-key']);
  assert.equal(insert.mock.calls[0].arguments[1], null, 'administrators write platform rows');
  assert.equal(invalidated.mock.callCount(), 1, 'tasks see the change through the shared cache');

  const bad = await POST(request('/api/admin/agent-mcp', { method: 'POST', body: { name: 'local', displayName: 'Local', url: 'https://127.0.0.1/mcp' } }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /公开/);
  assert.equal(insert.mock.callCount(), 1);
});

test('administrator changes, deletions and tests report missing servers and record what a test saw', async (t) => {
  useKey(t);
  asAdmin(t);
  const { store, endpoint } = modules();
  t.mock.method(store, 'updateMcpServer', async () => undefined);
  t.mock.method(store, 'deleteMcpServer', async () => false);
  const row = mcpServerRow({ id: SERVER_ID });
  t.mock.method(store, 'getMcpServerRow', async () => row);
  t.mock.method(endpoint, 'testMcpServer', async () => ({ snapshot: { tools: [{ name: 'search' }] }, error: null }));
  const recorded = t.mock.method(store, 'recordMcpServerCheck', async (_db: unknown, _owner: unknown, _id: unknown, outcome: { snapshot: unknown }) =>
    ({ ...row, tools_snapshot: outcome.snapshot, last_checked_at: '2026-10-26T01:00:00Z' }) as McpServerRow);
  const detail = await import('../app/api/admin/agent-mcp/[id]/route');
  assert.equal((await detail.PATCH(request(`/api/admin/agent-mcp/${SERVER_ID}`, { method: 'PATCH', body: { enabled: false } }), params(SERVER_ID))).status, 404);
  assert.equal((await detail.DELETE(request(`/api/admin/agent-mcp/${SERVER_ID}`, { method: 'DELETE' }), params(SERVER_ID))).status, 404);
  assert.equal((await detail.PATCH(request('/api/admin/agent-mcp/not-a-uuid', { method: 'PATCH', body: {} }), params('not-a-uuid'))).status, 400);
  const tester = await import('../app/api/admin/agent-mcp/[id]/test/route');
  const tested = await tester.POST(request(`/api/admin/agent-mcp/${SERVER_ID}/test`, { method: 'POST' }), params(SERVER_ID));
  const body = await tested.json();
  assert.equal(tested.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.server.snapshot, { tools: [{ name: 'search' }] });
  assert.equal(recorded.mock.callCount(), 1);
});

test('the extension policy is saved only in its strict form', async (t) => {
  asAdmin(t);
  const { settings } = modules();
  const saved = t.mock.method(settings, 'setAgentExtensionsPolicy', async () => undefined);
  t.mock.method(settings, 'getAgentExtensionsPolicy', async () => DEFAULT_AGENT_EXTENSIONS_POLICY);
  const route = await import('../app/api/admin/agent-extensions-policy/route');
  assert.deepEqual((await (await route.GET(request('/api/admin/agent-extensions-policy'))).json()).policy, DEFAULT_AGENT_EXTENSIONS_POLICY);
  const invalid = await route.PUT(request('/api/admin/agent-extensions-policy', { method: 'PUT', body: { policy: { connectors: { enabled: true } } } }));
  assert.equal(invalid.status, 400);
  const policy = { ...DEFAULT_AGENT_EXTENSIONS_POLICY, connectors: { enabled: false, tiers: ['pro'], limits: { free: 0, plus: 0, pro: 5 } } };
  const ok = await route.PUT(request('/api/admin/agent-extensions-policy', { method: 'PUT', body: { policy } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(saved.mock.calls[0].arguments[0], policy);
});

test('a member adds connectors only while the policy allows their tier and count', async (t) => {
  useKey(t);
  const { store } = modules();
  const insert = t.mock.method(store, 'insertMcpServer', async (_db: unknown, owner: string | null, fields: Record<string, unknown>, options: { limit?: number }) => {
    assert.equal(owner, 'user-1');
    assert.equal(options.limit, 3);
    return mcpServerRow({ id: SERVER_ID, owner_id: owner, name: fields.name as string, exposure: 'direct' });
  });
  const body = { name: 'notes', displayName: '笔记', url: 'https://mcp.notes.example/mcp', exposure: 'direct' };
  const { GET, POST } = await import('../app/api/user/connectors/route');

  await t.test('free members are refused by tier', async (t) => {
    asMember(t, { membership: 'free' });
    const response = await POST(request('/api/user/connectors', { method: 'POST', body }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /当前会员/);
  });
  await t.test('a closed policy refuses everyone', async (t) => {
    asMember(t, { membership: 'pro', policy: { ...DEFAULT_AGENT_EXTENSIONS_POLICY, connectors: { ...DEFAULT_AGENT_EXTENSIONS_POLICY.connectors, enabled: false } } });
    const response = await POST(request('/api/user/connectors', { method: 'POST', body }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /管理员已关闭/);
  });
  await t.test('a user connector cannot route search or hide behind code mode', async (t) => {
    asMember(t);
    assert.equal((await POST(request('/api/user/connectors', { method: 'POST', body: { ...body, exposure: 'codemode' } }))).status, 400);
    assert.equal((await POST(request('/api/user/connectors', { method: 'POST', body: { ...body, searchTool: 'search' } }))).status, 400);
  });
  await t.test('an allowed member saves within their limit and sees their allowance', async (t) => {
    asMember(t, { used: 1 });
    t.mock.method(store, 'listMcpServerRows', async () => [mcpServerRow({ id: SERVER_ID, owner_id: 'user-1' })]);
    assert.equal((await POST(request('/api/user/connectors', { method: 'POST', body }))).status, 201);
    const listed = await (await GET(request('/api/user/connectors'))).json();
    assert.deepEqual(listed.allowance, { enabled: true, tierAllowed: true, limit: 3, used: 1, tiers: ['plus', 'pro'] });
    assert.equal(listed.servers[0].scope, 'user');
  });
  await t.test('a full allowance is reported as a conflict', async (t) => {
    asMember(t);
    t.mock.method(store, 'insertMcpServer', async () => { throw new store.McpLimitError('最多添加 3 个连接器'); });
    const response = await POST(request('/api/user/connectors', { method: 'POST', body }));
    assert.equal(response.status, 409);
  });
  await t.test('an account switch in another tab is refused', async (t) => {
    asMember(t);
    const response = await POST(request('/api/user/connectors', { method: 'POST', body, headers: { 'X-Expected-User-Id': 'someone-else' } }));
    assert.equal(response.status, 409);
  });
  assert.equal(insert.mock.callCount(), 1);
});

test('a member tests a connector at a bounded rate', async (t) => {
  useKey(t);
  asMember(t);
  const { store, endpoint, rateLimit } = modules();
  t.mock.method(store, 'getMcpServerRow', async () => mcpServerRow({ id: SERVER_ID, owner_id: 'user-1' }));
  const tested = t.mock.method(endpoint, 'testMcpServer', async () => ({ snapshot: null, error: '无法连接外部服务' }));
  t.mock.method(store, 'recordMcpServerCheck', async () => mcpServerRow({ id: SERVER_ID, owner_id: 'user-1', last_error: '无法连接外部服务' }));
  let allowed = true;
  t.mock.method(rateLimit, 'checkRateLimit', async () => ({ allowed, remaining: 0, resetAt: new Date() }));
  const route = await import('../app/api/user/connectors/[id]/test/route');
  const response = await route.POST(request(`/api/user/connectors/${SERVER_ID}/test`, { method: 'POST' }), params(SERVER_ID));
  assert.deepEqual(await response.json().then((body) => [body.ok, 'error' in body, body.server.lastError]), [false, false, '无法连接外部服务'],
    'the reason is the server\'s last error, not a request error');
  allowed = false;
  assert.equal((await route.POST(request(`/api/user/connectors/${SERVER_ID}/test`, { method: 'POST' }), params(SERVER_ID))).status, 429);
  assert.equal(tested.mock.callCount(), 1);
});
