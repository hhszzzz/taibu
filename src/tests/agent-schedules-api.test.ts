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
  t.mock.method(settings, 'getAgentScheduleLimits', async () => ({ free: 1, plus: 5, pro: 20 }));
  t.mock.method(settings, 'setAgentScheduleLimits', async () => {});
  const credits = require('../lib/user/credits') as typeof import('../lib/user/credits');
  t.mock.method(credits, 'getUserCreditInfo', async () => ({ credits: 10, membership: 'plus' as const, expiresAt: null }));
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

test('the route refuses a member at the tier limit and a switched account', async (t) => {
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

test('only an administrator reads and writes the tier limits, with every tier present', async (t) => {
  setup(t);
  const api = require('../lib/agent/schedules/api.server') as typeof import('../lib/agent/schedules/api.server');
  const limits = await api.readScheduleLimits(request('GET'));
  assert.ok(limits);
  assert.deepEqual(await limits.json(), { limits: { free: 1, plus: 5, pro: 20 } });
  const invalid = await api.saveScheduleLimits(request('PUT', { limits: { free: 2, plus: 6 } }));
  assert.ok(invalid);
  assert.equal(invalid.status, 400);
  const saved = await api.saveScheduleLimits(request('PUT', { limits: { free: '2', plus: 6, pro: 30 } }));
  assert.ok(saved);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { limits: { free: 2, plus: 6, pro: 30 } });
});
