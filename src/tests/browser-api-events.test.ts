import test from 'node:test';
import assert from 'node:assert/strict';

type FetchLike = typeof global.fetch;

class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = (init?.detail ?? null) as T;
  }
}

type WindowListener = (event: Event) => void;

function createWindowStub() {
  const listeners = new Map<string, Set<WindowListener>>();

  return {
    location: { origin: 'http://localhost' },
    addEventListener(type: string, listener: WindowListener) {
      const group = listeners.get(type) ?? new Set<WindowListener>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: WindowListener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
  };
}

test('fetchBrowserJson should broadcast history summary deletion details', async (t) => {
  const browserApiPath = require.resolve('../lib/browser-api');
  const originalFetch = global.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const windowStub = createWindowStub();
  const historyEvents: Array<Record<string, unknown> | null> = [];

  t.after(() => {
    global.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', originalCustomEvent);
    else Reflect.deleteProperty(globalThis, 'CustomEvent');
    delete require.cache[browserApiPath];
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: windowStub });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, writable: true, value: TestCustomEvent });
  global.fetch = (async () => new Response(JSON.stringify({
    success: true,
    type: 'qimen',
    id: 'qm-1',
    conversationId: 'conv-qm-1',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as FetchLike;

  delete require.cache[browserApiPath];
  const browserApi = require('../lib/browser-api') as typeof import('../lib/browser-api');
  windowStub.addEventListener(browserApi.HISTORY_SUMMARY_DELETED_EVENT, (event: Event) => {
    historyEvents.push((event as CustomEvent<Record<string, unknown> | null>).detail ?? null);
  });

  await browserApi.fetchBrowserJson('/api/history-summaries?type=qimen&id=qm-1', {
    method: 'DELETE',
  });

  assert.deepEqual(historyEvents, [{
    type: 'qimen',
    id: 'qm-1',
    conversationId: 'conv-qm-1',
  }]);
});

test('fetchBrowserJson should broadcast knowledge-base sync and data invalidation details', async (t) => {
  const browserApiPath = require.resolve('../lib/browser-api');
  const originalFetch = global.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const windowStub = createWindowStub();
  const dataInvalidationEvents: Array<Record<string, unknown> | null> = [];
  const knowledgeBaseSyncEvents: Array<Record<string, unknown> | null> = [];

  t.after(() => {
    global.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', originalCustomEvent);
    else Reflect.deleteProperty(globalThis, 'CustomEvent');
    delete require.cache[browserApiPath];
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: windowStub });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, writable: true, value: TestCustomEvent });
  global.fetch = (async () => new Response(JSON.stringify({
    success: true,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as FetchLike;

  delete require.cache[browserApiPath];
  const browserApi = require('../lib/browser-api') as typeof import('../lib/browser-api');
  windowStub.addEventListener(browserApi.DATA_INDEX_INVALIDATED_EVENT, (event: Event) => {
    dataInvalidationEvents.push((event as CustomEvent<Record<string, unknown> | null>).detail ?? null);
  });
  windowStub.addEventListener(browserApi.KNOWLEDGE_BASE_SYNC_EVENT, (event: Event) => {
    knowledgeBaseSyncEvents.push((event as CustomEvent<Record<string, unknown> | null>).detail ?? null);
  });

  await browserApi.fetchBrowserJson('/api/knowledge-base/archive/chat_message:kb-1:msg-1', {
    method: 'DELETE',
  });

  assert.equal(dataInvalidationEvents.length, 1);
  assert.equal(dataInvalidationEvents[0]?.pathname, '/api/knowledge-base/archive/chat_message:kb-1:msg-1');
  assert.equal(dataInvalidationEvents[0]?.method, 'DELETE');
  assert.deepEqual(dataInvalidationEvents[0]?.responseData, { success: true });

  assert.equal(knowledgeBaseSyncEvents.length, 1);
  assert.equal(knowledgeBaseSyncEvents[0]?.pathname, '/api/knowledge-base/archive/chat_message:kb-1:msg-1');
  assert.equal(knowledgeBaseSyncEvents[0]?.method, 'DELETE');
  assert.deepEqual(knowledgeBaseSyncEvents[0]?.responseData, { success: true });
});

test('fetchBrowserJson should rethrow AbortError so callers can treat cancellation separately', async (t) => {
  const browserApiPath = require.resolve('../lib/browser-api');
  const originalFetch = global.fetch;

  global.fetch = (async () => {
    throw new DOMException('aborted', 'AbortError');
  }) as FetchLike;

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[browserApiPath];
  });

  delete require.cache[browserApiPath];
  const browserApi = require('../lib/browser-api') as typeof import('../lib/browser-api');

  await assert.rejects(
    () => browserApi.fetchBrowserJson('/api/conversations?limit=7&offset=0'),
    (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.equal(error.name, 'AbortError');
      return true;
    },
  );
});
