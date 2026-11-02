import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';
import { mockAIFeatureState } from './helpers/route-mock';

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/agent/schedules', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setup(t: TestContext, options: { used?: number } = {}) {
  mockAIFeatureState(t);
  const userId = randomUUID();
  let created: Record<string, unknown> | null = null;
  const db = createMockScopedDb({
    scope: { kind: 'user', userId },
    tx: async (work: (trx: never) => unknown) => work({
      selectFrom() {
        const query = {
          select(callback?: (builder: unknown) => unknown) {
            callback?.({ fn: { countAll: () => ({ as: () => ({}) }) } });
            return query;
          },
          where() { return query; },
          async executeTakeFirst() { return { count: String(options.used ?? 0) }; },
          async execute() { return []; },
        };
        return query;
      },
    } as never),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'create_agent_schedule') throw new Error(`unexpected rpc ${name}`);
      created = {
        id: randomUUID(), user_id: userId, name: args.p_name, template: args.p_template,
        prompt: args.p_prompt, cadence: args.p_cadence, timezone: args.p_timezone, conversation_id: randomUUID(),
        options: args.p_options, enabled: true, next_run_at: '2026-10-29T00:00:00Z', last_run_at: null,
        last_status: null, consecutive_failures: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      };
      return created;
    },
  });
  const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
  t.mock.method(api, 'requireUserContext', async () => createMockAuthContext(userId, db));
  t.mock.method(api, 'requireAdminUser', async () => ({ ...createMockAuthContext(userId, db), user: { ...createMockAuthContext(userId, db).user, isAdmin: true } }) as never);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  t.mock.method(settings, 'getAgentScheduleLimits', async () => ({ limit: 5 }));
  t.mock.method(settings, 'setAgentScheduleLimits', async () => {});
  return { userId, db, created: () => created };
}

test('a member creates a schedule through the route with the parsed body', async (t) => {
  const fixture = setup(t);
  const api = require('../lib/agent/schedules/api.server') as typeof import('../lib/agent/schedules/api.server');
  const response = await api.createSchedule(request('POST', {
    name: '晨间整理', prompt: '整理 {{date}} 的重点。', cadence: { kind: 'daily', time: '08:00' }, timezone: 'Asia/Shanghai',
  }));
  assert.ok(response);
  assert.equal(response.status, 201);
  const payload = await response.json() as { schedule: { name: string; cadence: unknown }; allowance: { used: number } };
  assert.equal(payload.schedule.name, '晨间整理');
  assert.deepEqual(payload.schedule.cadence, { kind: 'daily', time: '08:00' });
  assert.equal(payload.allowance.used, 0);
  assert.ok(fixture.created());
});

test('a schedule may name an own model only when its key is stored here', async (t) => {
  const fixture = setup(t);
  const settings = require('../lib/app-settings') as typeof import('../lib/app-settings');
  const store = require('../lib/byok/store.server') as typeof import('../lib/byok/store.server');
  const ref = 'byok:00000000-0000-4000-8000-0000000000b1';
  let serverKey = false;
  t.mock.method(settings, 'getByokPolicy', async () => ({ allowServerKeys: true, maxConnections: 10, maxModelsPerConnection: 50 }));
  t.mock.method(store, 'resolveByokModels', async () => new Map([[ref, {
    id: '00000000-0000-4000-8000-0000000000b1', ref, modelId: 'deepseek-chat', displayName: 'DeepSeek', usage: 'chat', supportsVision: false,
    thinkingLevels: [], defaultEffort: 'auto', contextWindow: null, maxOutput: null,
    connection: { id: '00000000-0000-4000-8000-0000000000c1', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: serverKey ? 'sk-…ored' : null, updatedAt: '' },
    serverKey, openKey: () => null,
  } as never]]));
  const api = require('../lib/agent/schedules/api.server') as typeof import('../lib/agent/schedules/api.server');
  const body = { name: '晨间整理', prompt: '内容', cadence: { kind: 'daily', time: '08:00' }, timezone: 'Asia/Shanghai', options: { model: ref } };
  const refused = await api.createSchedule(request('POST', body));
  assert.equal(refused?.status, 400);
  assert.match((await refused!.json()).error, /浏览器/u);
  assert.equal(fixture.created(), null);
  serverKey = true;
  assert.equal((await api.createSchedule(request('POST', body)))?.status, 201);
});

test('the route refuses a member at the limit and a switched account', async (t) => {
  setup(t, { used: 5 });
  const api = require('../lib/agent/schedules/api.server') as typeof import('../lib/agent/schedules/api.server');
  const limited = await api.createSchedule(request('POST', {
    name: '超额', prompt: '内容', cadence: { kind: 'daily', time: '08:00' }, timezone: 'Asia/Shanghai',
  }));
  assert.ok(limited);
  assert.equal(limited.status, 409);

  const switched = new NextRequest('http://localhost/api/agent/schedules', {
    method: 'POST', headers: { 'X-Expected-User-Id': 'another-user' },
    body: JSON.stringify({ name: '账号', prompt: '内容', cadence: { kind: 'daily', time: '08:00' }, timezone: 'Asia/Shanghai' }),
  });
  const switchedResponse = await api.createSchedule(switched);
  assert.ok(switchedResponse);
  assert.equal(switchedResponse.status, 409);
});

test('only an administrator reads and writes the single limit, in range', async (t) => {
  setup(t);
  const api = require('../lib/agent/schedules/api.server') as typeof import('../lib/agent/schedules/api.server');
  const limits = await api.readScheduleLimits(request('GET'));
  assert.ok(limits);
  assert.deepEqual(await limits.json(), { limits: { limit: 5 } });
  for (const body of [{ limits: { free: 2, plus: 6, pro: 30 } }, { limits: { limit: 101 } }, { limits: { limit: 1.5 } }, { limit: 3 }]) {
    const invalid = await api.saveScheduleLimits(request('PUT', body));
    assert.ok(invalid);
    assert.equal(invalid.status, 400, JSON.stringify(body));
  }
  const saved = await api.saveScheduleLimits(request('PUT', { limits: { limit: '30' } }));
  assert.ok(saved);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { limits: { limit: 30 } });
});
