import 'server-only';

import { Queue } from 'bullmq';
import { JOB_QUEUE_PREFIX } from '@/lib/jobs/queues.server';
import { createBullConnection } from '@/lib/redis.server';
import type { OutgoingMail } from '@/lib/email/mailer.server';

export const EMAIL_QUEUE = 'taibu-email';

let queue: Queue<OutgoingMail> | null = null;

export function getEmailQueue(): Queue<OutgoingMail> {
  queue ??= new Queue<OutgoingMail>(EMAIL_QUEUE, {
    connection: createBullConnection(),
    prefix: JOB_QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

export async function enqueueEmail(mail: OutgoingMail): Promise<void> {
  await getEmailQueue().add('send', mail);
}

export async function closeEmailQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = null;
}
