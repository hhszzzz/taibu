import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { applyMutationEffects, mutationEffects } from '../lib/query/invalidation';
import { queryKeys } from '../lib/query/keys';
import { registerBrowserQueryClient } from '../lib/query/client';
import { DATA_INDEX_INVALIDATED_EVENT, KNOWLEDGE_BASE_SYNC_EVENT, dispatchApiWriteEvents, requestBrowserJson } from '../lib/browser-api';
import { normalizeUserSettings, updateCurrentUserSettings } from '../lib/user/settings';

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
    queryKeys: [['chat', 'bootstrap', 'alice']], storageScopes: ['default_bazi_chart'],
  });
});

test('real settings facade executes declared effects once and never forwards metadata to fetch', async (t) => {
  const { client, removals, invalidations, invalidate } = setup(t);
  client.setQueryData(queryKeys.chatBootstrap('alice'), { settings: 'before' });
  client.setQueryData(queryKeys.chatBootstrap('bob'), { settings: 'other account' });
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
  assert.equal(invalidate.mock.calls.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].body, '{"notificationsEnabled":false}');
  assert.equal('mutationEffects' in requests[0], false);
  assert.deepEqual(invalidations, [JSON.stringify(queryKeys.chatBootstrap('alice'))]);
  assert.equal(client.getQueryState(queryKeys.chatBootstrap('bob'))?.isInvalidated, false);
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
  assert.equal(invalidate.mock.calls.length, 1);
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
  assert.equal(invalidate.mock.calls.length, 1);
  assert.deepEqual(events.map(event => event.type), [DATA_INDEX_INVALIDATED_EVENT, KNOWLEDGE_BASE_SYNC_EVENT]);
  assert.deepEqual((events[0] as CustomEvent<{ cacheScopes: string[] }>).detail.cacheScopes, ['default_bazi_chart']);
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
