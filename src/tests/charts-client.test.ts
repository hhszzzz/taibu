import test from 'node:test';
import assert from 'node:assert/strict';


test('toSavedBaziChart should rebuild core output from stored bazi base fields', async () => {
  const { toSavedBaziChart } = await import('../lib/user/charts-client');

  const chart = toSavedBaziChart({
    id: 'bazi-1',
    user_id: 'user-1',
    name: '测试命盘',
    gender: 'male',
    birth_date: '1990-01-01',
    birth_time: '08:30',
    birth_place: '上海',
    longitude: 121.4737,
    calendar_type: 'solar',
    is_leap_month: false,
    created_at: '2026-03-28T00:00:00.000Z',
  });

  assert.ok(chart);
  assert.equal(chart.id, 'bazi-1');
  assert.ok(chart.output.dayMaster);
  assert.ok(chart.output.fourPillars.day.branch);
  assert.equal(chart.name, '测试命盘');
});

test('chart lists preserve time options before rebuilding saved output', async (t) => {
  const row = { id: 'dst', name: 'DST', gender: 'male', birth_date: '2024-03-10', birth_time: '02:30', calendar_type: 'solar', timezone: 'America/New_York', disambiguation: 'later', longitude: -74, created_at: '2026-10-05T00:00:00Z' };
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ baziCharts: [row], ziweiCharts: [row] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const { getUserCharts, toSavedBaziChart } = await import('../lib/user/charts-client');
  const bundle = await getUserCharts();
  for (const item of [...bundle.baziCharts, ...bundle.ziweiCharts]) {
    assert.equal(item.timezone, row.timezone);
    assert.equal(item.disambiguation, 'later');
  }
  const raw = toSavedBaziChart(row);
  const projected = toSavedBaziChart(bundle.baziCharts[0]);
  assert.ok(raw);
  assert.deepEqual(projected, raw);
  assert.equal(raw.output.trueSolarTimeInfo?.timezone, 'America/New_York');
  assert.equal(toSavedBaziChart({ ...row, disambiguation: 'reject' }), null);
});

test('getUserCharts should throw when chart bundle request fails', async (t) => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../lib/user/charts-client');

  global.fetch = (async () => new Response(JSON.stringify({
    error: '获取命盘列表失败',
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  delete require.cache[modulePath];
  const { getUserCharts } = require('../lib/user/charts-client') as typeof import('../lib/user/charts-client');

  await assert.rejects(
    () => getUserCharts(),
    /获取命盘列表失败/u,
  );
});

test('loadSavedChart should throw when saved chart request fails', async (t) => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../lib/user/charts-client');

  global.fetch = (async () => new Response(JSON.stringify({
    error: '加载命盘失败',
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  delete require.cache[modulePath];
  const { loadSavedChart } = require('../lib/user/charts-client') as typeof import('../lib/user/charts-client');

  await assert.rejects(
    () => loadSavedChart('bazi', 'chart-1'),
    /加载命盘失败/u,
  );
});

test('toSavedBaziChart should reject rows that are missing birth date essentials', async () => {
  const { toSavedBaziChart } = await import('../lib/user/charts-client');

  const chart = toSavedBaziChart({
    id: 'bazi-2',
    name: '残缺命盘',
    gender: 'female',
    birth_time: '10:00',
    created_at: '2026-03-28T00:00:00.000Z',
  });

  assert.equal(chart, null);
});
