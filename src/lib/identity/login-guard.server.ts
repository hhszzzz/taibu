import 'server-only';

import { createHash } from 'node:crypto';
import { getRedisClient } from '@/lib/redis.server';

const PREFIX = 'taibu:login-fail:v1:';
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
export const LOGIN_FAILURE_LIMIT = 5;

function key(email: string): string {
  return `${PREFIX}${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}

/** Redis failures must not block sign-in; the counter is best effort. */
export async function isLoginLocked(email: string): Promise<boolean> {
  try {
    const count = Number(await getRedisClient().get(key(email)) ?? 0);
    return count >= LOGIN_FAILURE_LIMIT;
  } catch {
    return false;
  }
}

export async function recordLoginFailure(email: string): Promise<void> {
  try {
    const redisKey = key(email);
    const client = getRedisClient();
    const count = await client.incr(redisKey);
    if (count === 1) await client.expire(redisKey, LOGIN_FAILURE_WINDOW_SECONDS);
  } catch {
    // ignore: fail-open by design
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await getRedisClient().del(key(email));
  } catch {
    // ignore
  }
}
