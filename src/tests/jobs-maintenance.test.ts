import test from 'node:test';
import assert from 'node:assert/strict';

type SummaryResult = { step: string; value?: unknown; error?: string };

function runMaintenanceJob(name: string): Promise<{ job: string; results: SummaryResult[] }> {
  return (require('../lib/jobs/maintenance.server') as typeof import('../lib/jobs/maintenance.server'))
    .runMaintenanceJob(name);
}

test('reminders tick runs processing and scheduling independently', async (t) => {
  const reminders = require('../lib/reminders') as typeof import('../lib/reminders');
  t.mock.method(reminders, 'processScheduledReminders', async () => 3);
  t.mock.method(reminders, 'scheduleAllUsersReminders', async () => 7);

  const summary = await runMaintenanceJob('reminders');
  assert.deepEqual(summary.results, [
    { step: 'process-scheduled-reminders', value: 3 },
    { step: 'schedule-user-reminders', value: 7 },
  ]);
});

test('one failed reminder step does not block the other', async (t) => {
  const reminders = require('../lib/reminders') as typeof import('../lib/reminders');
  t.mock.method(reminders, 'processScheduledReminders', async () => { throw new Error('db timeout'); });
  t.mock.method(reminders, 'scheduleAllUsersReminders', async () => 7);

  const summary = await runMaintenanceJob('reminders');
  assert.deepEqual(summary.results[0], { step: 'process-scheduled-reminders', error: 'db timeout' });
  assert.deepEqual(summary.results[1], { step: 'schedule-user-reminders', value: 7 });
});

test('the agent schedule tick is dispatched to its runner', async (t) => {
  const runner = require('../lib/agent/schedules/runner.server') as typeof import('../lib/agent/schedules/runner.server');
  const calls: number[] = [];
  t.mock.method(runner, 'processAgentSchedules', async () => { calls.push(1); return { claimed: 2, submitted: 1, skipped: 1, failed: 0 }; });

  assert.deepEqual((await runMaintenanceJob('agent-schedules')).results, [
    { step: 'process-agent-schedules', value: { claimed: 2, submitted: 1, skipped: 1, failed: 0 } },
  ]);
  assert.equal(calls.length, 1);
});

test('attachment cleanup and notification pruning run their owners', async (t) => {
  const attachments = require('../lib/agent/attachments.server') as typeof import('../lib/agent/attachments.server');
  const images = require('../lib/ai/image-generation.server') as typeof import('../lib/ai/image-generation.server');
  const notifications = require('../lib/notification-server') as typeof import('../lib/notification-server');
  t.mock.method(attachments, 'cleanupAgentAttachments', async () => 4);
  t.mock.method(images, 'cleanupGeneratedImages', async () => 2);
  t.mock.method(notifications, 'pruneExpiredNotifications', async () => 9);

  assert.deepEqual((await runMaintenanceJob('agent-attachments-cleanup')).results, [
    { step: 'cleanup-agent-attachments', value: 4 },
    { step: 'cleanup-generated-images', value: 2 },
  ]);
  assert.deepEqual((await runMaintenanceJob('notifications-prune')).results, [
    { step: 'prune-expired-notifications', value: 9 },
  ]);
});

test('retention and identity cleanup are dispatched to their owners', async (t) => {
  const retention = require('../lib/jobs/retention.server') as typeof import('../lib/jobs/retention.server');
  t.mock.method(retention, 'runAgentRetention', async () => ({ events: 3, commits: 1, workers: 0, metrics: 1, passes: 1 }));
  t.mock.method(retention, 'runIdentityCleanup', async () => ({ sessions: 2, verifications: 5 }));

  assert.deepEqual((await runMaintenanceJob('agent-retention')).results, [
    { step: 'agent-retention', value: { events: 3, commits: 1, workers: 0, metrics: 1, passes: 1 } },
  ]);
  assert.deepEqual((await runMaintenanceJob('identity-cleanup')).results, [
    { step: 'identity-cleanup', value: { sessions: 2, verifications: 5 } },
  ]);
});

test('unknown maintenance jobs fail closed', async () => {
  await assert.rejects(runMaintenanceJob('nope'), /Unknown maintenance job/u);
});
