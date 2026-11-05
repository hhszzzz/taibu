import 'server-only';
import { Queue, type DefaultJobOptions } from 'bullmq';

import { createBullConnection } from '@/lib/redis.server';

export const MAINTENANCE_QUEUE = 'taibu-maintenance';
/** Agent evaluations run apart from user tasks, one at a time. */
export const AGENT_EVAL_QUEUE = 'agent-eval';
export const JOB_QUEUE_PREFIX = 'taibu:bull';

export type MaintenanceJobData = Record<string, never>;
export type AgentEvalJobData = { runId: string };

let maintenanceQueue: Queue<MaintenanceJobData> | null = null;
let agentEvalQueue: Queue<AgentEvalJobData> | null = null;

/** One queue shape for every worker-backed queue: same connection and prefix. */
export function createQueue<T>(name: string, defaultJobOptions?: DefaultJobOptions): Queue<T> {
  return new Queue<T>(name, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    ...(defaultJobOptions ? { defaultJobOptions } : {}),
  });
}

export function getMaintenanceQueue(): Queue<MaintenanceJobData> {
  maintenanceQueue ??= createQueue<MaintenanceJobData>(MAINTENANCE_QUEUE);
  return maintenanceQueue;
}

export function getAgentEvalQueue(): Queue<AgentEvalJobData> {
  agentEvalQueue ??= createQueue<AgentEvalJobData>(AGENT_EVAL_QUEUE);
  return agentEvalQueue;
}

export async function closeMaintenanceQueue(): Promise<void> {
  const queue = maintenanceQueue;
  maintenanceQueue = null;
  await queue?.close();
}

export async function closeAgentEvalQueue(): Promise<void> {
  const queue = agentEvalQueue;
  agentEvalQueue = null;
  await queue?.close();
}
