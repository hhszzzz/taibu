import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { DEFAULT_AGENT_EXTENSIONS_POLICY, type AgentExtensionsPolicy } from '../lib/agent/extensions/config';
import type { SkillFields } from '../lib/agent/skills/input.server';
import type { SkillRow } from '../lib/agent/skills/store.server';
import { mockAIFeatureState } from './helpers/route-mock';

const SKILL_ID = '00000000-0000-4000-8000-00000000bb01';
const CONTENT = '---\nname: case-review\ndescription: 复盘一个命理案例\n---\n先读命盘，再列要点。';

function modules() {
  return {
    apiUtils: require('../lib/api-utils') as typeof import('../lib/api-utils'),
    context: require('../lib/db/context.server') as typeof import('../lib/db/context.server'),
    store: require('../lib/agent/skills/store.server') as typeof import('../lib/agent/skills/store.server'),
    settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
  };
}

const skillRow = (overrides: Partial<SkillRow> = {}): SkillRow => ({
  id: SKILL_ID, owner_id: null, name: 'case-review', description: '复盘一个命理案例', version: 1,
  is_enabled: true, disable_model_invocation: false, sort_order: 0, created_at: '2026-10-27T00:00:00.000Z',
  updated_at: '2026-10-27T00:00:00.000Z', bytes: 80, files: [], ...overrides,
});

function asAdmin(t: TestContext) {
  const { apiUtils, context, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ user: { id: 'admin-1' } }) as never);
  t.mock.method(context, 'systemDb', () => createMockScopedDb({ scope: { kind: 'system' } }));
  return { invalidated: t.mock.method(store, 'invalidatePlatformSkills', async () => undefined) };
}

function asMember(t: TestContext, options: { policy?: AgentExtensionsPolicy; used?: number; platform?: SkillRow[] } = {}) {
  mockAIFeatureState(t);
  const { apiUtils, settings, store } = modules();
  t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('user-1'));
  t.mock.method(settings, 'getAgentExtensionsPolicy', async () => options.policy ?? DEFAULT_AGENT_EXTENSIONS_POLICY);
  t.mock.method(store, 'countSkills', async () => options.used ?? 0);
  t.mock.method(store, 'platformSkills', async () => options.platform ?? []);
  return { invalidated: t.mock.method(store, 'invalidatePlatformSkills', async () => undefined) };
}

const request = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('administrator skill routes refuse other users before reading anything', async (t) => {
  const { apiUtils, store } = modules();
  t.mock.method(apiUtils, 'requireAdminUser', async () => ({ error: { message: '需要管理员权限', status: 403 } }));
  const listed = t.mock.method(store, 'listSkillRows', async () => []);
  const inserted = t.mock.method(store, 'insertSkill', async () => skillRow());
  const { GET, POST } = await import('../app/api/admin/agent-skills/route');
  assert.equal((await GET(request('/api/admin/agent-skills'))).status, 403);
  assert.equal((await POST(request('/api/admin/agent-skills', { method: 'POST', body: { content: CONTENT } }))).status, 403);
  const detail = await import('../app/api/admin/agent-skills/[id]/route');
  assert.equal((await detail.DELETE(request(`/api/admin/agent-skills/${SKILL_ID}`, { method: 'DELETE' }), params(SKILL_ID))).status, 403);
  assert.equal(listed.mock.callCount() + inserted.mock.callCount(), 0);
});

test('an administrator adds a platform skill with its files, and tasks see it through the shared cache', async (t) => {
  const { invalidated } = asAdmin(t);
  const { store } = modules();
  const insert = t.mock.method(store, 'insertSkill', async (_db: unknown, owner: string | null, fields: Partial<SkillFields>) => {
    assert.equal(owner, null, 'administrators write platform rows');
    assert.deepEqual([fields.document?.name, fields.document?.manualOnly], ['case-review', false]);
    assert.deepEqual(fields.files, [{ path: 'refs/terms.md', content: '术语表' }]);
    return skillRow({ files: [{ path: 'refs/terms.md', bytes: 9 }] });
  });
  const { POST } = await import('../app/api/admin/agent-skills/route');
  const response = await POST(request('/api/admin/agent-skills', { method: 'POST', body: {
    content: CONTENT, files: [{ path: 'refs/terms.md', content: '术语表' }],
  } }));
  assert.equal(response.status, 201);
  const { skill } = await response.json();
  assert.deepEqual([skill.scope, skill.files, skill.shadowed], ['platform', [{ path: 'refs/terms.md', bytes: 9 }], false]);
  assert.equal('requiredTier' in skill, false);
  assert.equal(invalidated.mock.callCount(), 1);

  const bad = await POST(request('/api/admin/agent-skills', { method: 'POST', body: { content: '# 没有 frontmatter' } }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /frontmatter/);
  const traversal = await POST(request('/api/admin/agent-skills', { method: 'POST', body: { content: CONTENT, files: [{ path: '../../etc/passwd', content: 'x' }] } }));
  assert.equal(traversal.status, 400);
  assert.equal(insert.mock.callCount(), 1);
});

test('administrator edits, reads and deletions report missing skills and refuse malformed IDs', async (t) => {
  const { invalidated } = asAdmin(t);
  const { store } = modules();
  t.mock.method(store, 'updateSkill', async () => undefined);
  t.mock.method(store, 'deleteSkill', async () => false);
  t.mock.method(store, 'getSkillDetailRow', async () => ({ ...skillRow(), content: CONTENT }));
  const detail = await import('../app/api/admin/agent-skills/[id]/route');
  assert.equal((await detail.PATCH(request(`/api/admin/agent-skills/${SKILL_ID}`, { method: 'PATCH', body: { enabled: false } }), params(SKILL_ID))).status, 404);
  assert.equal((await detail.DELETE(request(`/api/admin/agent-skills/${SKILL_ID}`, { method: 'DELETE' }), params(SKILL_ID))).status, 404);
  assert.equal((await detail.PATCH(request('/api/admin/agent-skills/not-a-uuid', { method: 'PATCH', body: {} }), params('not-a-uuid'))).status, 400);
  assert.equal(invalidated.mock.callCount(), 0, 'nothing changed');
  const read = await detail.GET(request(`/api/admin/agent-skills/${SKILL_ID}`), params(SKILL_ID));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).skill.content, CONTENT);
});

test('a member adds skills only while the policy allows them and their count', async (t) => {
  const { store } = modules();
  const insert = t.mock.method(store, 'insertSkill', async (_db: unknown, owner: string | null, fields: Partial<SkillFields>, options: { limit?: number }) => {
    assert.equal(owner, 'user-1');
    assert.equal(options.limit, DEFAULT_AGENT_EXTENSIONS_POLICY.skills.limit, 'the default allowance');
    assert.equal(fields.document?.name, 'case-review');
    return skillRow({ owner_id: owner });
  });
  const body = { content: CONTENT };
  const { GET, POST } = await import('../app/api/user/skills/route');

  await t.test('a closed policy refuses everyone', async (t) => {
    asMember(t, { policy: { ...DEFAULT_AGENT_EXTENSIONS_POLICY, skills: { ...DEFAULT_AGENT_EXTENSIONS_POLICY.skills, enabled: false } } });
    const response = await POST(request('/api/user/skills', { method: 'POST', body }));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /管理员已关闭/);
  });
  await t.test('a zero limit refuses like a closed policy', async (t) => {
    asMember(t, { policy: { ...DEFAULT_AGENT_EXTENSIONS_POLICY, skills: { enabled: true, limit: 0 } } });
    const response = await POST(request('/api/user/skills', { method: 'POST', body }));
    assert.equal(response.status, 403);
  });
  await t.test('an allowed member saves within their limit and sees their allowance', async (t) => {
    asMember(t, { used: 1, platform: [skillRow({ id: 'platform-1', name: 'shared-name' })] });
    t.mock.method(store, 'listSkillRows', async () => [skillRow({ owner_id: 'user-1' }), skillRow({ id: 'own-2', owner_id: 'user-1', name: 'shared-name' })]);
    assert.equal((await POST(request('/api/user/skills', { method: 'POST', body }))).status, 201);
    const listed = await (await GET(request('/api/user/skills'))).json();
    assert.deepEqual(listed.allowance, { enabled: true, limit: DEFAULT_AGENT_EXTENSIONS_POLICY.skills.limit, used: 1 });
    assert.deepEqual(listed.skills.map((skill: { scope: string; shadowed: boolean }) => [skill.scope, skill.shadowed]), [['user', false], ['user', true]],
      'a user\'s skill named like a platform skill is marked as kept out of tasks');
  });
  await t.test('a full allowance is reported as a conflict', async (t) => {
    asMember(t);
    t.mock.method(store, 'insertSkill', async () => { throw new store.SkillLimitError('最多添加 3 个技能'); });
    const response = await POST(request('/api/user/skills', { method: 'POST', body }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /最多添加 3 个技能/);
  });
  await t.test('a platform skill\'s name is reserved', async (t) => {
    asMember(t, { platform: [skillRow({ id: 'platform-1' })] });
    const response = await POST(request('/api/user/skills', { method: 'POST', body }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /平台已有名为「case-review」的技能/);
  });
  await t.test('an account switch in another tab is refused', async (t) => {
    asMember(t);
    const response = await POST(request('/api/user/skills', { method: 'POST', body, headers: { 'X-Expected-User-Id': 'someone-else' } }));
    assert.equal(response.status, 409);
  });
  await t.test('an edit cannot rename a skill to a platform skill\'s name, and other changes go through', async (t) => {
    asMember(t, { platform: [skillRow({ id: 'platform-1' })] });
    const updated = t.mock.method(store, 'updateSkill', async () => skillRow({ owner_id: 'user-1', is_enabled: false }));
    const detail = await import('../app/api/user/skills/[id]/route');
    const renamed = await detail.PATCH(request(`/api/user/skills/${SKILL_ID}`, { method: 'PATCH', body: { content: CONTENT } }), params(SKILL_ID));
    assert.equal(renamed.status, 400);
    assert.match((await renamed.json()).error, /平台已有名为「case-review」的技能/);
    const disabled = await detail.PATCH(request(`/api/user/skills/${SKILL_ID}`, { method: 'PATCH', body: { enabled: false } }), params(SKILL_ID));
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json()).skill.enabled, false);
    assert.equal(updated.mock.callCount(), 1);
  });
  assert.equal(insert.mock.callCount(), 1);
});

test('the slash menu lists the member\'s skills, and none while the Agent is off', async (t) => {
  asMember(t, { platform: [skillRow()] });
  const { settings, store } = modules();
  t.mock.method(store, 'userSkills', async () => []);
  let agent: 'enabled' | 'disabled' = 'disabled';
  t.mock.method(settings, 'readFeatureModuleStateFresh', async (id: string) => ({ status: id === 'agent' ? agent : 'enabled' as const }));
  const { GET } = await import('../app/api/agent/skills/route');
  assert.deepEqual(await (await GET(request('/api/agent/skills'))).json(), { skills: [] });
  agent = 'enabled';
  assert.deepEqual(await (await GET(request('/api/agent/skills'))).json(), { skills: [{ name: 'case-review', description: '复盘一个命理案例', scope: 'platform' }] });
});
