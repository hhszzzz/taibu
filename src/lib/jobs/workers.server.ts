import 'server-only';
import { Worker, type Job, type Processor } from 'bullmq';

import { EMAIL_QUEUE, closeEmailQueue } from '@/lib/email/queue.server';
import { sendMail } from '@/lib/email/mailer.server';
import type { OutgoingMail } from '@/lib/email/mailer.server';
import { createBullConnection } from '@/lib/redis.server';
import { executeAgentEvalRun } from '@/lib/agent/eval/worker.server';
import { runMaintenanceJob } from './maintenance.server';
import {
  AGENT_EVAL_QUEUE, closeAgentEvalQueue, closeMaintenanceQueue, getMaintenanceQueue, JOB_QUEUE_PREFIX, MAINTENANCE_QUEUE,
  type AgentEvalJobData, type MaintenanceJobData,
} from './queues.server';
import { upsertMaintenanceSchedulers } from './schedulers.server';

let worker: Worker | null = null;
let emailWorker: Worker<OutgoingMail> | null = null;
let agentEvalWorker: Worker<AgentEvalJobData> | null = null;
let starting: Promise<void> | null = null;

/** One worker shape for every queue: same connection, prefix and failure logging. */
function createWorker<Data>(options: {
  name: string;
  concurrency: number;
  processor: Processor<Data>;
  failedLabel: string;
  errorLabel: string;
  detail: (job: Job<Data> | undefined) => unknown;
}): Worker<Data> {
  const instance = new Worker<Data>(options.name, options.processor, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    concurrency: options.concurrency,
  });
  instance.on('failed', (job, error) => {
    console.warn(`[jobs] ${options.failedLabel} failed:`, options.detail(job), error.message);
  });
  instance.on('error', () => {
    console.warn(`[jobs] ${options.errorLabel} worker error`);
  });
  return instance;
}

async function start(): Promise<void> {
  await upsertMaintenanceSchedulers(getMaintenanceQueue());
  worker = createWorker<MaintenanceJobData>({
    name: MAINTENANCE_QUEUE,
    concurrency: 1,
    processor: async (job) => {
      const summary = await runMaintenanceJob(job.name);
      const failure = summary.results.find((result) => result.error !== undefined);
      // Keep the failure visible in BullMQ without re-running the successful steps
      // inside this job; the next scheduler tick retries idempotently.
      if (failure) throw new Error(`${job.name}: ${failure.step} failed`);
      return summary;
    },
    failedLabel: 'maintenance job',
    errorLabel: 'maintenance',
    detail: (job) => job?.name,
  });
  emailWorker = createWorker<OutgoingMail>({
    name: EMAIL_QUEUE,
    concurrency: 2,
    processor: async (job) => {
      await sendMail(job.data);
    },
    failedLabel: 'email job',
    errorLabel: 'email',
    detail: (job) => job?.id,
  });
  // One evaluation at a time; user tasks are claimed from the database, so this queue never competes for their slots.
  agentEvalWorker = createWorker<AgentEvalJobData>({
    name: AGENT_EVAL_QUEUE,
    concurrency: 1,
    processor: async (job) => {
      await executeAgentEvalRun(job.data.runId);
    },
    failedLabel: 'agent evaluation',
    errorLabel: 'agent evaluation',
    detail: (job) => job?.data.runId,
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
  await Promise.all([closeMaintenanceQueue(), closeEmailQueue(), closeAgentEvalQueue()]);
}
