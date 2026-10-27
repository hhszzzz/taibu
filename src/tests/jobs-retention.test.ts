import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

function stubSystemDb(t: import('node:test').TestContext, rpc: (name: string, args: Record<string, unknown>) => unknown) {
  const context = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
  const original = context.systemDb;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  t.mock.method(context, 'systemDb', () => createMockScopedDb({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return rpc(name, args);
    },
  }));
  t.after(() => { context.systemDb = original; });
  return calls;
}

test('agent retention loops until a pass is under the batch size', async (t) => {
  let pass = 0;
  const calls = stubSystemDb(t, (name) => {
    assert.equal(name, 'delete_agent_retention');
    pass += 1;
    return pass === 1
      ? [{ events_deleted: 1000, commits_deleted: 1000, workers_deleted: 1000, metrics_deleted: 1000 }]
      : [{ events_deleted: 10, commits_deleted: 0, workers_deleted: 0, metrics_deleted: 0 }];
  });

  const { runAgentRetention } = require('../lib/jobs/retention.server') as typeof import('../lib/jobs/retention.server');
  const summary = await runAgentRetention();

  assert.deepEqual(summary, { events: 1010, commits: 1000, workers: 1000, metrics: 1000, passes: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.args.p_event_days, 30);
  assert.equal(calls[0]?.args.p_commit_days, 7);
  assert.equal(calls[0]?.args.p_limit, 1000);
  assert.equal(calls[0]?.args.p_metric_days, 30);
});

test('agent retention clamps an invalid configured horizon', async (t) => {
  const previous = process.env.AGENT_EVENT_RETENTION_DAYS;
  process.env.AGENT_EVENT_RETENTION_DAYS = '2';
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_EVENT_RETENTION_DAYS;
    else process.env.AGENT_EVENT_RETENTION_DAYS = previous;
  });
  const calls = stubSystemDb(t, () => [{ events_deleted: 0, commits_deleted: 0, workers_deleted: 0, metrics_deleted: 0 }]);

  const { runAgentRetention } = require('../lib/jobs/retention.server') as typeof import('../lib/jobs/retention.server');
  await runAgentRetention();

  assert.equal(calls[0]?.args.p_event_days, 30);
  assert.equal(calls.length, 1);
});

test('identity cleanup reports both counters', async (t) => {
  const calls = stubSystemDb(t, (name) => {
    assert.equal(name, 'cleanup_expired_identity_rows');
    return [{ sessions_deleted: 4, verifications_deleted: 9 }];
  });

  const { runIdentityCleanup } = require('../lib/jobs/retention.server') as typeof import('../lib/jobs/retention.server');
  assert.deepEqual(await runIdentityCleanup(), { sessions: 4, verifications: 9 });
  assert.equal(calls[0]?.args.p_limit, 5000);
});
