import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { freshTaskConfiguration, parseNextTaskConfiguration, parseAgentCollaborators } from '../lib/chat/model-settings';
import { PATCH, GET } from '../app/api/conversations/[id]/configuration/route';
import { createMockAuthContext } from './helpers/auth-mock';

const collaborators = ['first', 'second'].map(id => ({ id, name: id, model: id, focus: '核对盘面', reasoning: true, reasoningEffort: 'max' as const }));
const configuration = { model: 'root', reasoning: true, reasoningEffort: 'xhigh' as const, webEnabled: false, codeMode: true, planMode: true, collaborators };

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('toOperationNode' in value)) return value;
  const node = (value as { toOperationNode(): { parameters?: { value?: unknown }[] } }).toOperationNode();
  const parameter = node.parameters?.[0]?.value;
  return typeof parameter === 'string' ? JSON.parse(parameter) : value;
}

function database(id: string, owner: string) {
  const updates: unknown[] = [], filters: Array<[string, unknown]> = [];
  const table = () => {
    const scope = new Map<string, unknown>();
    const result = () => (scope.get('id') === id && scope.get('user_id') === owner ? { id, next_task_config: configuration } : null);
    const query = {
      select: () => query,
      where: (key: string, _operator: string, value: unknown) => { filters.push([key, value]); scope.set(key, value); return query; },
      set: (payload: Record<string, unknown>) => {
        updates.push(Object.fromEntries(Object.entries(payload).map(([key, entry]) => [key, unwrap(entry)])));
        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => result(),
      execute: async () => { const row = result(); return row ? [row] : []; },
    };
    return query;
  };
  const scoped = {
    scope: { kind: 'user' as const, userId: owner },
    tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: table, updateTable: table, insertInto: table, deleteFrom: table }),
    rpc: async () => { throw new Error('unexpected rpc'); },
  };
  return { scoped, updates, filters };
}

test('model settings validate the whole bounded team and preserve explicit reasoning levels', () => {
  assert.deepEqual(parseNextTaskConfiguration(configuration), configuration);
  // 协作成员 0–4 个：空团队与单成员都合法，重复、超员与超长分工不合法。
  assert.deepEqual(parseAgentCollaborators([]), []);
  assert.deepEqual(parseAgentCollaborators([collaborators[0]]), [collaborators[0]]);
  for (const input of [null, [collaborators[0], collaborators[0]], [...collaborators, ...collaborators, { ...collaborators[0], id: 'fifth' }], [{ ...collaborators[0], focus: 'x'.repeat(1201) }, collaborators[1]]]) assert.throws(() => parseAgentCollaborators(input));
  for (const effort of ['', 'unknown', 0]) assert.throws(() => parseNextTaskConfiguration({ ...configuration, reasoningEffort: effort }));
  // 代码模式与计划模式缺省为关闭，保存了非布尔值则整份配置无效。
  const unsaved: Record<string, unknown> = { ...configuration };
  delete unsaved.codeMode;
  delete unsaved.planMode;
  assert.equal(parseNextTaskConfiguration(unsaved).codeMode, false);
  assert.equal(parseNextTaskConfiguration(unsaved).planMode, false);
  for (const codeMode of ['true', 1, null]) assert.throws(() => parseNextTaskConfiguration({ ...configuration, codeMode }));
  for (const planMode of ['true', 1, null]) assert.throws(() => parseNextTaskConfiguration({ ...configuration, planMode }));
});

test('conversation model settings persist and read the owner-scoped reasoning and team JSON', async t => {
  const id = randomUUID(), owner = randomUUID();
  const { scoped, updates, filters } = database(id, owner);
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(owner, scoped as never));
  const request = new NextRequest('http://localhost/api/conversations/' + id + '/configuration', { method: 'PATCH', body: JSON.stringify(configuration) });
  assert.equal((await PATCH(request, { params: Promise.resolve({ id }) })).status, 200);
  assert.deepEqual((await (await GET(request, { params: Promise.resolve({ id }) })).json()).configuration, configuration);
  assert.ok(filters.some(([key, value]) => key === 'user_id' && value === owner));
  assert.deepEqual(updates, [{ next_task_config: configuration }]);
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(randomUUID(), scoped as never));
  assert.equal((await GET(request, { params: Promise.resolve({ id }) })).status, 404);
});

test('invalid or unauthenticated conversation model settings never write', async t => {
  const id = randomUUID(), { scoped, updates } = database(id, randomUUID());
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(randomUUID(), scoped as never));
  const request = (body: unknown) => new NextRequest('http://localhost/configuration', { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await PATCH(request({ ...configuration, collaborators: [...collaborators, ...collaborators, { ...collaborators[0], id: 'fifth' }] }), { params: Promise.resolve({ id }) })).status, 400);
  t.mock.method(api, 'requireUserContext', async () => ({ error: { message: '登录后使用', status: 401 } }));
  assert.equal((await PATCH(request(configuration), { params: Promise.resolve({ id }) })).status, 401);
  assert.equal(updates.length, 0);
});

test('a new conversation keeps model, reasoning, web and code mode choices but never inherits collaborators', () => {
  const fresh = freshTaskConfiguration(configuration);
  assert.deepEqual(fresh, { ...configuration, collaborators: [] });
  assert.equal(configuration.collaborators.length, 2, 'the source configuration is not mutated');
});
