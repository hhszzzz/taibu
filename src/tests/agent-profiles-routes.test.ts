import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { BUILTIN_AGENT_PROFILES, type AgentProfileView } from '../lib/agent/profiles/config';
import { ProfileInputError, type ProfileFields } from '../lib/agent/profiles/input.server';

function modules() {
  return {
    apiUtils: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    context: require('../lib/db/context.server') as typeof import('../lib/db/context.server'),
    store: require('../lib/agent/profiles/store.server') as typeof import('../lib/agent/profiles/store.server'),
    aiConfig: require('../lib/server/ai-config') as typeof import('../lib/server/ai-config'),
    mcpStore: require('../lib/agent/mcp/store.server') as typeof import('../lib/agent/mcp/store.server'),
    skillStore: require('../lib/agent/skills/store.server') as typeof import('../lib/agent/skills/store.server'),
    settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
  };
}

const archivist = (overrides: Partial<AgentProfileView> = {}): AgentProfileView => ({
  name: 'archivist', builtin: false, displayName: '档案员', description: '整理资料', instructions: '', tools: { inherit: false, allow: ['web'], deny: [] },
  skills: [], model: null, reasoningEffort: null, modes: ['parallel', 'background'], enabled: true, sortOrder: 0,
  updatedAt: '2026-10-27T00:00:00.000Z', ...overrides,
});

function asAdmin(t: TestContext, catalog: AgentProfileView[] = [...BUILTIN_AGENT_PROFILES]) {
  const { apiUtils, context, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }) as never);
  t.mock.method(context, 'systemDb', () => createMockScopedDb({ scope: { kind: 'system' } }));
  t.mock.method(store, 'profileCatalog', async () => catalog);
  return { invalidated: t.mock.method(store, 'invalidateProfileCatalog', async () => undefined) };
}

const request = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { 'Content-Type': 'application/json' },
  });
const params = (name: string) => ({ params: Promise.resolve({ name }) });

test('administrator role routes refuse other users before reading anything', async (t) => {
  const { apiUtils, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ error: { message: '需要管理员权限', status: 403 } }));
  const read = t.mock.method(store, 'profileCatalog', async () => []);
  const inserted = t.mock.method(store, 'insertProfile', async () => archivist());
  const removed = t.mock.method(store, 'deleteProfile', async () => true);
  const { GET, POST } = await import('../app/api/admin/agent-profiles/route');
  const detail = await import('../app/api/admin/agent-profiles/[name]/route');
  assert.equal((await GET(request('/api/admin/agent-profiles'))).status, 403);
  assert.equal((await POST(request('/api/admin/agent-profiles', { method: 'POST', body: { name: 'archivist', displayName: '档案员' } }))).status, 403);
  assert.equal((await detail.PATCH(request('/api/admin/agent-profiles/archivist', { method: 'PATCH', body: { enabled: false } }), params('archivist'))).status, 403);
  assert.equal((await detail.DELETE(request('/api/admin/agent-profiles/archivist', { method: 'DELETE' }), params('archivist'))).status, 403);
  assert.equal(read.mock.callCount() + inserted.mock.callCount() + removed.mock.callCount(), 0);
});

test('an administrator lists the roles with the services, skills and models a role may name', async (t) => {
  asAdmin(t, [...BUILTIN_AGENT_PROFILES, archivist()]);
  const { aiConfig, mcpStore, skillStore } = modules();
  t.mock.method(mcpStore, 'platformMcpServers', async () => [
    { name: 'exa', display_name: 'Exa', is_enabled: true, exposure: 'hidden' },
    { name: 'notes', display_name: '笔记', is_enabled: false, exposure: 'deferred' },
  ] as never);
  t.mock.method(skillStore, 'platformSkills', async () => [{ name: 'case-review', description: '复盘', is_enabled: true }] as never);
  t.mock.method(aiConfig, 'getModelsByUsageTypeAsync', async () => [
    { id: 'model-b', name: '模型 B', supportsReasoning: true, thinkingLevels: ['low', 'high'], apiKey: 'sk-never-sent' },
    { id: 'model-c', name: '模型 C', supportsReasoning: false },
  ] as never);
  const { GET } = await import('../app/api/admin/agent-profiles/route');
  const response = await GET(request('/api/admin/agent-profiles'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.profiles.map((profile: AgentProfileView) => [profile.name, profile.builtin]),
    [['specialist', true], ['researcher', true], ['verifier', true], ['archivist', false]]);
  assert.deepEqual(body.servers, [{ name: 'notes', displayName: '笔记', enabled: false }], 'a search-only service has no tools to grant');
  assert.deepEqual(body.skills, [{ name: 'case-review', description: '复盘', enabled: true }]);
  assert.deepEqual(body.models, [
    { id: 'model-b', name: '模型 B', supportsReasoning: true, thinkingLevels: ['low', 'high'] },
    { id: 'model-c', name: '模型 C', supportsReasoning: false, thinkingLevels: [] },
  ]);
});

test('an administrator adds a role whose model the site serves, and a taken name is refused', async (t) => {
  const { invalidated } = asAdmin(t);
  const { store, aiConfig } = modules();
  t.mock.method(aiConfig, 'getModelConfigAsync', async (id: string) => (id === 'model-b' ? { id } : null) as never);
  let taken = false;
  const insert = t.mock.method(store, 'insertProfile', async (_db: unknown, fields: ProfileFields & { name: string }) => {
    if (taken) throw new ProfileInputError('已有同名角色，请换一个标识');
    taken = true;
    assert.deepEqual([fields.name, fields.displayName, fields.model, fields.tools], ['archivist', '档案员', 'model-b', { inherit: false, allow: ['web'], deny: [] }]);
    return archivist({ model: 'model-b' });
  });
  const { POST } = await import('../app/api/admin/agent-profiles/route');
  const body = { name: 'archivist', displayName: '档案员', model: 'model-b', tools: { inherit: false, allow: ['web'], deny: [] } };
  const created = await POST(request('/api/admin/agent-profiles', { method: 'POST', body }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).profile.model, 'model-b');
  assert.equal(invalidated.mock.callCount(), 1, 'running tasks read the new role through the shared cache');

  const again = await POST(request('/api/admin/agent-profiles', { method: 'POST', body }));
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /同名角色/);
  const unknownModel = await POST(request('/api/admin/agent-profiles', { method: 'POST', body: { ...body, name: 'scribe', model: 'gone' } }));
  assert.equal(unknownModel.status, 400);
  assert.match((await unknownModel.json()).error, /模型不存在/);
  const reserved = await POST(request('/api/admin/agent-profiles', { method: 'POST', body: { ...body, name: 'verifier' } }));
  assert.equal(reserved.status, 400);
  const mainOnly = await POST(request('/api/admin/agent-profiles', { method: 'POST', body: { ...body, name: 'planner', tools: { inherit: true, allow: ['submit_plan'] } } }));
  assert.equal(mainOnly.status, 400);
  assert.match((await mainOnly.json()).error, /只有主任务能用/);
  assert.equal(insert.mock.callCount(), 2);
  assert.equal(invalidated.mock.callCount(), 1);
});

test('built-in roles are only switched on or off, and the specialist stays on', async (t) => {
  const { invalidated } = asAdmin(t);
  const { store } = modules();
  const switched = t.mock.method(store, 'setBuiltinProfileEnabled', async () => undefined);
  const updated = t.mock.method(store, 'updateProfile', async () => undefined);
  const removed = t.mock.method(store, 'deleteProfile', async () => true);
  const detail = await import('../app/api/admin/agent-profiles/[name]/route');
  const patch = (name: string, body: unknown) => detail.PATCH(request(`/api/admin/agent-profiles/${name}`, { method: 'PATCH', body }), params(name));

  const off = await patch('researcher', { enabled: false });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).profile.name, 'researcher');
  assert.deepEqual(switched.mock.calls.map(call => call.arguments), [['researcher', false]]);
  const specialist = await patch('specialist', { enabled: false });
  assert.equal(specialist.status, 400);
  assert.match((await specialist.json()).error, /默认角色，不能停用/);
  assert.equal((await patch('verifier', { enabled: true, instructions: '改写' })).status, 400, 'a built-in role keeps its definition');
  const builtinDelete = await detail.DELETE(request('/api/admin/agent-profiles/verifier', { method: 'DELETE' }), params('verifier'));
  assert.equal(builtinDelete.status, 400);
  assert.match((await builtinDelete.json()).error, /内置角色不能删除/);
  assert.equal(switched.mock.callCount(), 1);
  assert.equal(updated.mock.callCount() + removed.mock.callCount(), 0);
  assert.equal(invalidated.mock.callCount(), 0, 'switching a built-in role invalidates inside the store');
});

test('custom role edits and deletions report missing roles and refuse malformed names', async (t) => {
  const { invalidated } = asAdmin(t);
  const { store } = modules();
  const updated = t.mock.method(store, 'updateProfile', async (_db: unknown, name: string, fields: Partial<ProfileFields>) =>
    name === 'archivist' ? archivist(fields as Partial<AgentProfileView>) : undefined);
  t.mock.method(store, 'deleteProfile', async (_db: unknown, name: string) => name === 'archivist');
  const detail = await import('../app/api/admin/agent-profiles/[name]/route');
  const edited = await detail.PATCH(request('/api/admin/agent-profiles/archivist', { method: 'PATCH', body: { enabled: false, modes: ['background'] } }), params('archivist'));
  assert.equal(edited.status, 200);
  assert.deepEqual(updated.mock.calls[0].arguments.slice(1), ['archivist', { enabled: false, modes: ['background'] }], 'an edit carries only what changed');
  assert.equal((await detail.PATCH(request('/api/admin/agent-profiles/scribe', { method: 'PATCH', body: { enabled: false } }), params('scribe'))).status, 404);
  assert.equal((await detail.DELETE(request('/api/admin/agent-profiles/scribe', { method: 'DELETE' }), params('scribe'))).status, 404);
  assert.equal((await detail.DELETE(request('/api/admin/agent-profiles/archivist', { method: 'DELETE' }), params('archivist'))).status, 200);
  assert.equal((await detail.PATCH(request('/api/admin/agent-profiles/Bad_Name', { method: 'PATCH', body: {} }), params('Bad_Name'))).status, 400);
  assert.equal(invalidated.mock.callCount(), 2, 'the edit and the deletion');
});

test('a member reads the roles they may give a collaboration member', async (t) => {
  const { apiUtils, store, settings } = modules();
  t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('user-1'));
  t.mock.method(store, 'profileCatalog', async () => [
    ...BUILTIN_AGENT_PROFILES.map(profile => profile.name === 'verifier' ? { ...profile, enabled: false } : profile),
    archivist({ model: 'model-b' }), archivist({ name: 'retired', enabled: false }), archivist({ name: 'solo', modes: ['background'] }),
  ]);
  let agent = 'disabled';
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: agent }) as never);
  const { GET } = await import('../app/api/agent/profiles/route');
  assert.deepEqual((await (await GET(request('/api/agent/profiles'))).json()).profiles, [], 'no roles while the Agent is off');
  agent = 'enabled';
  const { profiles } = await (await GET(request('/api/agent/profiles'))).json();
  assert.deepEqual(profiles.map((profile: { name: string }) => profile.name), ['specialist', 'researcher', 'archivist']);
  assert.deepEqual(profiles[2], { name: 'archivist', displayName: '档案员', description: '整理资料', model: 'model-b', modes: ['parallel', 'background'] },
    'a member sees what a role is for, not its instructions or tools');
});
