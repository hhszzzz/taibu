import 'server-only';

import { getMaintenanceQueue } from './queues.server';

type RepeatRule =
  | { every: number }
  | { pattern: string; tz: string };

export type MaintenanceSchedulerDefinition = {
  id: string;
  job: string;
  repeat: RepeatRule;
};

/** Scheduler ids are stable: upserting again on every boot must not duplicate jobs. */
export const MAINTENANCE_SCHEDULERS: readonly MaintenanceSchedulerDefinition[] = [
  { id: 'reminders', job: 'reminders', repeat: { every: 5 * 60 * 1000 } },
  { id: 'daily-briefing', job: 'daily-briefing', repeat: { every: 5 * 60 * 1000 } },
  { id: 'agent-attachments-cleanup', job: 'agent-attachments-cleanup', repeat: { every: 15 * 60 * 1000 } },
  // BullMQ v6 cron patterns include seconds; 03:17 Asia/Shanghai.
  { id: 'notifications-prune', job: 'notifications-prune', repeat: { pattern: '0 17 3 * * *', tz: 'Asia/Shanghai' } },
  { id: 'agent-retention', job: 'agent-retention', repeat: { pattern: '0 37 3 * * *', tz: 'Asia/Shanghai' } },
  { id: 'identity-cleanup', job: 'identity-cleanup', repeat: { pattern: '0 47 3 * * *', tz: 'Asia/Shanghai' } },
];

export async function upsertMaintenanceSchedulers(
  queue = getMaintenanceQueue(),
): Promise<void> {
  for (const scheduler of MAINTENANCE_SCHEDULERS) {
    await queue.upsertJobScheduler(
      scheduler.id,
      scheduler.repeat,
      {
        name: scheduler.job,
        data: {},
        opts: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      },
    );
  }
}
