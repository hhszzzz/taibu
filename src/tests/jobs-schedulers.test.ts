import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAINTENANCE_SCHEDULERS,
  upsertMaintenanceSchedulers,
} from '../lib/jobs/schedulers.server';

type UpsertCall = {
  id: string;
  repeat: unknown;
  template: { name?: string; data?: unknown; opts?: Record<string, unknown> };
};

test('maintenance schedulers use stable ids and are safe to upsert repeatedly', async () => {
  const calls: UpsertCall[] = [];
  const removed: string[] = [];
  const existing = [
    { key: 'reminders', name: 'reminders' },
    { key: 'renamed-job', name: 'old-name' },
  ];
  const queue = {
    async upsertJobScheduler(id: string, repeat: unknown, template: UpsertCall['template']) {
      calls.push({ id, repeat, template });
    },
    async getJobSchedulers() {
      return existing;
    },
    async removeJobScheduler(id: string) {
      removed.push(id);
    },
  };

  await upsertMaintenanceSchedulers(queue as never);
  await upsertMaintenanceSchedulers(queue as never);

  // A scheduler this release no longer declares is removed, not left firing.
  assert.deepEqual(removed, ['renamed-job', 'renamed-job']);

  assert.equal(calls.length, MAINTENANCE_SCHEDULERS.length * 2);
  const ids = new Set(calls.map((call) => call.id));
  assert.equal(ids.size, MAINTENANCE_SCHEDULERS.length);
  assert.deepEqual([...ids].sort(), [
    'agent-attachments-cleanup',
    'agent-retention',
    'daily-briefing',
    'identity-cleanup',
    'notifications-prune',
    'reminders',
  ]);
  assert.ok(calls.every((call) => call.template.name === call.id));
  assert.ok(calls.every((call) => call.template.opts?.removeOnComplete !== undefined
    && call.template.opts?.removeOnFail !== undefined));

  const prune = calls.find((call) => call.id === 'notifications-prune');
  assert.deepEqual(prune?.repeat, { pattern: '0 17 3 * * *', tz: 'Asia/Shanghai' });
  const reminders = calls.find((call) => call.id === 'reminders');
  assert.deepEqual(reminders?.repeat, { every: 5 * 60 * 1000 });
  assert.deepEqual(calls.find((call) => call.id === 'agent-retention')?.repeat, { pattern: '0 37 3 * * *', tz: 'Asia/Shanghai' });
  assert.deepEqual(calls.find((call) => call.id === 'identity-cleanup')?.repeat, { pattern: '0 47 3 * * *', tz: 'Asia/Shanghai' });
});
