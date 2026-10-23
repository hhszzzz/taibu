import 'server-only';
import { Queue } from 'bullmq';

import { createBullConnection } from '@/lib/redis.server';

export const MAINTENANCE_QUEUE = 'taibu-maintenance';
export const JOB_QUEUE_PREFIX = 'taibu:bull';

export type MaintenanceJobData = Record<string, never>;

let maintenanceQueue: Queue<MaintenanceJobData> | null = null;

export function getMaintenanceQueue(): Queue<MaintenanceJobData> {
  maintenanceQueue ??= new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
  });
  return maintenanceQueue;
}

export async function closeMaintenanceQueue(): Promise<void> {
  const queue = maintenanceQueue;
  maintenanceQueue = null;
  await queue?.close();
}
