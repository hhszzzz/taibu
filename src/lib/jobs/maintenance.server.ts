import 'server-only';

import { cleanupAgentAttachments } from '@/lib/agent/attachments.server';
import { expireAwaitingAgentRuns } from '@/lib/agent/expiry.server';
import { cleanupGeneratedImages } from '@/lib/ai/image-generation.server';
import { expireDueBilling } from '@/lib/billing/account.server';
import { processAgentSchedules } from '@/lib/agent/schedules/runner.server';
import { pruneExpiredNotifications } from '@/lib/notification-server';
import { processScheduledReminders, scheduleAllUsersReminders } from '@/lib/reminders';
import { runAgentRetention, runIdentityCleanup } from './retention.server';

export type MaintenanceRunSummary = {
  job: string;
  results: Array<{ step: string; value?: unknown; error?: string }>;
};

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

type MaintenanceStep = { name: string; run: () => Promise<unknown> };

async function runSteps(steps: MaintenanceStep[]): Promise<MaintenanceRunSummary> {
  const settled = await Promise.allSettled(steps.map((step) => step.run()));
  const results = settled.map((result, index) => result.status === 'fulfilled'
    ? { step: steps[index].name, value: result.value }
    : { step: steps[index].name, error: messageOf(result.reason) });
  const failures = results.filter((result) => result.error !== undefined);
  if (failures.length) {
    console.error('[jobs] maintenance steps failed:', failures);
  }
  return { job: steps.map((step) => step.name).join(','), results };
}

/** Each `run` resolves its owner when the tick fires, so tests can replace an imported step. */
const MAINTENANCE_JOBS: Record<string, MaintenanceStep[]> = {
  reminders: [
    { name: 'process-scheduled-reminders', run: () => processScheduledReminders() },
    { name: 'schedule-user-reminders', run: () => scheduleAllUsersReminders() },
  ],
  'agent-schedules': [
    { name: 'process-agent-schedules', run: () => processAgentSchedules() },
  ],
  'agent-ask-timeout': [
    { name: 'expire-awaiting-agent-runs', run: () => expireAwaitingAgentRuns() },
  ],
  'agent-attachments-cleanup': [
    { name: 'cleanup-agent-attachments', run: () => cleanupAgentAttachments() },
    { name: 'cleanup-generated-images', run: () => cleanupGeneratedImages() },
  ],
  'notifications-prune': [
    { name: 'prune-expired-notifications', run: () => pruneExpiredNotifications() },
  ],
  'agent-retention': [
    { name: 'agent-retention', run: () => runAgentRetention() },
  ],
  'identity-cleanup': [
    { name: 'identity-cleanup', run: () => runIdentityCleanup() },
  ],
  'billing-maintenance': [
    { name: 'billing-expire-due', run: () => expireDueBilling() },
  ],
};

/**
 * One scheduler tick. Every step is idempotent: a partial failure is reported
 * but does not block the steps that succeeded, exactly like the old cron route.
 */
export async function runMaintenanceJob(name: string): Promise<MaintenanceRunSummary> {
  const steps = MAINTENANCE_JOBS[name];
  if (!steps) throw new Error(`Unknown maintenance job: ${name}`);
  return runSteps(steps);
}
