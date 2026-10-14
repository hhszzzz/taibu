import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { applyMutationEffects, mutationEffects } from '../lib/query/invalidation';
import { queryKeys } from '../lib/query/keys';
import { registerBrowserQueryClient } from '../lib/query/client';
import { DATA_INDEX_INVALIDATED_EVENT, KNOWLEDGE_BASE_SYNC_EVENT, dispatchApiWriteEvents, requestBrowserJson } from '../lib/browser-api';
import { normalizeUserSettings, updateCurrentUserSettings } from '../lib/user/settings';
import { createSavedChart, deleteUserChart, getUserCharts, setDefaultUserChart, updateSavedChart, type ChartRequestScope } from '../lib/user/charts-client';

function setup(t: TestContext) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  const storage = new Map<string, string>();
  const removals: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'https://test.invalid' },
    dispatchEvent: target.dispatchEvent.bind(target),
    localStorage: {
      get length() { return storage.size; },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { removals.push(key); storage.delete(key); },
    },
  } });
  const client = new QueryClient();
  registerBrowserQueryClient(client);
  const invalidate = t.mock.method(client, 'invalidateQueries');
  const invalidations: string[] = [];
  client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'invalidate') {
      invalidations.push(JSON.stringify(event.query.queryKey));
    }
  });
  t.after(() => {
    client.clear();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return { client, target, storage, removals, invalidations, invalidate };
}

test('settings effect mapping is explicit, typed and user-scoped', () => {
  assert.deepEqual(mutationEffects.userSettings('alice'), {
    queryKeys: [['chat', 'bootstrap', 'alice'], ['user', 'settings', 'alice']], storageScopes: ['default_bazi_chart'],
  });
});

test('real settings facade executes declared effects once and never forwards metadata to fetch', async (t) => {
  const { client, removals, invalidations, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), { settings: 'before' });
  client.setQueryData(queryKeys.chatBootstrap('bob'), { settings: 'other account' });
  client.setQueryData(queryKeys.userSettings('alice'), { notificationsEnabled: true });
  client.setQueryData(queryKeys.userSettings('bob'), { notificationsEnabled: true });
  // HTTP JSON omits undefined fields; assert the exact wire representation.
  const expected = Object.fromEntries(Object.entries(normalizeUserSettings(null)).filter(([, value]) => value !== undefined));
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return Response.json({ data: { settings: expected }, error: null });
  });
  const result = await updateCurrentUserSettings({ notificationsEnabled: false }, mutationEffects.userSettings('alice'));
  assert.deepEqual(result, expected);
  assert.equal(requests.length, 1);
  // 每个声明的 key 各失效一次：对话引导与轮询复用的设置缓存
  assert.equal(invalidate.mock.calls.length, 2);
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].body, '{"notificationsEnabled":false}');
  assert.equal('mutationEffects' in requests[0], false);
  assert.deepEqual(invalidations, [queryKeys.chatBootstrap('alice'), queryKeys.userSettings('alice')].map(key => JSON.stringify(key)));
  assert.equal(client.getQueryState(queryKeys.chatBootstrap('bob'))?.isInvalidated, false);
  assert.equal(client.getQueryState(queryKeys.userSettings('bob'))?.isInvalidated, false);
  assert.deepEqual(removals, ['taibu.pref.defaultBaziChartId', 'mingai.pref.defaultBaziChartId', 'defaultBaziChartId']);
});

test('failed explicit mutations and GETs do not invalidate queries or storage', async (t) => {
  const { client, invalidations, removals, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), {});
  let status = 403;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: null, error: { message: 'denied' } }, { status }));
  assert.equal(await updateCurrentUserSettings({ language: 'zh' }, mutationEffects.userSettings('alice')), null);
  status = 200;
  assert.equal(await updateCurrentUserSettings({ language: 'zh' }, mutationEffects.userSettings('alice')), null);
  await requestBrowserJson('/api/user/settings', { method: 'GET', mutationEffects: mutationEffects.userSettings('alice') });
  assert.equal(invalidate.mock.calls.length, 0);
  assert.deepEqual(invalidations, []);
  assert.deepEqual(removals, []);
});

test('unmigrated settings keep inferred prefix invalidation without a second facade invalidation', async (t) => {
  const { client, invalidations, removals, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), {});
  client.setQueryData(queryKeys.chatBootstrap('bob'), {});
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { settings: normalizeUserSettings(null) } }));
  await updateCurrentUserSettings({ language: 'zh' });
  assert.deepEqual(invalidations.sort(), ['alice', 'bob'].map(id => JSON.stringify(queryKeys.chatBootstrap(id))).sort());
  assert.equal(removals.length, 3);
  // 路径推断出两个前缀（对话引导、设置缓存），各失效一次，不再叠加声明式失效
  assert.equal(invalidate.mock.calls.length, 2);
});

test('declared effects replace pathname inference while preserving legacy events once', (t) => {
  const { client, target, storage, invalidations, removals, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), {});
  storage.set('taibu.knowledge_bases.cached', 'keep');
  const events: Event[] = [];
  target.addEventListener(DATA_INDEX_INVALIDATED_EVENT, event => events.push(event));
  target.addEventListener(KNOWLEDGE_BASE_SYNC_EVENT, event => events.push(event));
  dispatchApiWriteEvents('/api/knowledge-base/archive', 'POST', {
    mutationEffects: mutationEffects.userSettings('alice'), responseData: { id: 'archived' },
  });
  assert.equal(storage.has('taibu.knowledge_bases.cached'), true);
  assert.equal(invalidations.length, 1);
  assert.equal(removals.length, 3);
  assert.equal(invalidate.mock.calls.length, 2);
  assert.deepEqual(events.map(event => event.type), [DATA_INDEX_INVALIDATED_EVENT, KNOWLEDGE_BASE_SYNC_EVENT]);
  assert.deepEqual((events[0] as CustomEvent<{ cacheScopes: string[] }>).detail.cacheScopes, ['default_bazi_chart']);
});

test('chart save replaces a pending initial bundle read even when the old response arrives last', async (t) => {
  const { client, target, invalidate } = setup(t);
  const key = ['user', 'charts', 'alice'] as const;
  const otherKey = ['user', 'charts', 'bob'] as const;
  client.setQueryData(otherKey, { marker: 'other account' });
  const events: Event[] = [];
  target.addEventListener(DATA_INDEX_INVALIDATED_EVENT, event => events.push(event));
  const bundle = (name: string) => ({
    baziCharts: [{ id: 'chart-1', name, birth_date: '1990-01-01', birth_time: '08:00', gender: 'male', created_at: '2026-01-01' }],
    ziweiCharts: [], defaultChartIds: { bazi: 'chart-1', ziwei: null },
  });
  let resolveOld!: (response: Response) => void;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ id: 'chart-1' }, { status: 201 });
    reads += 1;
    if (reads === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
    return Response.json(bundle('saved'));
  });
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: ({ signal }) => getUserCharts({ expectedUserId: 'alice', signal }),
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  assert.equal(reads, 1);
  assert.equal(client.getQueryData(key), undefined);
  assert.equal(await createSavedChart('bazi', { name: 'saved' }, { expectedUserId: 'alice' }), 'chart-1');
  await new Promise(resolve => setTimeout(resolve, 0));
  resolveOld(Response.json(bundle('stale')));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reads, 2);
  assert.equal(client.getQueryData<{ baziCharts: Array<{ name: string }> }>(key)?.baziCharts[0].name, 'saved');
  assert.deepEqual(client.getQueryData(otherKey), { marker: 'other account' });
  assert.equal(client.getQueryState(otherKey)?.isInvalidated, false);
  assert.equal(invalidate.mock.calls.length, 1);
  assert.equal(events.length, 1);
});

test('HTTP 200 envelope errors on legacy chart writes emit no invalidation events', async (t) => {
  const { target, removals, invalidate } = setup(t);
  let events = 0;
  target.addEventListener(DATA_INDEX_INVALIDATED_EVENT, () => { events += 1; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'write rejected' } }));
  const result = await requestBrowserJson('/api/bazi/charts', { method: 'POST', body: '{}' });
  assert.equal(result.error?.message, 'write rejected');
  assert.equal(events, 0);
  assert.equal(removals.length, 0);
  assert.equal(invalidate.mock.calls.length, 0);
});

const chartWrites: Array<[string, (scope: ChartRequestScope) => Promise<unknown>]> = [
  ['bazi create', scope => createSavedChart('bazi', { name: 'saved' }, scope)],
  ['ziwei create', scope => createSavedChart('ziwei', { name: 'saved' }, scope)],
  ['bazi update', scope => updateSavedChart('bazi', 'chart-1', { name: 'saved' }, scope)],
  ['ziwei update', scope => updateSavedChart('ziwei', 'chart-1', { name: 'saved' }, scope)],
  ['default', scope => setDefaultUserChart('bazi', 'chart-1', scope)],
  ['delete', scope => deleteUserChart('ziwei', 'chart-1', scope)],
];

for (const [name, write] of chartWrites) {
  test(`${name} fences the initiator and emits one exact chart effect without touching another user`, async (t) => {
    const { client, target, invalidate, removals } = setup(t);
    client.setQueryData(queryKeys.userCharts('alice'), { defaultChartIds: { bazi: 'old' } });
    client.setQueryData(queryKeys.userCharts('bob'), { marker: 'keep' });
    client.setQueryData(queryKeys.chatBootstrap('alice'), { knowledgeBases: [] });
    let events = 0;
    target.addEventListener(DATA_INDEX_INVALIDATED_EVENT, () => { events += 1; });
    const controller = new AbortController();
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).get('X-Expected-User-Id'), 'alice');
      assert.equal(init?.signal, controller.signal);
      assert.equal('mutationEffects' in (init ?? {}), false);
      return Response.json({ id: 'chart-1', success: true, defaultChartIds: { bazi: 'chart-1', ziwei: null } });
    });
    await write({ expectedUserId: 'alice', signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(events, 1);
    assert.equal(invalidate.mock.calls.length, 1);
    assert.deepEqual(invalidate.mock.calls[0].arguments[0], { queryKey: queryKeys.userCharts('alice'), exact: true });
    assert.equal(client.getQueryState(queryKeys.userCharts('bob'))?.isInvalidated, false);
    assert.equal(client.getQueryState(queryKeys.chatBootstrap('alice'))?.isInvalidated, false);
    assert.equal(removals.filter(key => key === 'taibu.pref.defaultBaziChartId').length, 1);
  });
}

test('failed or aborted defaults preserve cached badges and emit no effects', async (t) => {
  const { client, target, invalidate, removals } = setup(t);
  const before = { defaultChartIds: { bazi: 'old', ziwei: null } };
  client.setQueryData(queryKeys.userCharts('alice'), before);
  let events = 0;
  target.addEventListener(DATA_INDEX_INVALIDATED_EVENT, () => { events += 1; });
  const controller = new AbortController();
  let abortResponse = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (abortResponse) {
      controller.abort();
      return Response.json({ defaultChartIds: { bazi: 'new', ziwei: null } });
    }
    return Response.json({ error: 'denied' });
  });
  await assert.rejects(setDefaultUserChart('bazi', 'new', { expectedUserId: 'alice' }), /denied/);
  abortResponse = true;
  await assert.rejects(setDefaultUserChart('bazi', 'new', { expectedUserId: 'alice', signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(client.getQueryData(queryKeys.userCharts('alice')), before);
  assert.equal(invalidate.mock.calls.length, 0);
  assert.equal(events, 0);
  assert.deepEqual(removals, []);
});

test('a committed create stays successful when its bundle refresh fails', async (t) => {
  const { client } = setup(t);
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ id: 'committed' }, { status: 201 })
    : Response.json({ error: 'refresh failed' }, { status: 500 }));
  const observer = new QueryObserver(client, {
    queryKey: queryKeys.userCharts('alice'),
    queryFn: ({ signal }) => getUserCharts({ expectedUserId: 'alice', signal }),
    initialData: { baziCharts: [], ziweiCharts: [], defaultChartIds: { bazi: null, ziwei: null } },
    staleTime: Infinity,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  assert.equal(await createSavedChart('bazi', {}, { expectedUserId: 'alice' }), 'committed');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(observer.getCurrentResult().isError, true);
  assert.deepEqual(observer.getCurrentResult().data?.baziCharts, []);
});

test('effect executor deduplicates declared query keys and storage scopes', (t) => {
  const { client, invalidations, removals, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), {});
  applyMutationEffects({
    queryKeys: [queryKeys.chatBootstrap('alice'), queryKeys.chatBootstrap('alice')],
    storageScopes: ['default_bazi_chart', 'default_bazi_chart'],
  });
  assert.equal(invalidations.length, 1);
  assert.equal(removals.length, 3);
  assert.equal(invalidate.mock.calls.length, 1);
});
