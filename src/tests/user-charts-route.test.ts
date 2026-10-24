import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';
import { createMockAuthContext } from './helpers/auth-mock';


type ChartRecord = {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  birth_date: string;
  birth_time: string | null;
  birth_place?: string | null;
  longitude?: number | null;
  created_at?: string;
};

test('chart bundle and CRUD handlers reject an expected-user mismatch before any database call', async (t) => {
  const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
  let databaseCalls = 0;
  const unexpected = async () => { databaseCalls += 1; throw new Error('must not access the database'); };
  t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('bob', createMockScopedDb({
    tx: unexpected, rpc: unexpected,
  })));
  const bundle = await import('../app/api/user/charts/route');
  const crud = await import('../lib/api/chart-crud');
  const handlers: Array<(request: NextRequest) => Promise<Response>> = [bundle.GET, bundle.PATCH, bundle.DELETE];
  for (const tableName of ['bazi_charts', 'ziwei_charts']) {
    handlers.push(crud.createChartGetHandler({ tableName }));
    handlers.push(crud.createChartPostHandler({ tableName }));
    handlers.push(crud.createChartUpdateHandler({ tableName }));
  }
  for (const handler of handlers) {
    for (const expected of ['alice', '']) {
      const response = await handler(new NextRequest('http://localhost/api/user/charts', {
        headers: { 'X-Expected-User-Id': expected },
      }));
      assert.equal(response.status, 409);
    }
  }
  assert.equal(databaseCalls, 0);
});

type ChartBundle = {
  bazi?: ChartRecord[];
  ziwei?: ChartRecord[];
  settings?: Record<string, unknown> | null;
  updates?: Array<Record<string, unknown>>;
  deleted?: string[];
  chartRow?: Record<string, unknown>;
};

function bundleScope(bundle: ChartBundle) {
  return createMockScopedDb({
    tx: async (work) => work({
      selectFrom(table: string) {
        const query = {
          select() { return query; },
          where() { return query; },
          orderBy() { return query; },
          limit() { return query; },
          async executeTakeFirst() {
            if (table === 'user_settings') return bundle.settings ?? undefined;
            return bundle.chartRow;
          },
          async execute() {
            if (table === 'bazi_charts') return bundle.bazi ?? [];
            if (table === 'ziwei_charts') return bundle.ziwei ?? [];
            return [];
          },
        };
        return query;
      },
      insertInto() {
        const query = {
          values(payload: Record<string, unknown>) {
            bundle.updates?.push(payload);
            return query;
          },
          onConflict(callback: (conflict: { column: () => { doUpdateSet: () => unknown } }) => unknown) {
            callback({ column: () => ({ doUpdateSet: () => undefined }) });
            return query;
          },
          returning() { return query; },
          async executeTakeFirst() {
            const payload = bundle.updates?.[bundle.updates.length - 1] ?? {};
            return {
              default_bazi_chart_id: payload.default_bazi_chart_id ?? null,
              default_ziwei_chart_id: payload.default_ziwei_chart_id ?? null,
            };
          },
          async execute() { return []; },
        };
        return query;
      },
      deleteFrom(table: string) {
        const query = {
          where() { return query; },
          returning() { return query; },
          async execute() {
            bundle.deleted?.push(table);
            return [{ id: 'ziwei-9' }];
          },
        };
        return query;
      },
    } as never),
  });
}

test('user charts GET aggregates bazi and ziwei charts through a single user API', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;
  const scoped = bundleScope({
    bazi: [{
      id: 'bazi-1',
      name: '八字一号',
      gender: 'male',
      birth_date: '1990-01-01',
      birth_time: '08:00',
      birth_place: '上海',
      created_at: '2026-03-01T00:00:00.000Z',
    }],
    ziwei: [{
      id: 'ziwei-1',
      name: '紫微一号',
      gender: 'female',
      birth_date: '1992-02-02',
      birth_time: '10:30',
      birth_place: '杭州',
      longitude: 120.1551,
      created_at: '2026-03-02T00:00:00.000Z',
    }],
    settings: { default_bazi_chart_id: 'bazi-1', default_ziwei_chart_id: 'ziwei-1' },
  });

  apiUtils.requireUserContext = (async () => createMockAuthContext(
    'user-1', scoped,
  )) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
  });

  const { GET } = await import('../app/api/user/charts/route');
  const response = await GET(new NextRequest('http://localhost/api/user/charts'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.baziCharts.length, 1);
  assert.equal(payload.baziCharts[0].id, 'bazi-1');
  assert.equal(payload.ziweiCharts.length, 1);
  assert.equal(payload.defaultChartIds.bazi, 'bazi-1');
  assert.equal(payload.defaultChartIds.ziwei, 'ziwei-1');
});

test('user charts PATCH updates default chart through user_settings', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;
  const updates: Array<Record<string, unknown>> = [];

  apiUtils.requireUserContext = (async () => createMockAuthContext(
    'user-1', bundleScope({ updates, chartRow: { id: 'bazi-2' } }),
  )) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
  });

  const { PATCH } = await import('../app/api/user/charts/route');
  const request = new NextRequest('http://localhost/api/user/charts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'bazi', id: 'bazi-2' }),
  });

  const response = await PATCH(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].user_id, 'user-1');
  assert.equal(updates[0].default_bazi_chart_id, 'bazi-2');
  assert.equal(payload.defaultChartIds.bazi, 'bazi-2');
});

test('user charts DELETE removes the requested chart with user scoping', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const originalRequireUserContext = apiUtils.requireUserContext;
  const deleted: string[] = [];
  const updates: Array<Record<string, unknown>> = [];

  apiUtils.requireUserContext = (async () => createMockAuthContext(
    'user-1',
    bundleScope({
      settings: { default_bazi_chart_id: null, default_ziwei_chart_id: 'ziwei-9' },
      updates,
      deleted,
    }),
  )) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
  });

  const { DELETE } = await import('../app/api/user/charts/route');
  const request = new NextRequest('http://localhost/api/user/charts?type=ziwei&id=ziwei-9', {
    method: 'DELETE',
  });

  const response = await DELETE(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, ['ziwei_charts']);
  assert.equal(payload.success, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].default_ziwei_chart_id, null);
  assert.equal(payload.defaultChartIds.ziwei, null);
});
