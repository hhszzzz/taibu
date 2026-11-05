import 'server-only';

import { Queue } from 'bullmq';
import { createQueue } from '@/lib/jobs/queues.server';
import type { OutgoingMail } from '@/lib/email/mailer.server';

export const EMAIL_QUEUE = 'taibu-email';

let queue: Queue<OutgoingMail> | null = null;

function getEmailQueue(): Queue<OutgoingMail> {
  queue ??= createQueue<OutgoingMail>(EMAIL_QUEUE, {
    // The job payload is the mail body, OTP codes included: drop completed
    // jobs immediately and keep failures only long enough to debug a relay.
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: { age: 3600, count: 100 },
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
