import 'server-only';

import type { Redis } from 'ioredis';
import { getRedisClient } from '@/lib/redis.server';

const PREFIX = 'taibu:auth:';

function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

const INCREMENT_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return value
`;

/**
 * Better Auth secondary storage for sessions, OTPs and rate limiting.
 * Values are opaque strings; Redis may lose them at any time.
 */
export const authSecondaryStorage = {
  async get(key: string): Promise<string | null> {
    return getRedisClient().get(storageKey(key));
  },
  async getAndDelete(key: string): Promise<string | null> {
    return getRedisClient().getdel(storageKey(key));
  },
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const client: Redis = getRedisClient();
    const value = await client.eval(INCREMENT_WITH_TTL, 1, storageKey(key), String(ttlSeconds * 1000));
    return Number(value);
  },
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = getRedisClient();
    if (ttlSeconds) await client.set(storageKey(key), value, 'EX', ttlSeconds);
    else await client.set(storageKey(key), value);
  },
  async delete(key: string): Promise<void> {
    await getRedisClient().del(storageKey(key));
  },
};
