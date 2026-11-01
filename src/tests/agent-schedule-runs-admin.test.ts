import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { parseAgentScheduleRunAdminFilters } from '../lib/agent/admin-schedule-runs';

function setup(t: TestContext) {
  const api = require('../lib/api-utils') as any;
  const server = require('../lib/agent/admin-schedule-runs.server') as any;
  const state = {
    admin: true as boolean,
    page: { runs: [], nextOffset: null, counts: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 } },
    fail: false,
    calls: [] as unknown[],
  };
  const originals = { requireAdminUser: api.requireAdminUser, list: server.listAgentScheduleRunsForAdmin };
  api.requireAdminUser = async () => (state.admin ? { user: { id: 'admin-1' } } : { error: { message: '无权限操作', status: 403 } });
  server.listAgentScheduleRunsForAdmin = async (filters: unknown, page: unknown) => {
    state.calls.push({ filters, page });
    if (state.fail) throw new Error('db down');
    return state.page;
  };
  t.after(() => {
    api.requireAdminUser = originals.requireAdminUser;
    server.listAgentScheduleRunsForAdmin = originals.list;
  });
  return { state, route: require('../app/api/admin/agent-schedules/runs/route') as typeof import('../app/api/admin/agent-schedules/runs/route') };
}

const get = (query = '') => new NextRequest(`http://localhost/api/admin/agent-schedules/runs${query}`);

test('the schedule runs list is for administrators and validates its filters', async (t) => {
  const { state, route } = setup(t);
  state.admin = false;
  assert.equal((await route.GET(get())).status, 403);
  state.admin = true;

  for (const query of ['?status=unknown', `?email=${'a'.repeat(255)}`, '?from=yesterday']) {
    assert.equal((await route.GET(get(query))).status, 400, query);
  }
  assert.deepEqual(state.calls, []);
});

test('the schedule runs list forwards filters, pagination and the status counts', async (t) => {
  const { state, route } = setup(t);
  const response = await route.GET(get('?status=failed&email=Alice%40Example.com&from=2026-01-01T00%3A00%3A00Z&to=2026-02-01T00%3A00%3A00Z&offset=10&limit=5'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), state.page);
  assert.deepEqual(state.calls, [{
    filters: {
      status: 'failed', email: 'alice@example.com',
      from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z',
    },
    page: { offset: 10, limit: 5 },
  }]);

  await route.GET(get('?offset=0'));
  assert.deepEqual(state.calls.at(-1), { filters: {}, page: { offset: 0, limit: 50 } });
});

test('a failed query is reported without leaking the database error', async (t) => {
  const { state, route } = setup(t);
  state.fail = true;
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalConsoleError; });
  const response = await route.GET(get());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: '读取定时任务记录失败', success: false });
});

test('schedule run filters accept only known statuses and ISO instants', () => {
  assert.deepEqual(parseAgentScheduleRunAdminFilters(new URLSearchParams()), {});
  assert.deepEqual(parseAgentScheduleRunAdminFilters(new URLSearchParams({ status: 'completed', email: ' A@B.C ', to: '2026-03-01T00:00:00Z' })), {
    status: 'completed', email: 'a@b.c', to: '2026-03-01T00:00:00.000Z',
  });
  assert.deepEqual(parseAgentScheduleRunAdminFilters(new URLSearchParams({ status: 'done' })), { error: '状态无效' });
  assert.deepEqual(parseAgentScheduleRunAdminFilters(new URLSearchParams({ email: `${'x'.repeat(254)}@a.b` })), { error: '邮箱过长' });
  assert.deepEqual(parseAgentScheduleRunAdminFilters(new URLSearchParams({ from: 'soon' })), { error: '时间范围无效' });
});
