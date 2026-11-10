import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

const load = () => require('../lib/agent/expiry.server') as typeof import('../lib/agent/expiry.server');

test('the ask timeout defaults to five minutes and treats zero as off', () => {
  const { agentAskTimeoutMinutes } = load();
  assert.equal(agentAskTimeoutMinutes(undefined), 5);
  assert.equal(agentAskTimeoutMinutes(''), 5);
  assert.equal(agentAskTimeoutMinutes('30'), 30);
  assert.equal(agentAskTimeoutMinutes('0'), 0);
  assert.equal(agentAskTimeoutMinutes('abc'), 5);
  assert.equal(agentAskTimeoutMinutes('-5'), 5);
  assert.equal(agentAskTimeoutMinutes('1.5'), 5);
});

test('the sweep passes the configured window and reports its counters', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = createMockScopedDb({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { nudged: 2, cancelled: 1, failed: 0 };
    },
  });
  const { expireAwaitingAgentRuns } = load();
  assert.deepEqual(await expireAwaitingAgentRuns({ db, minutes: 30 }), { nudged: 2, cancelled: 1, failed: 0 });
  assert.deepEqual(calls, [{ name: 'agent_expire_awaiting_inputs', args: { p_max_age_minutes: 30, p_limit: 100 } }]);
});

test('a disabled timeout skips the sweep', async () => {
  let called = 0;
  const db = createMockScopedDb({ rpc: async () => { called += 1; return null; } });
  const { expireAwaitingAgentRuns } = load();
  assert.deepEqual(await expireAwaitingAgentRuns({ db, minutes: 0 }), { nudged: 0, cancelled: 0, failed: 0 });
  assert.equal(called, 0);
});

test('the environment value feeds the sweep', async (t) => {
  const previous = process.env.AGENT_ASK_TIMEOUT_MINUTES;
  process.env.AGENT_ASK_TIMEOUT_MINUTES = '15';
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_ASK_TIMEOUT_MINUTES;
    else process.env.AGENT_ASK_TIMEOUT_MINUTES = previous;
  });
  const calls: unknown[] = [];
  const db = createMockScopedDb({
    rpc: async (_name, args) => {
      calls.push(args);
      return { nudged: 0, cancelled: 0, failed: 0 };
    },
  });
  const { expireAwaitingAgentRuns } = load();
  await expireAwaitingAgentRuns({ db });
  assert.deepEqual(calls, [{ p_max_age_minutes: 15, p_limit: 100 }]);
});
