import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSignalMatches, waitForAgentSignal } from '../lib/db/listen.server';

test('signals match only their run, while resync reaches every stream', () => {
  assert.equal(agentSignalMatches({ t: 'resync' }, 'run-1'), true);
  assert.equal(agentSignalMatches({ t: 'event', run: 'run-1', seq: 3 }, 'run-1'), true);
  assert.equal(agentSignalMatches({ t: 'cmd', run: 'run-1' }, 'run-1'), true);
  assert.equal(agentSignalMatches({ t: 'run', run: 'run-2', status: 'running' }, 'run-1'), false);
  assert.equal(agentSignalMatches({ t: 'queue' }, undefined), true);
});

test('without a listener the wait falls back quickly and aborts cleanly', async () => {
  const started = Date.now();
  assert.equal(await waitForAgentSignal('run-1', 5_000), null);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 2_500, `fallback took ${elapsed}ms`);

  const controller = new AbortController();
  const pending = waitForAgentSignal('run-1', 5_000, controller.signal);
  controller.abort();
  assert.equal(await pending, null);
});

test('an already-aborted request never waits', async () => {
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  assert.equal(await waitForAgentSignal('run-1', 5_000, controller.signal), null);
  assert.ok(Date.now() - started < 100);
});
