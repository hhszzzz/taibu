import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { shouldPollTaskNotifications, TASK_NOTIFICATION_SETTINGS_STALE_MS } from '../lib/notification';
import { applyMutationEffects, mutationEffects } from '../lib/query/invalidation';
import { registerBrowserQueryClient } from '../lib/query/client';
import { fetchCachedUserSettings, normalizeUserSettings } from '../lib/user/settings';

function setupBrowser(t: TestContext) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'https://test.invalid' },
    dispatchEvent: () => true,
    localStorage: {
      get length() { return storage.size; },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  } });
  const client = new QueryClient();
  registerBrowserQueryClient(client);
  t.after(() => {
    client.clear();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return client;
}

test('hidden tabs keep polling task notifications only when a desktop notification can be shown', () => {
  assert.equal(shouldPollTaskNotifications({ visible: true, desktopNotifications: false }), true);
  assert.equal(shouldPollTaskNotifications({ visible: true, desktopNotifications: true }), true);
  assert.equal(shouldPollTaskNotifications({ visible: false, desktopNotifications: true }), true);
  assert.equal(shouldPollTaskNotifications({ visible: false, desktopNotifications: false }), false);
});

test('notification polling reuses cached settings until a settings write invalidates them', async (t) => {
  const client = setupBrowser(t);
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let notificationsEnabled = true;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return Response.json({ data: { settings: { ...normalizeUserSettings(null), notificationsEnabled } }, error: null });
  });

  const first = await fetchCachedUserSettings(client, 'alice', TASK_NOTIFICATION_SETTINGS_STALE_MS);
  const second = await fetchCachedUserSettings(client, 'alice', TASK_NOTIFICATION_SETTINGS_STALE_MS);
  assert.equal(first.notificationsEnabled, true);
  assert.equal(second, first);
  assert.equal(requests.length, 1, 'a poll inside the stale window must not refetch settings');
  assert.equal(requests[0].url, '/api/user/settings');
  assert.equal(requests[0].headers['X-Expected-User-Id'], 'alice');

  // 设置页写入后，下一轮轮询立即读到新值，而不是等缓存过期
  notificationsEnabled = false;
  applyMutationEffects(mutationEffects.userSettings('alice'));
  const afterWrite = await fetchCachedUserSettings(client, 'alice', TASK_NOTIFICATION_SETTINGS_STALE_MS);
  assert.equal(afterWrite.notificationsEnabled, false);
  assert.equal(requests.length, 2);

  // 账户之间不共享缓存
  await fetchCachedUserSettings(client, 'bob', TASK_NOTIFICATION_SETTINGS_STALE_MS);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].headers['X-Expected-User-Id'], 'bob');
});

test('a failed settings read throws and is retried on the next poll', async (t) => {
  const client = setupBrowser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ data: null, error: { message: '服务暂不可用' } }, { status: 503 })
      : Response.json({ data: { settings: normalizeUserSettings(null) }, error: null });
  });

  await assert.rejects(fetchCachedUserSettings(client, 'alice', TASK_NOTIFICATION_SETTINGS_STALE_MS), /服务暂不可用/u);
  const settings = await fetchCachedUserSettings(client, 'alice', TASK_NOTIFICATION_SETTINGS_STALE_MS);
  assert.equal(settings.notificationsEnabled, normalizeUserSettings(null).notificationsEnabled);
  assert.equal(calls, 2);
});
