import 'server-only';

import { cleanupAgentAttachments } from '@/lib/agent/attachments.server';
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

async function runSteps(steps: Array<{ name: string; run: () => Promise<unknown> }>): Promise<MaintenanceRunSummary> {
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

/**
 * One scheduler tick. Every step is idempotent: a partial failure is reported
 * but does not block the steps that succeeded, exactly like the old cron route.
 */
export async function runMaintenanceJob(name: string): Promise<MaintenanceRunSummary> {
  switch (name) {
    case 'reminders':
      return runSteps([
        { name: 'process-scheduled-reminders', run: processScheduledReminders },
        { name: 'schedule-user-reminders', run: scheduleAllUsersReminders },
      ]);
    case 'agent-schedules':
      return runSteps([{ name: 'process-agent-schedules', run: processAgentSchedules }]);
    case 'agent-attachments-cleanup':
      return runSteps([
        { name: 'cleanup-agent-attachments', run: cleanupAgentAttachments },
        { name: 'cleanup-generated-images', run: cleanupGeneratedImages },
      ]);
    case 'notifications-prune':
      return runSteps([{ name: 'prune-expired-notifications', run: pruneExpiredNotifications }]);
    case 'agent-retention':
      return runSteps([{ name: 'agent-retention', run: runAgentRetention }]);
    case 'identity-cleanup':
      return runSteps([{ name: 'identity-cleanup', run: runIdentityCleanup }]);
    case 'billing-maintenance':
      return runSteps([{ name: 'billing-expire-due', run: () => expireDueBilling() }]);
    default:
      throw new Error(`Unknown maintenance job: ${name}`);
  }
}
