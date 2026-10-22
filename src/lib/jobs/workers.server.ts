import 'server-only';
import { Worker } from 'bullmq';

import { createBullConnection } from '@/lib/redis.server';
import { runMaintenanceJob } from './maintenance.server';
import { closeMaintenanceQueue, getMaintenanceQueue, JOB_QUEUE_PREFIX, MAINTENANCE_QUEUE } from './queues.server';
import { upsertMaintenanceSchedulers } from './schedulers.server';

let worker: Worker | null = null;
let starting: Promise<void> | null = null;

async function start(): Promise<void> {
  await upsertMaintenanceSchedulers(getMaintenanceQueue());
  worker = new Worker(MAINTENANCE_QUEUE, async (job) => {
    const summary = await runMaintenanceJob(job.name);
    const failure = summary.results.find((result) => result.error !== undefined);
    // Keep the failure visible in BullMQ without re-running the successful steps
    // inside this job; the next scheduler tick retries idempotently.
    if (failure) throw new Error(`${job.name}: ${failure.step} failed`);
    return summary;
  }, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    concurrency: 1,
  });
  worker.on('failed', (job, error) => {
    console.warn('[jobs] maintenance job failed:', job?.name, error.message);
  });
  worker.on('error', () => {
    console.warn('[jobs] maintenance worker error');
  });
}

/** Idempotent: worker-entry calls this once per process. */
export function startJobWorkers(): Promise<void> {
  starting ??= start();
  return starting;
}

export async function stopJobWorkers(): Promise<void> {
  const current = worker;
  worker = null;
  starting = null;
  await current?.close();
  await closeMaintenanceQueue();
}
