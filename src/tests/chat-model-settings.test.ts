import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { parseNextTaskConfiguration, parseAgentCollaborators } from '../lib/chat/model-settings';
import { PATCH, GET } from '../app/api/conversations/[id]/configuration/route';
import { createMockAuthContext } from './helpers/supabase-mock';

const collaborators = ['first', 'second'].map(id => ({ id, name: id, model: id, focus: '核对盘面', reasoning: true, reasoningEffort: 'max' as const }));
const configuration = { model: 'root', reasoning: true, reasoningEffort: 'xhigh' as const, webEnabled: false, collaborators };

function database(id: string, owner: string) {
  const updates: unknown[] = [], filters: Array<[string, unknown]> = [];
  const client = { from: () => {
    const scope = new Map<string, unknown>();
    const query = { select: () => query, update: (payload: unknown) => { updates.push(payload); return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); scope.set(key, value); return query; },
      maybeSingle: async () => ({ data: scope.get('id') === id && scope.get('user_id') === owner ? { id, next_task_config: configuration } : null, error: null }) };
    return query;
  } };
  return { client, updates, filters };
}

test('model settings validate the whole bounded team and preserve explicit reasoning levels', () => {
  assert.deepEqual(parseNextTaskConfiguration(configuration), configuration);
  // 协作成员 0–4 个：空团队与单成员都合法，重复、超员与超长分工不合法。
  assert.deepEqual(parseAgentCollaborators([]), []);
  assert.deepEqual(parseAgentCollaborators([collaborators[0]]), [collaborators[0]]);
  for (const input of [null, [collaborators[0], collaborators[0]], [...collaborators, ...collaborators, { ...collaborators[0], id: 'fifth' }], [{ ...collaborators[0], focus: 'x'.repeat(1201) }, collaborators[1]]]) assert.throws(() => parseAgentCollaborators(input));
  for (const effort of ['', 'unknown', 0]) assert.throws(() => parseNextTaskConfiguration({ ...configuration, reasoningEffort: effort }));
});

test('conversation model settings persist and read the owner-scoped reasoning and team JSON', async t => {
  const id = randomUUID(), owner = randomUUID();
  const { client, updates, filters } = database(id, owner);
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(client, owner));
  const request = new NextRequest('http://localhost/api/conversations/' + id + '/configuration', { method: 'PATCH', body: JSON.stringify(configuration) });
  assert.equal((await PATCH(request, { params: Promise.resolve({ id }) })).status, 200);
  assert.deepEqual((await (await GET(request, { params: Promise.resolve({ id }) })).json()).configuration, configuration);
  assert.ok(filters.some(([key, value]) => key === 'user_id' && value === owner));
  assert.deepEqual(updates, [{ next_task_config: configuration }]);
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(client, randomUUID()));
  assert.equal((await GET(request, { params: Promise.resolve({ id }) })).status, 404);
});

test('invalid or unauthenticated conversation model settings never write', async t => {
  const id = randomUUID(), { client, updates } = database(id, randomUUID());
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(client, randomUUID()));
  const request = (body: unknown) => new NextRequest('http://localhost/configuration', { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await PATCH(request({ ...configuration, collaborators: [...collaborators, ...collaborators, { ...collaborators[0], id: 'fifth' }] }), { params: Promise.resolve({ id }) })).status, 400);
  t.mock.method(api, 'requireUserContext', async () => ({ error: { message: '登录后使用', status: 401 } }));
  assert.equal((await PATCH(request(configuration), { params: Promise.resolve({ id }) })).status, 401);
  assert.equal(updates.length, 0);
});
