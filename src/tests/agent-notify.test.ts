import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __dispatchAgentSignalForTests as dispatch,
  agentSignalMatches,
  subscribeAgentSignals,
} from '../lib/db/listen.server';

test('signals match their run and kinds, while resync reaches every subscriber', () => {
  assert.equal(agentSignalMatches({ t: 'resync' }, { run: 'run-1', kinds: ['cmd'] }), true);
  assert.equal(agentSignalMatches({ t: 'event', run: 'run-1', seq: 3 }, { run: 'run-1' }), true);
  assert.equal(agentSignalMatches({ t: 'run', run: 'run-2', status: 'running' }, { run: 'run-1' }), false);
  assert.equal(agentSignalMatches({ t: 'event', run: 'run-1', seq: 4 }, { run: 'run-1', kinds: ['run', 'cmd'] }), false);
  assert.equal(agentSignalMatches({ t: 'cmd', run: 'run-1' }, { run: 'run-1', kinds: ['run', 'cmd'] }), true);
  assert.equal(agentSignalMatches({ t: 'queue' }, { kinds: ['queue'] }), true);
  assert.equal(agentSignalMatches({ t: 'event', run: 'run-9', seq: 1 }, { kinds: ['queue'] }), false);
  assert.equal(agentSignalMatches({ t: 'queue' }, { run: 'run-1' }), false);
});

test('a signal that lands before the wait is kept for it', async () => {
  const signals = subscribeAgentSignals({ run: 'run-1' });
  try {
    // The caller is still reading state when the change arrives.
    dispatch({ t: 'event', run: 'run-1', seq: 7 });
    const started = Date.now();
    assert.deepEqual(await signals.next(5_000), [{ t: 'event', run: 'run-1', seq: 7 }]);
    assert.ok(Date.now() - started < 100);
  } finally {
    signals.close();
  }
});

test('queued signals coalesce into one wake and other runs are filtered out', async () => {
  const signals = subscribeAgentSignals({ run: 'run-1', kinds: ['run', 'cmd'] });
  try {
    dispatch({ t: 'event', run: 'run-1', seq: 1 });
    dispatch({ t: 'cmd', run: 'run-2' });
    dispatch({ t: 'cmd', run: 'run-1' });
    dispatch({ t: 'run', run: 'run-1', status: 'cancelling', cancel: true });
    assert.deepEqual(await signals.next(5_000), [
      { t: 'cmd', run: 'run-1' },
      { t: 'run', run: 'run-1', status: 'cancelling', cancel: true },
    ]);
  } finally {
    signals.close();
  }
});

test('a waiting subscriber wakes on the first matching signal', async () => {
  const signals = subscribeAgentSignals({ kinds: ['queue'] });
  try {
    const pending = signals.next(5_000);
    dispatch({ t: 'event', run: 'run-1', seq: 2 });
    setTimeout(() => dispatch({ t: 'queue' }), 20);
    const started = Date.now();
    assert.deepEqual(await pending, [{ t: 'queue' }]);
    assert.ok(Date.now() - started < 500);
  } finally {
    signals.close();
  }
});

test('a subscriber that falls far behind collapses its backlog into one resync', async () => {
  const signals = subscribeAgentSignals({ run: 'run-1' });
  try {
    for (let seq = 1; seq <= 300; seq++) dispatch({ t: 'event', run: 'run-1', seq });
    const received = await signals.next(5_000);
    assert.deepEqual(received[0], { t: 'resync' });
    assert.ok(received.length < 300);
  } finally {
    signals.close();
  }
});

test('without a listener the wait falls back quickly and aborts cleanly', async () => {
  const signals = subscribeAgentSignals({ run: 'run-1' });
  try {
    const started = Date.now();
    assert.deepEqual(await signals.next(5_000), []);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 900 && elapsed < 2_500, `fallback took ${elapsed}ms`);

    const controller = new AbortController();
    const pending = signals.next(5_000, controller.signal);
    controller.abort();
    assert.deepEqual(await pending, []);
  } finally {
    signals.close();
  }
});

test('an already-aborted wait returns at once and close releases a pending wait', async () => {
  const signals = subscribeAgentSignals({ run: 'run-1' });
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  assert.deepEqual(await signals.next(5_000, controller.signal), []);
  assert.ok(Date.now() - started < 100);

  const pending = signals.next(5_000);
  signals.close();
  assert.deepEqual(await pending, []);
  dispatch({ t: 'event', run: 'run-1', seq: 1 });
  assert.deepEqual(await signals.next(5_000), []);
});
