import test from 'node:test';
import assert from 'node:assert/strict';


test('loadHistorySummariesPage should throw when history summaries request fails', async (t) => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../lib/history/client');

  global.fetch = (async () => new Response(JSON.stringify({
    error: '加载历史记录失败',
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  delete require.cache[modulePath];
  const { loadHistorySummariesPage } = require('../lib/history/client') as typeof import('../lib/history/client');

  await assert.rejects(
    () => loadHistorySummariesPage('mbti'),
    /加载历史记录失败/u,
  );
});

test('history reads reject cancelled responses even when fetch or JSON parsing finishes late', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const { loadHistorySummariesPage, loadHistoryRestore } = require('../lib/history/client') as typeof import('../lib/history/client');

  for (const read of [
    (signal: AbortSignal) => loadHistorySummariesPage('mbti', { signal }),
    (signal: AbortSignal) => loadHistoryRestore('mbti', 'history-1', undefined, { signal }),
  ]) {
    const controller = new AbortController();
    let releaseBody!: (value: unknown) => void;
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => { bodyStarted = resolve; });
    let receivedSignal: AbortSignal | null | undefined;
    global.fetch = async (_input, init) => {
      receivedSignal = init?.signal;
      const response = new Response('{}');
      response.json = () => {
        bodyStarted();
        return new Promise((resolve) => { releaseBody = resolve; });
      };
      return response;
    };
    const pending = read(controller.signal);
    // The transport ignores abort; the shared client must still fence JSON completion.
    await started;
    controller.abort();
    releaseBody({ items: [{ id: 'stale' }], item: { id: 'stale' } });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(receivedSignal, controller.signal);
  }
});

test('deleteHistorySummary should throw when delete request fails', async (t) => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve('../lib/history/client');

  global.fetch = (async () => new Response(JSON.stringify({
    error: '删除历史记录失败',
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  delete require.cache[modulePath];
  const { deleteHistorySummary } = require('../lib/history/client') as typeof import('../lib/history/client');

  await assert.rejects(
    () => deleteHistorySummary('mbti', 'history-1'),
    /删除历史记录失败/u,
  );
});
