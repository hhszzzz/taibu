import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';


type BaziRow = Parameters<typeof import('../lib/data-sources/bazi').baziProvider.formatForAI>[0];

function setupDreamContext(t: import('node:test').TestContext) {
  const baziModule = require('../lib/data-sources/bazi') as typeof import('../lib/data-sources/bazi');
  const fortuneModule = require('../lib/data-sources/fortune') as typeof import('../lib/data-sources/fortune');
  const caseProfileModule = require('../lib/server/bazi-case-profile') as typeof import('../lib/server/bazi-case-profile');
  const modulePath = require.resolve('../lib/chat/chat-context');
  const state = {
    defaultChartId: 'chart-1' as string | null,
    caseProfileUpdatedAt: null as string | null,
    chart: {
      id: 'chart-1', user_id: 'user-1', name: '测试命盘', gender: 'male',
      birth_date: '1990-01-01', birth_time: '08:00', birth_place: '上海', longitude: 121.47,
      calendar_type: 'solar', is_leap_month: false, timezone: 'Asia/Shanghai', disambiguation: 'reject',
      created_at: '2026-03-27T00:00:00.000Z',
    } as BaziRow,
    chartReads: 0,
    settingsReads: 0,
    fortuneReads: 0,
    formattedRows: [] as BaziRow[],
  };
  const contextModule = require('../lib/db/context.server') as any;
  t.mock.method(contextModule, 'systemDb', () => createMockScopedDb({
    tx: async (work: any) => {
      const trx = {
        selectFrom(table: string) {
          let columns: string[] = [];
          const filters = new Map<string, string>();
          const query = {
            select(selection: string | readonly string[]) {
              columns = Array.isArray(selection)
                ? [...selection]
                : String(selection).split(',').map((column) => column.trim());
              if (table === 'bazi_charts') {
                assert.doesNotMatch(columns.join(','), /\*|updated_at/u);
                for (const field of ['id', 'name', 'gender', 'birth_date', 'birth_time', 'birth_place', 'longitude', 'calendar_type', 'is_leap_month', 'timezone', 'disambiguation']) {
                  assert.ok(columns.includes(field), `chart SELECT must include ${field}`);
                }
              }
              return query;
            },
            where(column: string, _operator: string, value: string) {
              filters.set(column, value);
              return query;
            },
            orderBy() { return query; },
            limit() { return query; },
            async executeTakeFirst() {
              assert.ok(filters.get('user_id'), `${table} must be account-scoped`);
              if (table === 'user_settings') {
                state.settingsReads += 1;
                return { default_bazi_chart_id: state.defaultChartId };
              }
              if (table === 'bazi_charts') {
                state.chartReads += 1;
                const wantedId = filters.get('id');
                const matches = !wantedId || wantedId === state.chart.id;
                return matches ? { ...state.chart } : undefined;
              }
              if (table === 'bazi_case_profiles') {
                assert.equal(filters.get('bazi_chart_id'), state.chart.id);
                return { updated_at: state.caseProfileUpdatedAt };
              }
              throw new Error(`Unexpected table: ${table}`);
            },
            async execute() { return []; },
          };
          return query;
        },
      };
      return work(trx as never);
    },
  }));
  t.mock.method(baziModule.baziProvider, 'formatForAI', (chart: BaziRow) => {
    state.formattedRows.push(chart);
    return `命盘:${chart.id}:${chart.timezone}:${chart.disambiguation}:${chart.birth_time}`;
  });
  t.mock.method(fortuneModule.dailyFortuneProvider, 'get', async () => {
    state.fortuneReads += 1;
    return { id: 'today', name: '今日运势', content: '今日运势文本', createdAt: new Date().toISOString() };
  });
  t.mock.method(caseProfileModule, 'getBaziCaseProfileByChartId', async () => null);
  t.after(() => { delete require.cache[modulePath]; });
  delete require.cache[modulePath];
  const { buildDreamContextPayload } = require('../lib/chat/chat-context') as typeof import('../lib/chat/chat-context');
  return { state, build: buildDreamContextPayload };
}

test('buildDreamContextPayload should reuse cached payload within TTL and render the already-loaded row', async (t) => {
  const { state, build } = setupDreamContext(t);
  const first = await build('user-1');
  const second = await build('user-1');

  assert.strictEqual(first, second);
  assert.equal(first.payload.baziText, '命盘:chart-1:Asia/Shanghai:reject:08:00');
  assert.equal(second.payload.fortuneText, '今日运势文本');
  assert.equal(state.settingsReads, 2);
  assert.equal(state.chartReads, 2, 'one chart read per request, with no separate metadata/detail read');
  assert.equal(state.fortuneReads, 1);
  assert.equal(state.formattedRows.length, 1);
  assert.equal(state.formattedRows[0].timezone, 'Asia/Shanghai');
  assert.equal(state.formattedRows[0].disambiguation, 'reject');
});

test('buildDreamContextPayload should invalidate cached text for every birth field and time option without updated_at', async (t) => {
  const { state, build } = setupDreamContext(t);
  let previous = await build('user-1');
  const changes: Partial<BaziRow>[] = [
    { name: '新命盘' }, { gender: 'female' }, { birth_date: '1990-01-02' },
    { birth_time: '09:00' }, { birth_place: '北京' }, { longitude: 116.4074 },
    { calendar_type: 'lunar' }, { is_leap_month: true },
    { timezone: 'America/New_York' }, { disambiguation: 'later' },
  ];
  for (const change of changes) {
    Object.assign(state.chart, change);
    const next = await build('user-1');
    assert.notStrictEqual(next, previous, `${Object.keys(change)[0]} must invalidate the cache`);
    assert.strictEqual(await build('user-1'), next, 'unchanged values must reuse the cache');
    previous = next;
  }
  assert.equal(state.formattedRows.length, changes.length + 1);
  assert.equal(state.fortuneReads, changes.length + 1);
  assert.equal(state.chartReads, changes.length * 2 + 1);
  assert.equal(previous.payload.baziText, '命盘:chart-1:America/New_York:later:09:00');
});

test('buildDreamContextPayload should preserve account, case-profile, TTL and day cache boundaries', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 2, 27, 23, 50) });
  const { state, build } = setupDreamContext(t);
  const first = await build('user-1');
  assert.strictEqual(await build('user-1'), first);
  assert.notStrictEqual(await build('user-2'), first, 'same row values cannot cross accounts');
  state.caseProfileUpdatedAt = '2026-03-27T12:00:00.000Z';
  const changedProfile = await build('user-1');
  assert.notStrictEqual(changedProfile, first);
  t.mock.timers.tick(11 * 60 * 1000);
  const nextDay = await build('user-1');
  assert.notStrictEqual(nextDay, changedProfile, 'local day change invalidates an unexpired cache entry');
  assert.strictEqual(await build('user-1'), nextDay);
  t.mock.timers.tick(31 * 60 * 1000);
  assert.notStrictEqual(await build('user-1'), nextDay, 'TTL expiry invalidates within the same day');
  assert.equal(state.fortuneReads, 5);
});

test('buildDreamContextPayload should key latest-chart cache by resolved chart id', async (t) => {
  const { state, build } = setupDreamContext(t);
  state.defaultChartId = null;
  const first = await build('user-1');
  assert.strictEqual(await build('user-1'), first);
  state.chart.id = 'chart-2';
  const next = await build('user-1');
  assert.notStrictEqual(next, first);
  assert.match(next.payload.baziText || '', /^命盘:chart-2:/u);
  assert.equal(state.chartReads, 3);
  assert.equal(state.formattedRows.length, 2);
});

test('buildDreamContextPayload should remove a missing preferred id before selecting the latest chart', async (t) => {
  const { state, build } = setupDreamContext(t);
  state.defaultChartId = 'deleted-chart';
  const result = await build('user-1');
  assert.match(result.payload.baziText || '', /^命盘:chart-1:/u);
  assert.equal(state.chartReads, 2);
  assert.equal(state.formattedRows.length, 1);
});
