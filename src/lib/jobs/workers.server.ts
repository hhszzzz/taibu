import 'server-only';
import { Worker } from 'bullmq';

import { EMAIL_QUEUE, closeEmailQueue } from '@/lib/email/queue.server';
import { sendMail } from '@/lib/email/mailer.server';
import type { OutgoingMail } from '@/lib/email/mailer.server';
import { createBullConnection } from '@/lib/redis.server';
import { executeAgentEvalRun } from '@/lib/agent/eval/worker.server';
import { runMaintenanceJob } from './maintenance.server';
import {
  AGENT_EVAL_QUEUE, closeAgentEvalQueue, closeMaintenanceQueue, getMaintenanceQueue, JOB_QUEUE_PREFIX, MAINTENANCE_QUEUE,
  type AgentEvalJobData,
} from './queues.server';
import { upsertMaintenanceSchedulers } from './schedulers.server';

let worker: Worker | null = null;
let emailWorker: Worker<OutgoingMail> | null = null;
let agentEvalWorker: Worker<AgentEvalJobData> | null = null;
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
  emailWorker = new Worker<OutgoingMail>(EMAIL_QUEUE, async (job) => {
    await sendMail(job.data);
  }, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    concurrency: 2,
  });
  emailWorker.on('failed', (job, error) => {
    console.warn('[jobs] email job failed:', job?.id, error.message);
  });
  emailWorker.on('error', () => {
    console.warn('[jobs] email worker error');
  });
  // One evaluation at a time; user tasks are claimed from the database, so this queue never competes for their slots.
  agentEvalWorker = new Worker<AgentEvalJobData>(AGENT_EVAL_QUEUE, async (job) => {
    await executeAgentEvalRun(job.data.runId);
  }, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    concurrency: 1,
  });
  agentEvalWorker.on('failed', (job, error) => {
    console.warn('[jobs] agent evaluation failed:', job?.data.runId, error.message);
  });
  agentEvalWorker.on('error', () => {
    console.warn('[jobs] agent evaluation worker error');
  });
}

/** Idempotent: worker-entry calls this once per process. */
export function startJobWorkers(): Promise<void> {
  starting ??= start();
  return starting;
}

export async function stopJobWorkers(): Promise<void> {
  const current = worker;
  const currentEmail = emailWorker;
  const currentEval = agentEvalWorker;
  worker = null;
  emailWorker = null;
  agentEvalWorker = null;
  starting = null;
  await Promise.all([current?.close(), currentEmail?.close(), currentEval?.close()]);
  await closeMaintenanceQueue();
  await closeEmailQueue();
  await closeAgentEvalQueue();
}
